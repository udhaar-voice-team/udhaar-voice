import type { SupabaseClient } from "@supabase/supabase-js";
import { batchStatus, toDateKey } from "@/lib/domain/rules";
import type {
  Call,
  CallEvent,
  CallStatus,
  Customer,
  Dispute,
  KhataImport,
  Language,
  LedgerEntry,
  Note,
  Payment,
  PaymentPromise,
  ReminderBatch,
  Shop,
} from "@/lib/domain/types";
import { check, maybe } from "./supabase";

/** A call holding or waiting for one of the lines every shop shares. */
export type LineCall = { id: string; shopId: string; scheduledAt: string; status: CallStatus };

/**
 * Everything one shop owns, in the shapes the screens use. Queries (lib/server/queries.ts) are pure
 * functions over this, so they can be tested without a database.
 */
export type ShopData = {
  shop: Shop;
  customers: Customer[];
  /** Voided entries (from undone imports) are left out. */
  entries: LedgerEntry[];
  payments: Payment[];
  promises: PaymentPromise[];
  disputes: Dispute[];
  notes: Note[];
  calls: Call[];
  batches: ReminderBatch[];
  /** Imports that haven't been undone. */
  imports: KhataImport[];
  /** Calls of every shop holding or waiting for a line. */
  lines: { lines: number; onLine: LineCall[]; waiting: LineCall[] };
};

/* ---------------------------------------------------------------- rows as Postgres returns them */

export type ShopRow = { id: string; owner_id: string; name: string; upi_id: string | null };
export type SettingsRow = {
  shop_id: string;
  calling_start: number;
  calling_end: number;
  reminder_gap_days: number;
  max_call_minutes: number;
  default_customer_language: Language;
  report_enabled: boolean;
  report_time: string;
  report_language: Language;
  demo_bypass_hours: boolean;
};
export type ProfileRow = { id: string; name: string; phone: string; created_at: string };
type CustomerRow = {
  id: string;
  shop_id: string;
  name: string;
  name_native: string | null;
  phone: string | null;
  language: Language;
  opted_out_at: string | null;
  pays_through_id: string | null;
  created_at: string;
};
type EntryRow = {
  id: string;
  customer_id: string;
  amount: number;
  items: string;
  entry_date: string;
  source: LedgerEntry["source"];
  import_id: string | null;
  voided_at: string | null;
  created_at: string;
};
type PaymentRow = { id: string; customer_id: string; amount: number; method: Payment["method"]; paid_on: string; created_at: string };
type PromiseRow = { id: string; customer_id: string; call_id: string | null; amount: number; due_date: string; kept_at: string | null; created_at: string };
type DisputeRow = {
  id: string;
  customer_id: string;
  call_id: string | null;
  kind: Dispute["kind"];
  reason: string;
  amount: number | null;
  resolved_at: string | null;
  created_at: string;
};
type NoteRow = { id: string; customer_id: string; call_id: string | null; kind: Note["kind"]; text: string; product: string | null; created_at: string };
export type CallRow = {
  id: string;
  shop_id: string;
  kind: Call["kind"];
  customer_id: string | null;
  batch_id: string | null;
  to_number: string | null;
  language: Language;
  status: CallStatus;
  scheduled_at: string;
  started_at: string | null;
  answered_at: string | null;
  ended_at: string | null;
  duration_sec: number | null;
  cost_usd: number | string | null;
  transcript: Call["transcript"] | null;
  extraction: Call["extraction"] | null;
  created_at: string;
};
type EventRow = { call_id: string; status: CallStatus; detail: string | null; at: string };
type BatchRow = { id: string; shop_id: string; scheduled_at: string; language: Language | null; created_at: string };
type ImportRow = { id: string; shop_id: string; source: KhataImport["source"]; undone_at: string | null; created_at: string };
type ChangeRow = {
  import_id: string;
  kind: "entry_added" | "entry_updated" | "customer_added";
  entry_id: string | null;
  customer_id: string | null;
  previous_amount: number | null;
  previous_items: string | null;
};

/* ---------------------------------------------------------------- mapping */

const opt = <T>(value: T | null): T | undefined => value ?? undefined;

export function toShop(shop: ShopRow, settings: SettingsRow, owner: ProfileRow): Shop {
  return {
    id: shop.id,
    ownerUserId: shop.owner_id,
    name: shop.name,
    ownerName: owner.name,
    ownerPhone: owner.phone,
    upiId: shop.upi_id ?? "",
    defaultCustomerLanguage: settings.default_customer_language,
    callingHours: { start: settings.calling_start, end: settings.calling_end },
    reminderGapDays: settings.reminder_gap_days,
    maxCallMinutes: settings.max_call_minutes,
    reportEnabled: settings.report_enabled,
    reportTime: settings.report_time.slice(0, 5),
    reportLanguage: settings.report_language,
    demoBypassHours: settings.demo_bypass_hours,
  };
}

const toCustomer = (r: CustomerRow): Customer => ({
  id: r.id,
  shopId: r.shop_id,
  name: r.name,
  nameNative: opt(r.name_native),
  phone: r.phone ?? "",
  language: r.language,
  optedOut: r.opted_out_at !== null,
  paysThroughId: opt(r.pays_through_id),
  createdAt: r.created_at,
});

const toEntry = (r: EntryRow): LedgerEntry => ({
  id: r.id,
  customerId: r.customer_id,
  amount: r.amount,
  items: r.items,
  date: r.entry_date,
  source: r.source,
  importId: opt(r.import_id),
  createdAt: r.created_at,
});

const toPayment = (r: PaymentRow): Payment => ({
  id: r.id,
  customerId: r.customer_id,
  amount: r.amount,
  method: r.method,
  date: r.paid_on,
  createdAt: r.created_at,
});

/**
 * A promise is kept once a payment covers it. An unkept promise past its date is "open" (and shows as
 * overdue) until the customer makes a newer promise, which replaces it; then it is "broken".
 */
export function toPromises(rows: PromiseRow[], now: Date): PaymentPromise[] {
  const today = toDateKey(now);
  return rows.map((r) => {
    const replaced = rows.some((n) => n.customer_id === r.customer_id && n.created_at > r.created_at);
    const status = r.kept_at ? "kept" : r.due_date < today && replaced ? "broken" : "open";
    return { id: r.id, customerId: r.customer_id, callId: opt(r.call_id), amount: r.amount, dueDate: r.due_date, status, createdAt: r.created_at };
  });
}

const toDispute = (r: DisputeRow): Dispute => ({
  id: r.id,
  customerId: r.customer_id,
  callId: opt(r.call_id),
  kind: r.kind,
  reason: r.reason,
  amount: opt(r.amount),
  status: r.resolved_at ? "resolved" : "open",
  createdAt: r.created_at,
});

const toNote = (r: NoteRow): Note => ({
  id: r.id,
  customerId: r.customer_id,
  callId: opt(r.call_id),
  kind: r.kind,
  text: r.text,
  product: opt(r.product),
  createdAt: r.created_at,
});

export function toCall(r: CallRow, events: CallEvent[]): Call {
  return {
    id: r.id,
    shopId: r.shop_id,
    kind: r.kind,
    customerId: opt(r.customer_id),
    batchId: opt(r.batch_id),
    toNumber: opt(r.to_number),
    language: r.language,
    status: r.status,
    scheduledAt: r.scheduled_at,
    startedAt: opt(r.started_at),
    answeredAt: opt(r.answered_at),
    endedAt: opt(r.ended_at),
    durationSec: opt(r.duration_sec),
    costUsd: r.cost_usd === null ? undefined : Number(r.cost_usd),
    transcript: r.transcript ?? [],
    extraction: opt(r.extraction),
    events,
  };
}

/* ---------------------------------------------------------------- loading */

/** PostgREST returns at most 1,000 rows per request, so read in pages. */
async function all<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const PAGE = 1000;
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const page = maybe(await query(from, from + PAGE - 1)) ?? [];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

/** The signed-in user's shop row with its settings and owner, or null when nobody is signed in. */
export async function loadShop(sb: SupabaseClient, userId: string): Promise<{ shop: Shop; owner: ProfileRow } | null> {
  const [profile, shop] = await Promise.all([
    sb.from("profiles").select("id, name, phone, created_at").eq("id", userId).maybeSingle<ProfileRow>(),
    sb.from("shops").select("id, owner_id, name, upi_id").eq("owner_id", userId).maybeSingle<ShopRow>(),
  ]);
  const owner = maybe(profile);
  const shopRow = maybe(shop);
  if (!owner || !shopRow) return null;
  const settings = check(await sb.from("shop_settings").select("*").eq("shop_id", shopRow.id).single<SettingsRow>());
  return { shop: toShop(shopRow, settings, owner), owner };
}

/** Calls of every shop on a line or waiting for one. Needs the admin client: lines are shared. */
export async function loadLines(admin: SupabaseClient, lines: number): Promise<ShopData["lines"]> {
  const rows = check(
    await admin
      .from("calls")
      .select("id, shop_id, scheduled_at, status")
      .in("status", ["queued", "ringing", "in_progress"])
      .returns<{ id: string; shop_id: string; scheduled_at: string; status: CallStatus }[]>(),
  );
  const toLine = (r: (typeof rows)[number]): LineCall => ({ id: r.id, shopId: r.shop_id, scheduledAt: r.scheduled_at, status: r.status });
  return {
    lines,
    onLine: rows.filter((r) => r.status !== "queued").map(toLine),
    waiting: rows.filter((r) => r.status === "queued").map(toLine),
  };
}

export async function loadShopData(sb: SupabaseClient, shop: Shop, lines: ShopData["lines"], now: Date): Promise<ShopData> {
  const id = shop.id;
  const table = <T>(name: string, columns = "*", order = "created_at") =>
    all<T>((from, to) => sb.from(name).select(columns).eq("shop_id", id).order(order).order("id").range(from, to).returns<T[]>());

  const [customers, entries, payments, promises, disputes, notes, calls, events, batches, imports, changes] = await Promise.all([
    table<CustomerRow>("customers"),
    table<EntryRow>("ledger_entries"),
    table<PaymentRow>("payments"),
    table<PromiseRow>("promises"),
    table<DisputeRow>("disputes"),
    table<NoteRow>("notes"),
    table<CallRow>("calls"),
    table<EventRow>("call_events", "call_id, status, detail, at", "at"),
    table<BatchRow>("reminder_batches"),
    table<ImportRow>("khata_imports"),
    table<ChangeRow>("khata_import_changes", "import_id, kind, entry_id, customer_id, previous_amount, previous_items", "import_id"),
  ]);

  const eventsByCall = new Map<string, CallEvent[]>();
  for (const e of events) {
    eventsByCall.set(e.call_id, [...(eventsByCall.get(e.call_id) ?? []), { at: e.at, status: e.status, detail: opt(e.detail) }]);
  }
  const mappedCalls = calls.map((c) => toCall(c, eventsByCall.get(c.id) ?? []));

  const mappedBatches = batches.map((b): ReminderBatch => {
    const own = mappedCalls.filter((c) => c.batchId === b.id);
    return {
      id: b.id,
      shopId: b.shop_id,
      scheduledAt: b.scheduled_at,
      language: b.language ?? "auto",
      callIds: own.map((c) => c.id),
      status: batchStatus(own.map((c) => c.status)),
      createdAt: b.created_at,
    };
  });

  const mappedImports = imports
    .filter((i) => !i.undone_at)
    .map((i): KhataImport => {
      const own = changes.filter((c) => c.import_id === i.id);
      return {
        id: i.id,
        shopId: i.shop_id,
        source: i.source,
        createdAt: i.created_at,
        entryIds: own.flatMap((c) => (c.kind === "entry_added" && c.entry_id ? [c.entry_id] : [])),
        customerIds: own.flatMap((c) => (c.kind === "customer_added" && c.customer_id ? [c.customer_id] : [])),
        updates: own.flatMap((c) =>
          c.kind === "entry_updated" && c.entry_id
            ? [{ entryId: c.entry_id, previous: { amount: c.previous_amount ?? 0, items: c.previous_items ?? "" } }]
            : [],
        ),
      };
    });

  return {
    shop,
    customers: customers.map(toCustomer),
    entries: entries.filter((e) => !e.voided_at).map(toEntry),
    payments: payments.map(toPayment),
    promises: toPromises(promises, now),
    disputes: disputes.map(toDispute),
    notes: notes.map(toNote),
    calls: mappedCalls,
    batches: mappedBatches,
    imports: mappedImports,
    lines,
  };
}
