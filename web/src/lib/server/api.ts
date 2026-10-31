import type { SupabaseClient } from "@supabase/supabase-js";
import { format } from "date-fns";
import { CALL_PACK, normalizeIndianMobile, PLANS, toDateKey } from "@/lib/domain/rules";
import { PlanId as PlanIdSchema, Shop as ShopSchema, type Call, type Language, type LedgerEntry, type Payment } from "@/lib/domain/types";
import type { KhataImportSummary, Session, UdhaarApi } from "@/lib/api/contract";
import { buildReminderScript } from "@/lib/demo/scripts";
import { ask } from "./ask";
import { makeCall } from "./bolna/client";
import { agentIds, bolnaConfigured, tryCallsReal } from "./bolna/config";
import { BOLNA_LANGUAGE, LANGUAGE_NAMES, reminderGreeting } from "./bolna/prompts";
import { loadLines, loadShop, loadShopData, toCall, type CallRow, type ShopData } from "./data";
import { env } from "./env";
import { fromInputLines, fromReadLines, photoPath, readSamplePage, toRows } from "./khata";
import { columnSample, step } from "./ai";
import { aiConfigured, PROVIDERS } from "./providers";
import { batchSummaries, batchSummary, callDetail, callItems, candidates, customerDetail, dailyReport, dashboard, graph, planUsage, summaries } from "./queries";
import { runDispatcher } from "./dispatcher";
import { batchCallsToCancel, callsToCancel, planBatchMove, planCallMove, planSchedule, type MovePlan } from "./scheduling";
import { clearAccount, limited, recordFailure, signInKeys, signUpKeys, TOO_MANY } from "./limits";
import { adminClient, check, maybe } from "./supabase";
import { parseIdentifier, parseProfile, parseSignUp, WRONG_DETAILS } from "./validation";

/**
 * The server side of the API contract, on Supabase. Each method gets a client acting as the signed-in
 * shopkeeper, so the database's access rules limit it to their shop.
 */

/** `ip`: the caller's network address, for the sign-in limits. */
export type Ctx = { sb: SupabaseClient; now: Date; ip?: string };

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

/** Supabase Auth can't look up a user by email, so the database answers (0004_email_lookup.sql). */
async function emailInUse(email: string, except?: string): Promise<boolean> {
  const result = await adminClient().rpc("email_in_use", { p_email: email, p_except: except ?? null });
  // Before that migration runs, fall back to Supabase Auth's own duplicate check.
  if (result.error?.code === "PGRST202") return false;
  return check(result) as boolean;
}

/** Dials calls that are due now straight away, instead of at the next minute's run. Never throws. */
async function dialNow() {
  if (!bolnaConfigured()) return;
  try {
    await runDispatcher();
  } catch (err) {
    console.error("[dispatcher]", err instanceof Error ? err.message : err);
  }
}

/** Requests are capped at 4.5 MB on Vercel; the app shrinks photos well below this before uploading. */
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What a new shopkeeper filled in, kept on their account until the email is confirmed. */
type PendingShop = { ownerName: string; phone: string; shopName: string; language: Language };

/** The profile, shop and settings for a newly confirmed account. Safe to call twice. */
async function createShop(userId: string, s: PendingShop) {
  const admin = adminClient();
  const existing = maybe(await admin.from("shops").select("id").eq("owner_id", userId).maybeSingle());
  if (existing) return;
  try {
    const profile = await admin.from("profiles").insert({ id: userId, name: s.ownerName, phone: s.phone });
    if (profile.error?.code === "23505") throw new Error("That number is already registered. Try signing in.");
    maybe(profile);
    const shop = check(await admin.from("shops").insert({ owner_id: userId, name: s.shopName }).select("id").single<{ id: string }>());
    maybe(await admin.from("shop_settings").insert({ shop_id: shop.id, report_language: s.language, default_customer_language: s.language }));
  } catch (err) {
    // Deleting the user removes the profile and shop with it, so the email and number can be used again.
    await admin.auth.admin.deleteUser(userId);
    throw err;
  }
}

export const serverApi: ServerApi = {
  getSession: ({ sb }) => currentSession(sb),

  signIn: async ({ sb, now, ip }, { identifier, password }) => {
    const target = parseIdentifier(identifier);
    const keys = signInKeys("email" in target ? target.email : target.phone, ip);
    if (await limited(keys, now)) throw new Error(TOO_MANY);
    let email: string | undefined;
    if ("email" in target) email = target.email;
    else {
      const admin = adminClient();
      const profile = maybe(await admin.from("profiles").select("id").eq("phone", target.phone).maybeSingle<{ id: string }>());
      if (profile) email = (await admin.auth.admin.getUserById(profile.id)).data.user?.email;
    }
    const { error } = email ? await sb.auth.signInWithPassword({ email, password }) : { error: true };
    if (error) {
      await recordFailure(keys);
      throw new Error(WRONG_DETAILS);
    }
    await clearAccount(keys);
    return requireSession(sb);
  },

  signUp: async ({ sb, now, ip }, input) => {
    const form = parseSignUp(input);
    // Every sign-up counts, so one network can't create accounts without end.
    const keys = signUpKeys(ip);
    if (await limited(keys, now)) throw new Error(TOO_MANY);
    await recordFailure(keys);
    const admin = adminClient();
    const taken = maybe(await admin.from("profiles").select("id").eq("phone", form.phone).maybeSingle());
    if (taken) throw new Error("That number is already registered. Try signing in.");
    // An earlier sign-up that never entered its code has no shop yet: start it again.
    const unconfirmed = await admin.rpc("unconfirmed_signup", { p_email: form.email });
    if (typeof unconfirmed.data === "string") {
      const { error } = await admin.auth.admin.deleteUser(unconfirmed.data);
      if (error) throw new Error("Couldn't restart the sign-up. Try again.");
    }
    if (await emailInUse(form.email)) throw new Error("That email is already registered. Try signing in.");

    // The shop is created once the email is confirmed; until then its details wait on the user.
    const signup: PendingShop = { ownerName: form.ownerName, phone: form.phone, shopName: form.shopName, language: form.language };
    const { data, error } = await sb.auth.signUp({ email: form.email, password: form.password, options: { data: { signup } } });
    if (error || !data.user) throw new Error(/already/i.test(error?.message ?? "") ? "That email is already registered. Try signing in." : (error?.message ?? "Couldn't create the account."));
    // With "Confirm email" off in Supabase, the user is signed in already: create the shop now.
    if (!data.session) return { verifyEmail: form.email };
    await createShop(data.user.id, signup);
    return { session: await requireSession(sb) };
  },

  verifySignUp: async ({ sb }, { email, code }) => {
    const token = code.replace(/\D/g, "");
    if (token.length < 6) throw new Error("Enter the code from the email.");
    const { data, error } = await sb.auth.verifyOtp({ email: email.trim().toLowerCase(), token, type: "signup" });
    if (error || !data.user) throw new Error("That code is wrong or has expired. Check the email, or send a new code.");
    const signup = (data.user.user_metadata as { signup?: PendingShop }).signup;
    if (!signup) throw new Error("This sign-up has no shop details. Start again.");
    await createShop(data.user.id, signup);
    return requireSession(sb);
  },

  resendSignUpCode: async ({ sb }, { email }) => {
    const { error } = await sb.auth.resend({ type: "signup", email: email.trim().toLowerCase() });
    if (error) throw new Error(/rate|seconds/i.test(error.message) ? "Wait a minute before asking for another code." : error.message);
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
      if (await emailInUse(form.email, session.user.id)) throw new Error("That email belongs to another account.");
      const { error } = await admin.auth.admin.updateUserById(session.user.id, { email: form.email, email_confirm: true });
      if (error) throw new Error(`Couldn't change the email: ${error.message}`);
    }
    maybe(await sb.from("profiles").update({ name: form.name, phone: form.phone }).eq("id", session.user.id));
    maybe(await sb.from("shops").update({ name: form.shopName, upi_id: form.upiId || null }).eq("id", session.shop.id));
    return requireSession(sb);
  },

  getShop: async ({ sb }) => (await requireSession(sb)).shop,

  updateShop: async ({ sb }, patch) => {
    const { shop } = await requireSession(sb);
    const parsed = ShopSchema.safeParse({ ...shop, ...patch, id: shop.id });
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Check the settings and try again.");
    const next = parsed.data;
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

  changePassword: async ({ sb }, { current, next }) => {
    const session = await requireSession(sb);
    if (next.length < 6) throw new Error("The new password must be at least 6 characters.");
    if (next === current) throw new Error("The new password is the same as the current one.");
    const email = session.user.email;
    if (!email) throw new Error("This account has no email to check the password against.");
    const { error: wrong } = await sb.auth.signInWithPassword({ email, password: current });
    if (wrong) throw new Error("Your current password is wrong.");
    const { error } = await sb.auth.updateUser({ password: next });
    if (error) throw new Error(`Couldn't change the password: ${error.message}`);
    // Anyone signed in elsewhere with the old password is signed out; this device stays signed in.
    await sb.auth.signOut({ scope: "others" });
  },

  addCustomer: async (ctx, input) => {
    const { shop } = await requireSession(ctx.sb);
    const name = input.name.trim();
    if (!name) throw new Error("Enter the customer's name.");
    const phone = input.phone?.trim() ? normalizeIndianMobile(input.phone) : null;
    if (input.phone?.trim() && !phone) throw new Error("Enter a 10-digit Indian mobile number.");
    const result = await ctx.sb
      .from("customers")
      .insert({ shop_id: shop.id, name, name_native: input.nameNative?.trim() || null, phone, language: input.language })
      .select("id")
      .single<{ id: string }>();
    if (result.error?.code === "23505") throw new Error("Another customer already has this number.");
    const { id } = check(result);
    const customer = (await shopData(ctx)).customers.find((c) => c.id === id);
    if (!customer) throw new Error("Customer not found");
    return customer;
  },

  archiveCustomer: async (ctx, id) => {
    const { shop } = await requireSession(ctx.sb);
    const result = await ctx.sb.from("customers").update({ archived_at: iso(ctx.now) }).eq("id", id).is("archived_at", null).select("id");
    if (result.error?.code === "PGRST204" || result.error?.code === "42703") throw new Error("Removing customers needs the 0007 database update.");
    check(result);
    const waiting = check(await ctx.sb.from("calls").select("id").eq("customer_id", id).in("status", ["scheduled", "queued"])) as { id: string }[];
    await cancelCalls(ctx.sb, shop.id, waiting.map((c) => c.id));
  },

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
    const result = await ctx.sb.from("customers").update(row).eq("id", id).select("id").maybeSingle();
    if (result.error?.code === "23505") throw new Error("Another customer already has this number.");
    const updated = maybe(result);
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

  updateEntry: async ({ sb }, id, { amount, items, date }) => {
    await requireSession(sb);
    if (!Number.isInteger(amount) || amount <= 0) throw new Error("Enter an amount above zero.");
    const updated = check(
      await sb.from("ledger_entries").update({ amount, items: items.trim(), entry_date: date }).eq("id", id).is("voided_at", null).select("id"),
    );
    if (updated.length === 0) throw new Error("That entry no longer exists.");
  },

  deleteEntry: async ({ sb, now }, id) => {
    await requireSession(sb);
    check(await sb.from("ledger_entries").update({ voided_at: iso(now) }).eq("id", id).is("voided_at", null).select("id"));
  },

  updatePayment: async ({ sb }, id, { amount, method, date }) => {
    await requireSession(sb);
    if (!Number.isInteger(amount) || amount <= 0) throw new Error("Enter an amount above zero.");
    const change = { amount, method, paid_on: date };
    let result = await sb.from("payments").update(change).eq("id", id).is("voided_at", null).select("id");
    // Before 0006 there are no voided payments, so the check isn't needed.
    if (result.error?.code === "42703") result = await sb.from("payments").update(change).eq("id", id).select("id");
    if (check(result).length === 0) throw new Error("That payment no longer exists.");
  },

  deletePayment: async ({ sb, now }, id) => {
    await requireSession(sb);
    const result = await sb.from("payments").update({ voided_at: iso(now) }).eq("id", id).is("voided_at", null).select("id");
    if (result.error?.code === "PGRST204" || result.error?.code === "42703") throw new Error("Deleting payments needs the 0006 database update.");
    check(result);
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
    if (plan.packCalls > 0) maybe(await ctx.sb.rpc("use_extra_calls", { p_count: plan.packCalls }));
    if (plan.at.getTime() <= ctx.now.getTime() + 60_000) await dialNow();
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

  extractKhata: async (ctx, { source, photo, scanId: givenId, lines, provider }) => {
    const db = await shopData(ctx);
    if (source === "sample") return { result: readSamplePage(db, ctx.now) };
    if (source === "manual" || source === "file") {
      const given = fromInputLines(Array.isArray(lines) ? lines.slice(0, 500) : [], ctx.now);
      if (given.length === 0) throw new Error("Add at least one line with a name and an amount.");
      return { result: { scanId: crypto.randomUUID(), source, rows: toRows(db, given) } };
    }
    if (!aiConfigured()) throw new Error("Reading photos isn't set up yet (GEMINI_API_KEY or META_API_KEY).");
    const scanId = typeof givenId === "string" && UUID.test(givenId) ? givenId : crypto.randomUUID();
    const path = photoPath(db.shop.id, scanId);
    let bytes: Uint8Array;
    let mime: string;
    if (photo instanceof Blob && photo.size > 0) {
      if (photo.size > MAX_PHOTO_BYTES) throw new Error("That photo is too large. Try again with a smaller one.");
      // A new page counts against the plan's photos a day; reading the same page again doesn't.
      const perDay = PLANS[db.shop.plan].photoReadsPerDay;
      if (db.usage.photoReadsToday >= perDay) {
        throw new Error(
          db.shop.plan === "free"
            ? `The free plan reads ${perDay} photos a day. Type the lines in, or see Plans for more.`
            : `That's ${perDay} photos today, the most for one day. Try again tomorrow, or type the lines in.`,
        );
      }
      maybe(await ctx.sb.from("usage_events").insert({ shop_id: db.shop.id, kind: "photo_read" }));
      bytes = new Uint8Array(await photo.arrayBuffer());
      mime = photo.type || "image/jpeg";
      // Kept in the shop's private folder, as evidence if an entry is disputed later, and for the next model to read.
      const stored = await ctx.sb.storage.from("khata-photos").upload(path, bytes, { contentType: mime, upsert: true });
      if (stored.error) console.error("[khata] photo not stored:", stored.error.message);
    } else if (givenId) {
      // A later try, or the same page after the screen was reloaded: read the photo already kept.
      const kept = await ctx.sb.storage.from("khata-photos").download(path);
      if (kept.error || !kept.data) throw new Error("That photo is no longer here. Take or upload it again.");
      bytes = new Uint8Array(await kept.data.arrayBuffer());
      mime = kept.data.type || "image/jpeg";
    } else throw new Error("Choose a photo of the khata page.");

    let read;
    try {
      read = await step(PROVIDERS, provider, "khata photo", async (p) => ({ lines: await p.readKhataPhoto(bytes, mime, toDateKey(ctx.now)), model: p.model() }));
    } catch (err) {
      console.error("[khata] read failed:", err instanceof Error ? err.message : err);
      throw new Error("Couldn't read that photo. Try again in good light, with the whole page in the frame.");
    }
    if ("next" in read) return read;
    if (read.result.lines.length === 0) throw new Error("No entries found on that page. Try a clearer photo.");
    return { result: { scanId, source: "upload", rows: toRows(db, fromReadLines(read.result.lines, ctx.now)), model: read.result.model } };
  },

  readKhataColumns: async ({ sb }, { rows, provider }) => {
    await requireSession(sb);
    if (!aiConfigured()) throw new Error("Reading spreadsheets isn't set up yet (GEMINI_API_KEY or META_API_KEY).");
    const sample = columnSample(Array.isArray(rows) ? rows.filter(Array.isArray) : []);
    if (sample.length === 0) throw new Error("That file is empty.");
    const width = Math.max(...sample.map((r) => r.length));
    const col = (n: number) => (Number.isInteger(n) && n >= 0 && n < width ? n : -1);
    const read = await step(PROVIDERS, provider, "spreadsheet columns", (p) => p.mapColumns(sample));
    if ("next" in read) return read;
    const m = read.result;
    return {
      result: {
        headerRows: Math.min(Math.max(0, Math.round(m.header_rows) || 0), sample.length),
        name: col(m.name),
        nameNative: col(m.name_native),
        amount: col(m.amount),
        paid: col(m.paid),
        items: col(m.items),
        date: col(m.date),
        phone: col(m.phone),
        dateOrder: m.date_order === "mdy" || m.date_order === "ymd" ? m.date_order : "dmy",
      },
    };
  },

  saveKhata: async (ctx, { scanId, source, rows, model }) => {
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
    const photo = source === "upload" && UUID.test(scanId) ? photoPath(db.shop.id, scanId) : null;
    const result = check(
      await ctx.sb.rpc("save_khata_import", {
        p_source: source,
        p_rows: payload,
        p_photo_path: photo,
        p_model: source === "upload" && typeof model === "string" ? model.slice(0, 60) : null,
        // What was saved, after the shopkeeper's corrections, with each field's confidence.
        p_extraction: source === "upload" ? { rows } : null,
      }),
    ) as {
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

  ask: async (ctx, question, provider) => ask(await shopData(ctx), question, ctx.now, (input) => serverApi.scheduleReminders(ctx, input), provider),

  transcribe: async ({ sb }, audio, provider) => {
    await requireSession(sb);
    if (!(audio instanceof Blob) || audio.size === 0) throw new Error("Nothing was recorded. Try again.");
    if (!aiConfigured()) throw new Error("Voice questions aren't set up yet (GEMINI_API_KEY or META_API_KEY).");
    try {
      const bytes = new Uint8Array(await audio.arrayBuffer());
      return await step(PROVIDERS, provider, "transcription", (p) => p.transcribeQuestion(bytes, audio.type || "audio/webm"));
    } catch (err) {
      console.error("[transcribe]", err instanceof Error ? err.message : err);
      throw new Error("Couldn't hear that. Try again, or type your question.");
    }
  },

  getDashboard: async (ctx) => dashboard(await shopData(ctx), ctx.now),
  getDailyReport: async (ctx) => dailyReport(await shopData(ctx), ctx.now),

  sendReportCall: async ({ sb, now }) => {
    const { shop } = await requireSession(sb);
    if (PLANS[shop.plan].summaryCalls === "none") throw new Error("Summary calls come with the Asha plan. See Plans.");
    const row = check(
      await sb
        .from("calls")
        .insert({ shop_id: shop.id, kind: "report", to_number: shop.ownerPhone, language: shop.reportLanguage, status: "scheduled", scheduled_at: iso(now) })
        .select("*")
        .single<CallRow>(),
    );
    await addEvents(sb, shop.id, [row.id], "scheduled", "Evening report to the shopkeeper");
    await dialNow();
    return toCall(row, [{ at: iso(now), status: "scheduled", detail: "Evening report to the shopkeeper" }]);
  },

  getGraph: async (ctx) => graph(await shopData(ctx), ctx.now),

  getPlan: async (ctx) => planUsage(await shopData(ctx), ctx.now),

  setPlan: async (ctx, plan) => {
    const { shop } = await requireSession(ctx.sb);
    if (!PlanIdSchema.safeParse(plan).success) throw new Error("Choose a plan.");
    maybe(await ctx.sb.from("shops").update({ plan }).eq("id", shop.id));
    return planUsage(await shopData(ctx), ctx.now);
  },

  addCallPack: async (ctx) => {
    const { shop } = await requireSession(ctx.sb);
    maybe(await ctx.sb.from("shops").update({ extra_calls: shop.extraCalls + CALL_PACK.calls }).eq("id", shop.id));
    return planUsage(await shopData(ctx), ctx.now);
  },

  logWhatsappReminder: async (ctx, customerId) => {
    const db = await shopData(ctx);
    if (!db.customers.some((c) => c.id === customerId)) throw new Error("Customer not found");
    maybe(await ctx.sb.from("usage_events").insert({ shop_id: db.shop.id, kind: "whatsapp_reminder", customer_id: customerId }));
  },

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
    if (tryCallsReal() && bolnaConfigured()) {
      const shopName = "Maa Tara Variety Stores";
      const userData = {
        customer_name: visitor,
        shop_name: shopName,
        language_name: LANGUAGE_NAMES[language],
        amount_due: "₹350",
        items: "groceries",
        memory: "No previous calls.",
        dispute_note: "There are no open disputes.",
        today: format(now, "EEEE, d MMMM yyyy"),
        upi_id: "maatara.demo@upi",
        max_minutes: 3,
        greeting: reminderGreeting(language, visitor, shopName),
      };
      try {
        const base = { agent_id: agentIds().reminder, recipient_phone_number: number, user_data: userData, bypass_call_guardrails: true };
        await makeCall({ ...base, agent_data: { language: BOLNA_LANGUAGE[language] } }).catch(() => makeCall(base));
      } catch (err) {
        // Free the number's daily slot: no call was placed.
        await admin.from("try_calls").delete().eq("phone", number).eq("called_on", today);
        throw new Error(`The call couldn't be placed. ${err instanceof Error ? err.message : ""}`.trim());
      }
      return { allowed: true, real: true, language };
    }
    const script = buildReminderScript(language === "bn" ? "promise_product" : "promise", {
      now,
      customer: { name: visitor, nameNative: visitor, language },
      amount: 350,
    });
    return { allowed: true, real: false, language, turns: script.turns, extraction: script.extraction };
  },
};
