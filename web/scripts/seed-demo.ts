/**
 * Loads the demo shop (Maa Tara Variety Stores) into Supabase with its login, customers, dues and
 * call history. Running it again replaces the demo shop with a fresh copy dated from today.
 *
 * Runs as `npm run db:seed`.
 */
import "../src/lib/server/timezone";
import { createClient } from "@supabase/supabase-js";
import { DEMO_EMAIL, DEMO_PASSWORD, DEMO_PHONE_E164 } from "../src/lib/demo/account";
import { createSeed } from "../src/lib/demo/seed";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in web/.env.local first.");
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

async function run<T>(label: string, query: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

async function removeOldDemo() {
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`list users: ${error.message}`);
    const old = data.users.find((u) => u.email?.toLowerCase() === DEMO_EMAIL);
    if (old) {
      // Deleting the user removes their profile, shop and everything in it.
      const { error: deleteError } = await admin.auth.admin.deleteUser(old.id);
      if (deleteError) throw new Error(`delete old demo user: ${deleteError.message}`);
      return;
    }
    if (data.users.length < 200) return;
  }
}

async function main() {
  const now = new Date();
  const seed = createSeed(now);
  await removeOldDemo();

  const created = await admin.auth.admin.createUser({ email: DEMO_EMAIL, password: DEMO_PASSWORD, email_confirm: true });
  if (created.error || !created.data.user) throw new Error(`create demo user: ${created.error?.message}`);
  const userId = created.data.user.id;

  // The seed labels rows "c01", "k05"...; the database wants UUIDs.
  const ids = new Map<string, string>();
  const id = (label: string) => {
    if (!ids.has(label)) ids.set(label, crypto.randomUUID());
    return ids.get(label)!;
  };
  const shopId = id(seed.shop.id);
  const { shop } = seed;

  await run("profile", admin.from("profiles").insert({ id: userId, name: shop.ownerName, phone: DEMO_PHONE_E164 }));
  await run("shop", admin.from("shops").insert({ id: shopId, owner_id: userId, name: shop.name, upi_id: shop.upiId }));
  await run(
    "settings",
    admin.from("shop_settings").insert({
      shop_id: shopId,
      calling_start: shop.callingHours.start,
      calling_end: shop.callingHours.end,
      reminder_gap_days: shop.reminderGapDays,
      max_call_minutes: shop.maxCallMinutes,
      default_customer_language: shop.defaultCustomerLanguage,
      report_enabled: shop.reportEnabled,
      report_time: shop.reportTime,
      report_language: shop.reportLanguage,
      demo_bypass_hours: shop.demoBypassHours,
    }),
  );

  await run(
    "customers",
    admin.from("customers").insert(
      seed.customers.map((c) => ({
        id: id(c.id),
        shop_id: shopId,
        name: c.name,
        name_native: c.nameNative ?? null,
        phone: c.phone || null,
        language: c.language,
        opted_out_at: c.optedOut ? now.toISOString() : null,
        created_at: c.createdAt,
      })),
    ),
  );
  for (const c of seed.customers.filter((x) => x.paysThroughId)) {
    await run("pays through", admin.from("customers").update({ pays_through_id: id(c.paysThroughId!) }).eq("id", id(c.id)));
  }

  await run(
    "entries",
    admin.from("ledger_entries").insert(
      seed.entries.map((e) => ({
        id: id(e.id),
        shop_id: shopId,
        customer_id: id(e.customerId),
        amount: e.amount,
        items: e.items,
        entry_date: e.date,
        source: e.source,
        created_at: e.createdAt,
      })),
    ),
  );
  await run(
    "payments",
    admin.from("payments").insert(
      seed.payments.map((p) => ({ id: id(p.id), shop_id: shopId, customer_id: id(p.customerId), amount: p.amount, method: p.method, paid_on: p.date, created_at: p.createdAt })),
    ),
  );

  await run(
    "batches",
    admin.from("reminder_batches").insert(
      seed.batches.map((b) => ({ id: id(b.id), shop_id: shopId, scheduled_at: b.scheduledAt, language: b.language === "auto" ? null : b.language, created_at: b.createdAt })),
    ),
  );
  await run(
    "calls",
    admin.from("calls").insert(
      seed.calls.map((k) => ({
        id: id(k.id),
        shop_id: shopId,
        kind: k.kind,
        customer_id: k.customerId ? id(k.customerId) : null,
        batch_id: k.batchId ? id(k.batchId) : null,
        to_number: k.toNumber ?? null,
        language: k.language,
        status: k.status,
        outcome: k.extraction?.outcome ?? null,
        scheduled_at: k.scheduledAt,
        dispatched_at: k.startedAt ?? null,
        started_at: k.startedAt ?? null,
        answered_at: k.answeredAt ?? null,
        ended_at: k.endedAt ?? null,
        duration_sec: k.durationSec ?? null,
        cost_usd: k.costUsd ?? null,
        transcript: k.transcript,
        extraction: k.extraction ?? null,
        created_at: k.scheduledAt,
      })),
    ),
  );
  await run(
    "call events",
    admin.from("call_events").insert(
      seed.calls.flatMap((k) => k.events.map((e) => ({ call_id: id(k.id), shop_id: shopId, status: e.status, detail: e.detail ?? null, at: e.at }))),
    ),
  );

  await run(
    "promises",
    admin.from("promises").insert(
      seed.promises.map((p) => ({
        id: id(p.id),
        shop_id: shopId,
        customer_id: id(p.customerId),
        call_id: p.callId ? id(p.callId) : null,
        amount: p.amount,
        due_date: p.dueDate,
        // Kept promises were paid on their due date.
        kept_at: p.status === "kept" ? new Date(`${p.dueDate}T18:00:00`).toISOString() : null,
        created_at: p.createdAt,
      })),
    ),
  );
  await run(
    "disputes",
    admin.from("disputes").insert(
      seed.disputes.map((d) => ({
        id: id(d.id),
        shop_id: shopId,
        customer_id: id(d.customerId),
        call_id: d.callId ? id(d.callId) : null,
        kind: d.kind,
        reason: d.reason,
        amount: d.amount ?? null,
        resolved_at: d.status === "resolved" ? d.createdAt : null,
        created_at: d.createdAt,
      })),
    ),
  );
  await run(
    "notes",
    admin.from("notes").insert(
      seed.notes.map((n) => ({
        id: id(n.id),
        shop_id: shopId,
        customer_id: id(n.customerId),
        call_id: n.callId ? id(n.callId) : null,
        kind: n.kind,
        text: n.text,
        product: n.product ?? null,
        created_at: n.createdAt,
      })),
    ),
  );

  console.log(`Demo shop ready: ${seed.customers.length} customers, ${seed.calls.length} past calls. Sign in with ${DEMO_EMAIL} / ${DEMO_PASSWORD}.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
