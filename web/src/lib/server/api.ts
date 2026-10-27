import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeIndianMobile, toDateKey } from "@/lib/domain/rules";
import { Shop as ShopSchema, type Call, type LedgerEntry, type Payment } from "@/lib/domain/types";
import type { KhataImportSummary, Session, UdhaarApi } from "@/lib/api/contract";
import { buildReminderScript } from "@/lib/demo/scripts";
import { SAMPLE_TRANSCRIPTIONS } from "@/lib/demo/voice-sample";
import { answerQuestion } from "./assistant";
import { loadLines, loadShop, loadShopData, toCall, type CallRow, type ShopData } from "./data";
import { env } from "./env";
import { readSamplePage } from "./khata";
import { batchSummaries, batchSummary, callDetail, callItems, candidates, customerDetail, dailyReport, dashboard, graph, summaries } from "./queries";
import { batchCallsToCancel, callsToCancel, planBatchMove, planCallMove, planSchedule, type MovePlan } from "./scheduling";
import { adminClient, check, maybe } from "./supabase";
import { parseIdentifier, parseProfile, parseSignUp, WRONG_DETAILS } from "./validation";

/**
 * The server side of the API contract, on Supabase. Each method gets a client acting as the signed-in
 * shopkeeper, so the database's access rules limit it to their shop.
 */

export type Ctx = { sb: SupabaseClient; now: Date };

type ServerApi = { [K in keyof UdhaarApi]: (ctx: Ctx, ...args: Parameters<UdhaarApi[K]>) => ReturnType<UdhaarApi[K]> };

export class NotSignedIn extends Error {
  constructor() {
    super("Sign in again to continue.");
  }
}

async function currentSession(sb: SupabaseClient): Promise<Session | null> {
  const { data } = await sb.auth.getUser();
  const user = data.user;
  if (!user) return null;
  const loaded = await loadShop(sb, user.id);
  if (!loaded) return null;
  const { shop, owner } = loaded;
  return { user: { id: user.id, shopId: shop.id, phone: owner.phone, email: user.email, name: owner.name, createdAt: owner.created_at }, shop };
}

async function requireSession(sb: SupabaseClient): Promise<Session> {
  const session = await currentSession(sb);
  if (!session) throw new NotSignedIn();
  return session;
}

async function shopData({ sb, now }: Ctx): Promise<ShopData> {
  const { shop } = await requireSession(sb);
  const lines = await loadLines(adminClient(), env.callLines());
  return loadShopData(sb, shop, lines, now);
}

const iso = (d: Date) => d.toISOString();

/** Writes a timeline entry on each call. */
async function addEvents(sb: SupabaseClient, shopId: string, callIds: string[], status: Call["status"], detail: string) {
  if (callIds.length === 0) return;
  maybe(await sb.from("call_events").insert(callIds.map((call_id) => ({ call_id, shop_id: shopId, status, detail }))));
}

async function applyMove(sb: SupabaseClient, shopId: string, plan: Extract<MovePlan, { kind: "move" }>) {
  const at = iso(plan.at);
  if (plan.callIds.length > 0) {
    // Only calls still waiting for their time move; one that started meanwhile keeps its time.
    const moved = check(await sb.from("calls").update({ scheduled_at: at }).in("id", plan.callIds).eq("status", "scheduled").select("id"));
    await addEvents(sb, shopId, moved.map((r: { id: string }) => r.id), "scheduled", plan.detail);
  }
  if (plan.batchId) maybe(await sb.from("reminder_batches").update({ scheduled_at: at }).eq("id", plan.batchId));
}

async function cancelCalls(sb: SupabaseClient, shopId: string, callIds: string[]) {
  if (callIds.length === 0) return;
  const cancelled = check(
    await sb.from("calls").update({ status: "cancelled" }).in("id", callIds).in("status", ["scheduled", "queued"]).select("id"),
  );
  await addEvents(sb, shopId, cancelled.map((r: { id: string }) => r.id), "cancelled", "Cancelled by the shopkeeper");
}

let transcriptions = 0;

export const serverApi: ServerApi = {
  getSession: ({ sb }) => currentSession(sb),

  signIn: async ({ sb }, { identifier, password }) => {
    const target = parseIdentifier(identifier);
    let email: string | undefined;
    if ("email" in target) email = target.email;
    else {
      const admin = adminClient();
      const profile = maybe(await admin.from("profiles").select("id").eq("phone", target.phone).maybeSingle<{ id: string }>());
      if (profile) email = (await admin.auth.admin.getUserById(profile.id)).data.user?.email;
    }
    if (!email) throw new Error(WRONG_DETAILS);
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw new Error(WRONG_DETAILS);
    return requireSession(sb);
  },

  signUp: async ({ sb }, input) => {
    const form = parseSignUp(input);
    const admin = adminClient();
    const taken = maybe(await admin.from("profiles").select("id").eq("phone", form.phone).maybeSingle());
    if (taken) throw new Error("That number is already registered. Try signing in.");

    // Created confirmed, so no confirmation email is needed.
    const created = await admin.auth.admin.createUser({ email: form.email, password: form.password, email_confirm: true });
    if (created.error || !created.data.user) {
      const exists = created.error?.code === "email_exists" || /already/i.test(created.error?.message ?? "");
      throw new Error(exists ? "That email is already registered. Try signing in." : (created.error?.message ?? "Couldn't create the account."));
    }
    const userId = created.data.user.id;
    try {
      maybe(await admin.from("profiles").insert({ id: userId, name: form.ownerName, phone: form.phone }));
      const shop = check(await admin.from("shops").insert({ owner_id: userId, name: form.shopName }).select("id").single<{ id: string }>());
      maybe(
        await admin
          .from("shop_settings")
          .insert({ shop_id: shop.id, report_language: form.language, default_customer_language: form.language }),
      );
    } catch (err) {
      // Deleting the user removes the profile and shop with it.
      await admin.auth.admin.deleteUser(userId);
      throw err;
    }
    const { error } = await sb.auth.signInWithPassword({ email: form.email, password: form.password });
    if (error) throw new Error(error.message);
    return requireSession(sb);
  },

  signOut: async ({ sb }) => {
    await sb.auth.signOut();
  },

  updateProfile: async ({ sb }, input) => {
    const session = await requireSession(sb);
    const form = parseProfile(input);
    const admin = adminClient();
    const owner = maybe(await admin.from("profiles").select("id").eq("phone", form.phone).neq("id", session.user.id).maybeSingle());
    if (owner) throw new Error("That number belongs to another account.");
    if (form.email !== session.user.email?.toLowerCase()) {
      const { error } = await admin.auth.admin.updateUserById(session.user.id, { email: form.email, email_confirm: true });
      if (error) throw new Error(/already/i.test(error.message) || error.code === "email_exists" ? "That email belongs to another account." : error.message);
    }
    maybe(await sb.from("profiles").update({ name: form.name, phone: form.phone }).eq("id", session.user.id));
    maybe(await sb.from("shops").update({ name: form.shopName, upi_id: form.upiId || null }).eq("id", session.shop.id));
    return requireSession(sb);
  },

  getShop: async ({ sb }) => (await requireSession(sb)).shop,

  updateShop: async ({ sb }, patch) => {
    const { shop } = await requireSession(sb);
    const next = ShopSchema.parse({ ...shop, ...patch, id: shop.id });
    maybe(
      await sb
        .from("shop_settings")
        .update({
          calling_start: next.callingHours.start,
          calling_end: next.callingHours.end,
          reminder_gap_days: next.reminderGapDays,
          max_call_minutes: next.maxCallMinutes,
          default_customer_language: next.defaultCustomerLanguage,
          report_enabled: next.reportEnabled,
          report_time: next.reportTime,
          report_language: next.reportLanguage,
          demo_bypass_hours: next.demoBypassHours,
        })
        .eq("shop_id", shop.id),
    );
    if (next.name !== shop.name || next.upiId !== shop.upiId) {
      maybe(await sb.from("shops").update({ name: next.name, upi_id: next.upiId || null }).eq("id", shop.id));
    }
    return (await requireSession(sb)).shop;
  },

  listCustomers: async (ctx) => summaries(await shopData(ctx), ctx.now),
  listReminderCandidates: async (ctx) => candidates(await shopData(ctx), ctx.now),
  getCustomer: async (ctx, id) => customerDetail(await shopData(ctx), id, ctx.now),

  updateCustomer: async (ctx, id, patch) => {
    const row: Record<string, unknown> = {};
    if (patch.name !== undefined) row.name = patch.name.trim();
    if (patch.nameNative !== undefined) row.name_native = patch.nameNative.trim() || null;
    if (patch.language !== undefined) row.language = patch.language;
    if (patch.optedOut !== undefined) row.opted_out_at = patch.optedOut ? iso(ctx.now) : null;
    if (patch.phone !== undefined) {
      const phone = patch.phone.trim() ? normalizeIndianMobile(patch.phone) : null;
      if (patch.phone.trim() && !phone) throw new Error("Enter a 10-digit Indian mobile number.");
      row.phone = phone;
    }
    await requireSession(ctx.sb);
    const updated = maybe(await ctx.sb.from("customers").update(row).eq("id", id).select("id").maybeSingle());
    if (!updated) throw new Error("Customer not found");
    const customer = (await shopData(ctx)).customers.find((c) => c.id === id);
    if (!customer) throw new Error("Customer not found");
    return customer;
  },

  addEntry: async ({ sb }, input) => {
    const { shop } = await requireSession(sb);
    const row = check(
      await sb
        .from("ledger_entries")
        .insert({ shop_id: shop.id, customer_id: input.customerId, amount: input.amount, items: input.items, entry_date: input.date, source: input.source })
        .select("id, created_at")
        .single<{ id: string; created_at: string }>(),
    );
    const entry: LedgerEntry = { id: row.id, ...input, createdAt: row.created_at };
    return entry;
  },

  recordPayment: async ({ sb, now }, input) => {
    await requireSession(sb);
    const id = check(
      await sb.rpc("record_payment", { p_customer_id: input.customerId, p_amount: input.amount, p_method: input.method, p_paid_on: input.date }),
    ) as string;
    const payment: Payment = { id, ...input, createdAt: iso(now) };
    return payment;
  },

  resolveDispute: async ({ sb, now }, id) => {
    await requireSession(sb);
    maybe(await sb.from("disputes").update({ resolved_at: iso(now) }).eq("id", id).is("resolved_at", null));
  },

  listCalls: async (ctx) => callItems(await shopData(ctx)),
  getCall: async (ctx, id) => callDetail(await shopData(ctx), id),

  scheduleReminders: async (ctx, input) => {
    const db = await shopData(ctx);
    const plan = planSchedule(db, input, ctx.now);
    if (plan.kind === "outside_hours") return { skipped: [], outsideHours: plan.hours };
    if (plan.kind === "nothing") return { skipped: plan.skipped };
    const batchId = check(
      await ctx.sb.rpc("create_reminder_batch", {
        p_scheduled_at: iso(plan.at),
        p_language: plan.language === "auto" ? null : plan.language,
        p_calls: plan.calls.map((c) => ({ customer_id: c.customerId, to_number: c.toNumber, language: c.language })),
        p_detail: plan.detail ?? null,
      }),
    ) as string;
    const batch = (await shopData(ctx)).batches.find((b) => b.id === batchId);
    return { batch, skipped: plan.skipped };
  },

  rescheduleCall: async (ctx, id, at, bypassHours) => {
    const db = await shopData(ctx);
    const plan = planCallMove(db, id, at, bypassHours);
    const before = db.calls.find((c) => c.id === id)!;
    if (plan.kind === "outside_hours") return { call: before, outsideHours: plan.hours };
    await applyMove(ctx.sb, db.shop.id, plan);
    const call = (await shopData(ctx)).calls.find((c) => c.id === id) ?? before;
    return { call };
  },

  cancelCall: async (ctx, id) => {
    const db = await shopData(ctx);
    await cancelCalls(ctx.sb, db.shop.id, callsToCancel(db, id));
  },

  listBatches: async (ctx) => batchSummaries(await shopData(ctx)),

  rescheduleBatch: async (ctx, id, at, bypassHours) => {
    const db = await shopData(ctx);
    const plan = planBatchMove(db, id, at, bypassHours);
    const before = db.batches.find((b) => b.id === id)!;
    if (plan.kind === "outside_hours") return { batch: before, outsideHours: plan.hours };
    await applyMove(ctx.sb, db.shop.id, plan);
    const batch = batchSummary(await shopData(ctx), id)?.batch ?? before;
    return { batch };
  },

  cancelBatch: async (ctx, id) => {
    const db = await shopData(ctx);
    await cancelCalls(ctx.sb, db.shop.id, batchCallsToCancel(db, id));
  },

  extractKhata: async (ctx, { source }) => readSamplePage(await shopData(ctx), source, ctx.now),

  saveKhata: async (ctx, { source, rows }) => {
    const db = await shopData(ctx);
    const byPhone = new Map(db.customers.filter((c) => c.phone).map((c) => [c.phone, c.id]));
    const payload = rows.map((row) => {
      const phone = row.phone ? normalizeIndianMobile(row.phone) : null;
      // A new name with a number we already have is that customer.
      const customerId = row.matchCustomerId ?? (phone ? byPhone.get(phone) : undefined) ?? null;
      return {
        action: row.action,
        saved_entry_id: row.saved?.entryId ?? null,
        customer_id: customerId,
        name: row.name.value,
        name_native: row.nameNative ?? null,
        phone,
        language: row.language,
        amount: row.amount.value,
        items: row.items.value,
        entry_date: row.date.value,
      };
    });
    const result = check(await ctx.sb.rpc("save_khata_import", { p_source: source, p_rows: payload })) as {
      import_id: string;
      added: number;
      updated: number;
      new_customers: number;
    };
    return { importId: result.import_id, added: result.added, updated: result.updated, newCustomers: result.new_customers };
  },

  listKhataImports: async (ctx) => {
    const db = await shopData(ctx);
    return [...db.imports]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 5)
      .map(
        (i): KhataImportSummary => ({
          import: i,
          added: i.entryIds.length,
          updated: i.updates.length,
          amount: db.entries.filter((e) => e.importId === i.id).reduce((sum, e) => sum + e.amount, 0),
        }),
      );
  },

  undoKhataImport: async ({ sb }, id) => {
    await requireSession(sb);
    const result = check(await sb.rpc("undo_khata_import", { p_import_id: id })) as { removed: number; restored: number; customers_removed: number };
    return { removed: result.removed, restored: result.restored, customersRemoved: result.customers_removed };
  },

  ask: async (ctx, question) => answerQuestion(await shopData(ctx), question, ctx.now, (input) => serverApi.scheduleReminders(ctx, input)),

  transcribe: async ({ sb }) => {
    await requireSession(sb);
    return SAMPLE_TRANSCRIPTIONS[transcriptions++ % SAMPLE_TRANSCRIPTIONS.length];
  },

  getDashboard: async (ctx) => dashboard(await shopData(ctx), ctx.now),
  getDailyReport: async (ctx) => dailyReport(await shopData(ctx), ctx.now),

  sendReportCall: async ({ sb, now }) => {
    const { shop } = await requireSession(sb);
    const row = check(
      await sb
        .from("calls")
        .insert({ shop_id: shop.id, kind: "report", to_number: shop.ownerPhone, language: shop.reportLanguage, status: "scheduled", scheduled_at: iso(now) })
        .select("*")
        .single<CallRow>(),
    );
    await addEvents(sb, shop.id, [row.id], "scheduled", "Evening report to the shopkeeper");
    return toCall(row, [{ at: iso(now), status: "scheduled", detail: "Evening report to the shopkeeper" }]);
  },

  getGraph: async (ctx) => graph(await shopData(ctx), ctx.now),

  startDemoCall: async ({ now }, { phone, language, name }) => {
    const number = normalizeIndianMobile(phone);
    if (!number) return { allowed: false, reason: "Enter a 10-digit Indian mobile number." };
    const admin = adminClient();
    const today = toDateKey(now);
    const { count } = await admin.from("try_calls").select("id", { count: "exact", head: true }).eq("called_on", today);
    if ((count ?? 0) >= 20) return { allowed: false, reason: "The demo has reached today's limit of 20 calls. Try again tomorrow." };
    const { error } = await admin.from("try_calls").insert({ phone: number, called_on: today });
    if (error?.code === "23505") return { allowed: false, reason: "This number already had a demo call today. Try again tomorrow." };
    if (error) throw new Error(error.message);
    const visitor = name?.trim() || "friend";
    const script = buildReminderScript(language === "bn" ? "promise_product" : "promise", {
      now,
      customer: { name: visitor, nameNative: visitor, language },
      amount: 350,
    });
    return { allowed: true, language, turns: script.turns, extraction: script.extraction };
  },
};
