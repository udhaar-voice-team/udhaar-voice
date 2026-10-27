import { toDateKey } from "@/lib/domain/rules";
import type { Call, CallEvent, Customer, Language, LedgerEntry, Payment, PaymentPromise, ReminderBatch } from "@/lib/domain/types";
import type { ShopData } from "@/lib/server/data";
import { DEMO_PHONE_E164 } from "./account";
import { addDays, buildReminderScript, transcriptSeconds, type Persona } from "./scripts";

/**
 * The demo shop and its history, loaded into Supabase by `npm run db:seed`. Every date is relative
 * to "now", so the demo always looks current. Phone numbers are fake and always shown masked.
 * IDs here are labels; the seed script gives each row a real UUID.
 */

export const SHOP_ID = "s1";
export const DEMO_USER_ID = "u-demo";
export const COST_PER_MINUTE_USD = 0.06;

export type DemoShop = Omit<ShopData, "lines" | "imports">;

type SeedCustomer = {
  id: string;
  name: string;
  nameNative: string;
  language: Language;
  persona: Persona;
  entries: [amount: number, items: string, daysAgo: number][];
  payments?: [amount: number, method: Payment["method"], daysAgo: number][];
  paysThroughId?: string;
};

const CUSTOMERS: SeedCustomer[] = [
  // Ramesh's rice entry from yesterday is overwritten on the sample khata page (₹120 → ₹150).
  { id: "c01", name: "Ramesh Yadav", nameNative: "रमेश यादव", language: "hi", persona: "promise",
    entries: [[200, "Groceries", 30], [120, "Rice 2 kg", 1], [230, "Atta 5 kg, sugar 1 kg", 9]], payments: [[200, "upi", 25]] },
  { id: "c02", name: "Sunita Das", nameNative: "সুনীতা দাস", language: "bn", persona: "salary",
    entries: [[1240, "Milk for the month (31 × ₹40)", 5]] },
  { id: "c03", name: "Bapi Mondal", nameNative: "বাপি মণ্ডল", language: "bn", persona: "callback",
    entries: [[95, "Cigarettes, biscuits", 12]] },
  { id: "c04", name: "Arijit Ghosh", nameNative: "অরিজিৎ ঘোষ", language: "bn", persona: "upi_tonight",
    entries: [[60, "Photocopy, 40 pages", 8], [120, "Notebook, pens", 4]] },
  { id: "c05", name: "Priya Sharma", nameNative: "प्रिया शर्मा", language: "hi", persona: "dispute_paid",
    entries: [[420, "Groceries", 21], [200, "Soap, detergent", 14]] },
  { id: "c06", name: "Rahul Verma", nameNative: "राहुल वर्मा", language: "hi", persona: "no_answer",
    entries: [[240, "Maggi ×6, cold drink", 10]] },
  { id: "c07", name: "Mousumi Roy", nameNative: "মৌসুমী রায়", language: "bn", persona: "partial",
    entries: [[1190, "Groceries (two weeks)", 16]], payments: [[300, "cash", 5]] },
  { id: "c08", name: "Tapas Biswas", nameNative: "তাপস বিশ্বাস", language: "bn", persona: "refuse",
    entries: [[960, "Rice 10 kg", 35], [600, "Oil, dal", 26]] },
  { id: "c09", name: "Imran Sheikh", nameNative: "ইমরান শেখ", language: "bn", persona: "promise_product",
    entries: [[530, "Groceries, Maggi ×4", 11]], payments: [[100, "cash", 0]] },
  { id: "c10", name: "Anjali Singh", nameNative: "अंजलि सिंह", language: "hi", persona: "opt_out",
    entries: [[310, "Groceries", 13]] },
  { id: "c11", name: "Sourav Paul", nameNative: "সৌরভ পাল", language: "bn", persona: "wrong_number",
    entries: [[75, "Cold drink, chips", 7]] },
  { id: "c12", name: "Rina Halder", nameNative: "রিনা হালদার", language: "bn", persona: "family_mother", paysThroughId: "c15",
    entries: [[700, "Groceries", 20], [350, "Rice 5 kg", 9]] },
  { id: "c13", name: "Deepak Kumar", nameNative: "दीपक कुमार", language: "hi", persona: "repeat_breaker",
    entries: [[1500, "Groceries (month)", 40], [900, "Atta 10 kg, oil", 28]] },
  { id: "c14", name: "Pinki Sarkar", nameNative: "পিঙ্কি সরকার", language: "bn", persona: "paid_up",
    entries: [[540, "Groceries", 25]], payments: [[540, "cash", 3]] },
  { id: "c15", name: "Sanjay Halder", nameNative: "সঞ্জয় হালদার", language: "bn", persona: "family_son",
    entries: [[200, "Bread, eggs, milk", 6]], payments: [[80, "upi", 1]] },
];

type SeedCall = {
  id: string;
  customerId: string;
  daysAgo: number;
  at: [hour: number, minute: number];
  amount: number;
  batchId?: string;
  /** What happened to the promise captured on this call, as of today. */
  promiseStatus?: PaymentPromise["status"];
};

const PAST_CALLS: SeedCall[] = [
  { id: "k01", customerId: "c01", daysAgo: 27, at: [11, 10], amount: 200, promiseStatus: "kept" },
  { id: "k02", customerId: "c13", daysAgo: 26, at: [18, 5], amount: 2400, promiseStatus: "broken" },
  { id: "k03", customerId: "c13", daysAgo: 10, at: [17, 20], amount: 2400, promiseStatus: "open" },
  { id: "k04", customerId: "c14", daysAgo: 9, at: [17, 40], amount: 540, promiseStatus: "kept" },
  { id: "k05", customerId: "c02", daysAgo: 3, at: [17, 30], amount: 1240, batchId: "b1", promiseStatus: "open" },
  { id: "k06", customerId: "c06", daysAgo: 3, at: [17, 31], amount: 240, batchId: "b1" },
  { id: "k07", customerId: "c08", daysAgo: 3, at: [17, 33], amount: 1560, batchId: "b1" },
  { id: "k08", customerId: "c10", daysAgo: 3, at: [17, 35], amount: 310, batchId: "b1" },
  { id: "k09", customerId: "c11", daysAgo: 3, at: [17, 37], amount: 75, batchId: "b1" },
  { id: "k10", customerId: "c05", daysAgo: 2, at: [12, 15], amount: 620, promiseStatus: "open" },
];

const phoneFor = (index: number) => `+9190000001${String(index).padStart(2, "0")}`;

function at(now: Date, daysAgo: number, hour = 10, minute = 0): Date {
  const d = addDays(now, -daysAgo);
  d.setHours(hour, minute, 0, 0);
  return d;
}

const plus = (d: Date, seconds: number) => new Date(d.getTime() + seconds * 1000).toISOString();

export function createSeed(now: Date = new Date()): DemoShop {
  const created = at(now, 60).toISOString();
  const customers: Customer[] = CUSTOMERS.map((c, i) => ({
    id: c.id,
    shopId: SHOP_ID,
    name: c.name,
    nameNative: c.nameNative,
    phone: phoneFor(i + 1),
    language: c.language,
    optedOut: false,
    paysThroughId: c.paysThroughId,
    createdAt: created,
  }));

  const entries: LedgerEntry[] = CUSTOMERS.flatMap((c) =>
    c.entries.map(([amount, items, daysAgo], i) => ({
      id: `${c.id}-e${i + 1}`,
      customerId: c.id,
      amount,
      items,
      date: toDateKey(at(now, daysAgo)),
      source: "manual" as const,
      createdAt: at(now, daysAgo, 18).toISOString(),
    })),
  );

  const payments: Payment[] = CUSTOMERS.flatMap((c) =>
    (c.payments ?? []).map(([amount, method, daysAgo], i) => ({
      id: `${c.id}-p${i + 1}`,
      customerId: c.id,
      amount,
      method,
      date: toDateKey(at(now, daysAgo)),
      createdAt: at(now, daysAgo, daysAgo === 0 ? Math.min(now.getHours(), 11) : 19).toISOString(),
    })),
  );

  const db: DemoShop = {
    shop: {
      id: SHOP_ID,
      ownerUserId: DEMO_USER_ID,
      name: "Maa Tara Variety Stores",
      ownerName: "Gopal Saha",
      ownerPhone: DEMO_PHONE_E164,
      upiId: "maatara.demo@upi",
      defaultCustomerLanguage: "bn",
      callingHours: { start: 8, end: 19 },
      reminderGapDays: 3,
      maxCallMinutes: 3,
      reportEnabled: true,
      reportTime: "20:00",
      reportLanguage: "bn",
      demoBypassHours: false,
    },
    customers,
    entries,
    payments,
    promises: [],
    disputes: [],
    notes: [],
    calls: [],
    batches: [],
  };

  for (const sc of PAST_CALLS) addPastCall(db, sc, now);

  const b1Calls = PAST_CALLS.filter((c) => c.batchId === "b1").map((c) => c.id);
  const b1: ReminderBatch = {
    id: "b1",
    shopId: SHOP_ID,
    scheduledAt: at(now, 3, 17, 30).toISOString(),
    language: "auto",
    callIds: b1Calls,
    status: "completed",
    createdAt: at(now, 3, 17, 10).toISOString(),
  };
  db.batches.push(b1);

  // The opt-out from the batch call above.
  const anjali = db.customers.find((c) => c.id === "c10");
  if (anjali) anjali.optedOut = true;

  return db;
}

const PERSONAS: Record<string, Persona> = Object.fromEntries(CUSTOMERS.map((c) => [c.id, c.persona]));

function addPastCall(db: DemoShop, sc: SeedCall, now: Date) {
  const customer = db.customers.find((c) => c.id === sc.customerId);
  if (!customer) return;
  const start = at(now, sc.daysAgo, sc.at[0], sc.at[1]);
  const persona = PERSONAS[customer.id];
  const missed = db.promises
    .filter((p) => p.customerId === customer.id && p.status === "broken")
    .map((p) => ({ amount: p.amount, dueDate: p.dueDate }));

  const script = buildReminderScript(persona, {
    now: start,
    customer: { name: customer.name, nameNative: customer.nameNative, language: customer.language },
    amount: sc.amount,
    missedPromises: missed,
  });

  const talk = transcriptSeconds(script.turns);
  const events: CallEvent[] = [
    { at: plus(start, -60), status: "scheduled" },
    { at: plus(start, 0), status: "queued" },
    { at: plus(start, 2), status: "ringing", detail: "Calling from Bolna's shared +91 number" },
  ];
  const call: Call = {
    id: sc.id,
    shopId: db.shop.id,
    kind: "reminder",
    customerId: customer.id,
    batchId: sc.batchId,
    toNumber: customer.phone,
    language: customer.language,
    status: script.answered ? "completed" : "no_answer",
    scheduledAt: plus(start, -60),
    startedAt: plus(start, 2),
    transcript: script.turns,
    extraction: script.extraction,
    events,
  };

  if (script.answered) {
    call.answeredAt = plus(start, 8);
    call.endedAt = plus(start, 8 + talk);
    call.durationSec = talk + 6;
    call.costUsd = Math.round(((talk + 6) / 60) * COST_PER_MINUTE_USD * 1000) / 1000;
    events.push({ at: call.answeredAt, status: "in_progress" });
    events.push({ at: call.endedAt, status: "completed", detail: "Transcript and extraction received by webhook" });
  } else {
    call.endedAt = plus(start, 32);
    call.durationSec = 0;
    call.costUsd = 0;
    events.push({ at: call.endedAt, status: "no_answer", detail: "No answer after 30 s. Auto-retry in 30 min." });
  }
  db.calls.push(call);

  const ex = script.extraction;
  ex.promises.forEach((p, i) =>
    db.promises.push({
      id: `${sc.id}-pr${i + 1}`,
      customerId: customer.id,
      callId: sc.id,
      amount: p.amount,
      dueDate: p.dueDate,
      status: sc.promiseStatus ?? "open",
      createdAt: call.endedAt ?? call.scheduledAt,
    }),
  );
  if (ex.dispute)
    db.disputes.push({
      id: `${sc.id}-d1`,
      customerId: customer.id,
      callId: sc.id,
      kind: ex.dispute.kind,
      reason: ex.dispute.reason,
      amount: ex.dispute.amount,
      status: "open",
      createdAt: call.endedAt ?? call.scheduledAt,
    });
  ex.notes.forEach((n, i) =>
    db.notes.push({
      id: `${sc.id}-n${i + 1}`,
      customerId: customer.id,
      callId: sc.id,
      kind: n.kind,
      text: n.text,
      product: n.product,
      createdAt: call.endedAt ?? call.scheduledAt,
    }),
  );
}
