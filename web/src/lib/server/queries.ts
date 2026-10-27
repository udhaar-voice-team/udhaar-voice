import { addDays, format, parseISO } from "date-fns";
import {
  balanceOf,
  buildMemory,
  canChangeBatchTime,
  canRemind,
  confidenceLabel,
  customerStatus,
  dialOrder,
  estimatedWaitSeconds,
  formatINR,
  isPromiseBroken,
  nextReminderDate,
  toDateKey,
} from "@/lib/domain/rules";
import type { Call, CallStatus, Customer, Turn } from "@/lib/domain/types";
import type {
  AttentionItem,
  BatchSummary,
  CallDetail,
  CallListItem,
  CustomerDetail,
  CustomerSummary,
  DailyReport,
  DashboardData,
  EligibleCustomer,
  GraphData,
  GraphEdge,
  GraphNode,
  QueueSpot,
} from "@/lib/api/contract";
import { buildReportScript } from "@/lib/demo/scripts";
import type { ShopData } from "./data";

/** What each screen shows, worked out from one shop's rows. Pure: no I/O, no clock reads. */

export const fmtDay = (isoDate: string) => format(parseISO(isoDate), "EEE d MMM");

const ACTIVE: CallStatus[] = ["scheduled", "queued", "ringing", "in_progress"];
export const isActiveCall = (s: CallStatus) => ACTIVE.includes(s);

const byNewest = (a: Call, b: Call) => (b.startedAt ?? b.scheduledAt).localeCompare(a.startedAt ?? a.scheduledAt);

function customerCalls(db: ShopData, customerId: string): Call[] {
  return db.calls.filter((k) => k.customerId === customerId && k.kind === "reminder").sort(byNewest);
}

export function customerSummary(db: ShopData, c: Customer, now: Date): CustomerSummary {
  const entries = db.entries.filter((e) => e.customerId === c.id);
  const payments = db.payments.filter((p) => p.customerId === c.id);
  const promises = db.promises.filter((p) => p.customerId === c.id);
  const disputes = db.disputes.filter((d) => d.customerId === c.id);
  const balance = balanceOf(entries, payments);
  const calls = customerCalls(db, c.id);
  const latest = calls[0];
  // Only an answered call counts as a reminder; Bolna's auto-retry covers unanswered ones.
  const lastAnswered = calls.find((k) => k.status === "completed");
  return {
    customer: c,
    balance,
    status: customerStatus({ balance, optedOut: c.optedOut, promises, disputes }, now),
    lastCall: latest
      ? { id: latest.id, at: latest.startedAt ?? latest.scheduledAt, status: latest.status, outcome: latest.extraction?.outcome }
      : undefined,
    lastReminderAt: lastAnswered?.startedAt,
    nextPromise: promises.filter((p) => p.status === "open").sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0],
    openDispute: disputes.filter((d) => d.status === "open").sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0],
  };
}

export function summaries(db: ShopData, now: Date): CustomerSummary[] {
  const order: Record<CustomerSummary["status"], number> = { overdue: 0, disputed: 1, due: 2, promised: 3, opted_out: 4, paid: 5 };
  return db.customers
    .map((c) => customerSummary(db, c, now))
    .sort((a, b) => order[a.status] - order[b.status] || b.balance - a.balance);
}

export function customerDetail(db: ShopData, id: string, now: Date): CustomerDetail | null {
  const c = db.customers.find((x) => x.id === id);
  if (!c) return null;
  const summary = customerSummary(db, c, now);
  const promises = db.promises.filter((p) => p.customerId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const disputes = db.disputes.filter((d) => d.customerId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const notes = db.notes.filter((n) => n.customerId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return {
    ...summary,
    entries: db.entries.filter((e) => e.customerId === id).sort((a, b) => b.date.localeCompare(a.date)),
    payments: db.payments.filter((p) => p.customerId === id).sort((a, b) => b.date.localeCompare(a.date)),
    promises,
    disputes,
    notes,
    calls: customerCalls(db, id),
    memory: buildMemory({ promises, disputes, notes }, now, fmtDay),
    paysThrough: c.paysThroughId ? db.customers.find((x) => x.id === c.paysThroughId) : undefined,
    paysFor: db.customers.filter((x) => x.paysThroughId === id),
  };
}

/** After a customer refuses, leave them alone for this long. */
export const REFUSAL_COOLDOWN_DAYS = 14;

/** Who can be called now, and why not for the rest. */
export function candidates(db: ShopData, now: Date): EligibleCustomer[] {
  return summaries(db, now).map((s) => {
    const c = s.customer;
    const active = db.calls.some((k) => k.customerId === c.id && isActiveCall(k.status));
    const lastAnswered = customerCalls(db, c.id).find((k) => k.status === "completed");
    const lastOutcome = lastAnswered?.extraction?.outcome;
    const refusedUntil =
      lastOutcome === "refused" && lastAnswered?.endedAt ? addDays(new Date(lastAnswered.endedAt), REFUSAL_COOLDOWN_DAYS) : undefined;

    let reason: string | undefined;
    if (s.balance <= 0) reason = "Nothing due";
    else if (c.optedOut) reason = "Asked not to be called";
    else if (!c.phone) reason = "No phone number";
    else if (active) reason = "Already scheduled";
    else if (lastOutcome === "wrong_number" && lastAnswered?.toNumber === c.phone) reason = "Last call reached someone else. Update the number first.";
    else if (refusedUntil && refusedUntil > now) reason = `Said they'll settle in person. No calls until ${fmtDay(refusedUntil.toISOString())}.`;
    // A customer who asked to be called back is not held to the reminder gap.
    else if (lastOutcome !== "callback" && s.lastReminderAt && !canRemind(new Date(s.lastReminderAt), db.shop.reminderGapDays, now)) {
      const next = nextReminderDate(new Date(s.lastReminderAt), db.shop.reminderGapDays);
      reason = `Reminded ${fmtDay(s.lastReminderAt)}; next allowed ${fmtDay(next.toISOString())}`;
    }
    const callbackAt = lastOutcome === "callback" ? lastAnswered?.extraction?.callbackAt : undefined;
    const note = s.openDispute
      ? `Open dispute. The agent won't ask for the disputed ${s.openDispute.amount ? formatINR(s.openDispute.amount) : "amount"}.`
      : callbackAt
        ? `Asked to be called back ${format(parseISO(callbackAt), "EEE h:mm a")}.`
        : undefined;
    return { ...s, eligible: !reason, reason, note };
  });
}

/** A typical reminder call, for wait estimates. */
const AVG_CALL_SECONDS = 90;

/** Place in line for every call waiting for a free line, in the order the dispatcher will dial them. */
function queueSpots(db: ShopData): Map<string, QueueSpot> {
  const { lines, onLine, waiting } = db.lines;
  const order = dialOrder(waiting, onLine);
  const freeLines = Math.max(0, lines - onLine.length);
  return new Map(
    order.map((call, i) => [
      call.id,
      { position: i + 1, lines, busyLines: onLine.length, waitSeconds: estimatedWaitSeconds(i, { lines, freeLines, avgCallSeconds: AVG_CALL_SECONDS }) },
    ]),
  );
}

function listItem(db: ShopData, call: Call, spots: Map<string, QueueSpot>): CallListItem {
  return { call, customer: db.customers.find((c) => c.id === call.customerId), queue: spots.get(call.id) };
}

export function callItems(db: ShopData): CallListItem[] {
  const spots = queueSpots(db);
  return [...db.calls].sort(byNewest).map((call) => listItem(db, call, spots));
}

export function callDetail(db: ShopData, id: string): CallDetail | null {
  const call = db.calls.find((k) => k.id === id);
  if (!call) return null;
  return {
    ...listItem(db, call, queueSpots(db)),
    batch: call.batchId ? db.batches.find((b) => b.id === call.batchId) : undefined,
  };
}

export function batchSummary(db: ShopData, batchId: string): BatchSummary | null {
  const batch = db.batches.find((b) => b.id === batchId);
  if (!batch) return null;
  const spots = queueSpots(db);
  const calls = batch.callIds
    .map((id) => db.calls.find((k) => k.id === id))
    .filter((k): k is Call => !!k)
    .map((call) => listItem(db, call, spots));
  const counts = { waiting: 0, active: 0, done: 0, removed: 0 };
  const outcomes: BatchSummary["outcomes"] = {};
  for (const { call } of calls) {
    if (call.status === "scheduled" || call.status === "queued" || call.status === "rescheduled") counts.waiting++;
    else if (call.status === "ringing" || call.status === "in_progress") counts.active++;
    else if (call.status === "cancelled") counts.removed++;
    else counts.done++;
    const outcome = call.extraction?.outcome ?? (call.status === "no_answer" ? "no_answer" : undefined);
    if (outcome && !isActiveCall(call.status)) outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
  }
  return { batch, calls, counts, outcomes, canChangeTime: canChangeBatchTime(calls.map((x) => x.call.status)) };
}

export function batchSummaries(db: ShopData): BatchSummary[] {
  return [...db.batches]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((b) => batchSummary(db, b.id))
    .filter((b): b is BatchSummary => !!b);
}

export function dashboard(db: ShopData, now: Date): DashboardData {
  const today = toDateKey(now);
  const weekEnd = toDateKey(addDays(now, 6));
  const weekAgo = toDateKey(addDays(now, -6));
  const all = summaries(db, now);
  const owing = all.filter((s) => s.balance > 0);
  const name = (id: string) => db.customers.find((c) => c.id === id);

  const openPromises = db.promises.filter((p) => p.status === "open");
  const thisWeek = openPromises.filter((p) => p.dueDate >= today && p.dueDate <= weekEnd);

  const attention: AttentionItem[] = [];
  for (const s of all) {
    const c = s.customer;
    if (s.status === "overdue" && s.nextPromise)
      attention.push({ kind: "overdue", customer: c, text: `Promised ${formatINR(s.nextPromise.amount)} by ${fmtDay(s.nextPromise.dueDate)}; not paid yet.` });
    if (s.openDispute) attention.push({ kind: "dispute", customer: c, text: s.openDispute.reason, callId: s.openDispute.callId });
    const last = customerCalls(db, c.id).find((k) => k.status === "completed");
    if (!last?.extraction) continue;
    const ex = last.extraction;
    if (ex.outcome === "callback" && ex.callbackAt && toDateKey(new Date(ex.callbackAt)) >= today)
      attention.push({ kind: "callback", customer: c, text: `Asked for a call back ${format(parseISO(ex.callbackAt), "EEE h:mm a")}.`, callId: last.id });
    if (ex.outcome === "wrong_number" && last.toNumber === c.phone)
      attention.push({ kind: "wrong_number", customer: c, text: "The number reached someone else. Update it.", callId: last.id });
    if (ex.outcome === "refused" && s.balance > 0)
      attention.push({ kind: "refused", customer: c, text: "Will settle in person. Avoid calling for now.", callId: last.id });
    if (ex.promises.length > 0 && confidenceLabel(ex.confidence) !== "High" && s.status === "promised")
      attention.push({ kind: "low_confidence", customer: c, text: `Check the promise: ${confidenceLabel(ex.confidence).toLowerCase()} confidence.`, callId: last.id });
  }

  const byDay = Array.from({ length: 7 }, (_, i) => {
    const date = toDateKey(addDays(now, i - 6));
    return {
      date,
      collected: db.payments.filter((p) => p.date === date).reduce((s, p) => s + p.amount, 0),
      promised: db.promises.filter((p) => toDateKey(new Date(p.createdAt)) === date).reduce((s, p) => s + p.amount, 0),
    };
  });

  const active = db.batches.find((b) => b.status === "running" || b.status === "scheduled");

  return {
    totalPending: owing.reduce((s, x) => s + x.balance, 0),
    customersOwing: owing.length,
    promisedThisWeek: { amount: thisWeek.reduce((s, p) => s + p.amount, 0), count: thisWeek.length },
    collectedThisWeek: db.payments.filter((p) => p.date >= weekAgo && p.date <= today).reduce((s, p) => s + p.amount, 0),
    collectedToday: db.payments.filter((p) => p.date === today).reduce((s, p) => s + p.amount, 0),
    openDisputes: db.disputes.filter((d) => d.status === "open").length,
    attention,
    upcoming: openPromises
      .filter((p) => p.dueDate >= today)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .slice(0, 6)
      .flatMap((promise) => {
        const customer = name(promise.customerId);
        return customer ? [{ promise, customer }] : [];
      }),
    recentCalls: callItems(db).filter((x) => x.call.kind === "reminder").slice(0, 6),
    byDay,
    activeBatch: active ? (batchSummary(db, active.id) ?? undefined) : undefined,
  };
}

export const dailyReport = (db: ShopData, now: Date): DailyReport => dailyReportWithScript(db, now).report;

/** The daily report plus the transcript the evening call will speak. */
export function dailyReportWithScript(db: ShopData, now: Date): { report: DailyReport; turns: Turn[] } {
  const today = toDateKey(now);
  const tomorrow = toDateKey(addDays(now, 1));
  const withCustomer = <T extends { customerId: string }>(xs: T[], key: string) =>
    xs.flatMap((x) => {
      const customer = db.customers.find((c) => c.id === x.customerId);
      return customer ? [{ customer, [key]: x }] : [];
    });

  const payments = withCustomer(db.payments.filter((p) => p.date === today), "payment") as DailyReport["payments"];
  const promisesMade = withCustomer(db.promises.filter((p) => toDateKey(new Date(p.createdAt)) === today), "promise") as DailyReport["promisesMade"];
  const dueTomorrow = withCustomer(db.promises.filter((p) => p.status === "open" && p.dueDate === tomorrow), "promise") as DailyReport["dueTomorrow"];
  const disputesOpened = withCustomer(db.disputes.filter((d) => d.status === "open"), "dispute") as DailyReport["disputesOpened"];
  const productRequests = withCustomer(
    db.notes.filter((n) => n.kind === "product_demand" && toDateKey(new Date(n.createdAt)) >= toDateKey(addDays(now, -6))),
    "note",
  ) as DailyReport["productRequests"];
  const callsToday = db.calls.filter((k) => k.kind === "reminder" && k.startedAt && toDateKey(new Date(k.startedAt)) === today);
  const collected = payments.reduce((s, p) => s + p.payment.amount, 0);

  // Bengali-script names go into the Bengali speech only for Bengali speakers; others keep the Latin name.
  const person = (c: Customer) => ({ name: c.name, spokenName: c.language === "bn" ? (c.nameNative ?? c.name) : c.name });
  const script = buildReportScript({
    ownerFirstName: db.shop.ownerName.split(" ")[0],
    collected,
    promisesMade: promisesMade.map((p) => ({ ...person(p.customer), amount: p.promise.amount })),
    dueTomorrow: dueTomorrow.map((p) => ({ ...person(p.customer), amount: p.promise.amount })),
    disputes: disputesOpened.map((d) => ({ ...person(d.customer), reason: d.dispute.reason })),
    productRequests: [...new Set(productRequests.map((p) => p.note.product ?? p.note.text))],
  });

  return {
    report: {
      date: today,
      collected,
      payments,
      promisesMade,
      dueTomorrow,
      disputesOpened,
      callsMade: callsToday.length,
      callsAnswered: callsToday.filter((k) => k.status === "completed").length,
      productRequests,
      spoken: { bn: script.spokenBn, en: script.spokenEn },
    },
    turns: script.turns,
  };
}

/** The shop's knowledge graph: customers, what they promised, disputed, said and asked for. */
export function graph(db: ShopData, now: Date): GraphData {
  const nodes: GraphNode[] = [{ id: "shop", type: "shop", label: db.shop.name }];
  const edges: GraphEdge[] = [];
  const recent = toDateKey(addDays(now, -30));

  for (const s of summaries(db, now)) {
    const c = s.customer;
    const cid = `cust:${c.id}`;
    nodes.push({ id: cid, type: "customer", label: c.name, state: s.status, amount: s.balance, customerId: c.id, detail: c.nameNative });
    edges.push({ id: `owes:${c.id}`, source: cid, target: "shop", kind: "owes" });
    if (c.paysThroughId) edges.push({ id: `pays:${c.id}`, source: cid, target: `cust:${c.paysThroughId}`, kind: "pays_through" });
  }

  for (const p of db.promises) {
    if (p.status !== "open" && toDateKey(new Date(p.createdAt)) < recent) continue;
    const state = p.status === "open" && isPromiseBroken(p, now) ? "overdue" : p.status;
    nodes.push({ id: `prom:${p.id}`, type: "promise", label: `${formatINR(p.amount)} · ${fmtDay(p.dueDate)}`, state, amount: p.amount, customerId: p.customerId });
    edges.push({ id: `e:prom:${p.id}`, source: `cust:${p.customerId}`, target: `prom:${p.id}`, kind: "promised" });
  }

  for (const d of db.disputes.filter((x) => x.status === "open")) {
    nodes.push({ id: `disp:${d.id}`, type: "dispute", label: d.amount ? `Dispute · ${formatINR(d.amount)}` : "Dispute", state: d.status, customerId: d.customerId, detail: d.reason });
    edges.push({ id: `e:disp:${d.id}`, source: `cust:${d.customerId}`, target: `disp:${d.id}`, kind: "disputed" });
  }

  const products = new Map<string, string[]>();
  for (const n of db.notes) {
    if (n.kind === "product_demand" && n.product) {
      products.set(n.product, [...(products.get(n.product) ?? []), n.customerId]);
      continue;
    }
    if (n.kind === "relationship") continue; // already drawn as a pays-through edge
    nodes.push({ id: `note:${n.id}`, type: "note", label: n.text.length > 34 ? `${n.text.slice(0, 32)}…` : n.text, state: n.kind, customerId: n.customerId, detail: n.text });
    edges.push({ id: `e:note:${n.id}`, source: `cust:${n.customerId}`, target: `note:${n.id}`, kind: "said" });
  }
  for (const [product, customerIds] of products) {
    nodes.push({ id: `prod:${product}`, type: "product", label: product, amount: customerIds.length });
    for (const cid of new Set(customerIds)) edges.push({ id: `e:prod:${product}:${cid}`, source: `cust:${cid}`, target: `prod:${product}`, kind: "asked_for" });
  }

  return { nodes, edges };
}

/** Case-insensitive match on Latin or native-script names, first name or full name. */
export function findCustomerByName(db: ShopData, text: string): Customer | undefined {
  const q = text.toLowerCase();
  const scored = db.customers
    .map((c) => {
      const latin = c.name.toLowerCase();
      const first = latin.split(" ")[0];
      const native = c.nameNative ?? "";
      const nativeFirst = native.split(" ")[0];
      const score = q.includes(latin) || (native && q.includes(native)) ? 2 : q.includes(first) || (nativeFirst && q.includes(nativeFirst)) ? 1 : 0;
      return { c, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.c;
}
