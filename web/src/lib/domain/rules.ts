import type {
  BatchStatus,
  CallingHours,
  CallStatus,
  CustomerStatus,
  Dispute,
  Language,
  LedgerEntry,
  Note,
  Payment,
  PaymentPromise,
  PlanId,
} from "./types";

/**
 * Business rules. Pure functions only: no I/O, no clock reads (callers pass `now`),
 * so the same code runs in the browser today and on the server later.
 */

/** Rupees still owed. Never negative: overpayments count as fully paid. */
export function balanceOf(entries: Pick<LedgerEntry, "amount">[], payments: Pick<Payment, "amount">[]): number {
  const owed = entries.reduce((sum, e) => sum + e.amount, 0);
  const paid = payments.reduce((sum, p) => sum + p.amount, 0);
  return Math.max(0, owed - paid);
}

/** Local calendar date as YYYY-MM-DD. */
export function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** A promise is broken once its due date has passed while it is still open. */
export function isPromiseBroken(p: Pick<PaymentPromise, "status" | "dueDate">, now: Date): boolean {
  if (p.status === "broken") return true;
  return p.status === "open" && p.dueDate < toDateKey(now);
}

/**
 * The single status chip for a customer. Precedence matters:
 * nothing owed beats everything; an opt-out stops calls; an open dispute must be resolved before
 * chasing money; then overdue promises, upcoming promises, and plain dues.
 */
export function customerStatus(
  input: {
    balance: number;
    optedOut: boolean;
    promises: Pick<PaymentPromise, "status" | "dueDate">[];
    disputes: Pick<Dispute, "status">[];
  },
  now: Date,
): CustomerStatus {
  if (input.balance <= 0) return "paid";
  if (input.optedOut) return "opted_out";
  if (input.disputes.some((d) => d.status === "open")) return "disputed";
  const open = input.promises.filter((p) => p.status === "open");
  if (open.some((p) => isPromiseBroken(p, now))) return "overdue";
  if (open.length > 0) return "promised";
  return "due";
}

/** True if `at` falls inside the shop's calling window (start inclusive, end exclusive). */
export function isWithinCallingHours(at: Date, hours: CallingHours): boolean {
  const h = at.getHours() + at.getMinutes() / 60;
  return h >= hours.start && h < hours.end;
}

/** Customers are reminded at most once every `gapDays` days. */
export function canRemind(lastReminderAt: Date | undefined, gapDays: number, now: Date): boolean {
  if (!lastReminderAt) return true;
  const elapsedMs = now.getTime() - lastReminderAt.getTime();
  return elapsedMs >= gapDays * 24 * 60 * 60 * 1000;
}

/** When the customer becomes eligible for the next reminder. */
export function nextReminderDate(lastReminderAt: Date, gapDays: number): Date {
  return new Date(lastReminderAt.getTime() + gapDays * 24 * 60 * 60 * 1000);
}

/** A call waiting for a free line. */
type WaitingCall = { shopId: string; scheduledAt: string };

/**
 * The order waiting calls get a line in. Every shop shares our one Bolna account, so the lines are
 * shared too. Each line goes to the shop with the fewest calls on the line (counting calls already
 * given a line in this ordering); within a shop, the call that has waited longest goes first.
 * One shop's big batch can't hold up everyone else.
 */
export function dialOrder<T extends WaitingCall>(waiting: T[], onLine: { shopId: string }[]): T[] {
  const load = new Map<string, number>();
  for (const c of onLine) load.set(c.shopId, (load.get(c.shopId) ?? 0) + 1);
  const queues = new Map<string, T[]>();
  for (const c of [...waiting].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))) {
    queues.set(c.shopId, [...(queues.get(c.shopId) ?? []), c]);
  }
  const order: T[] = [];
  while (queues.size > 0) {
    let pick: [string, T[]] | undefined;
    for (const entry of queues) {
      if (!pick) {
        pick = entry;
        continue;
      }
      const a = load.get(entry[0]) ?? 0;
      const b = load.get(pick[0]) ?? 0;
      if (a < b || (a === b && entry[1][0].scheduledAt < pick[1][0].scheduledAt)) pick = entry;
    }
    const [shopId, queue] = pick!;
    order.push(queue.shift()!);
    load.set(shopId, (load.get(shopId) ?? 0) + 1);
    if (queue.length === 0) queues.delete(shopId);
  }
  return order;
}

/**
 * Rough wait before a waiting call gets a line. `position` is its place in `dialOrder` (0 = next).
 * Calls that fit in the free lines start now; the rest wait one average call per round of lines.
 */
export function estimatedWaitSeconds(position: number, input: { lines: number; freeLines: number; avgCallSeconds: number }): number {
  if (position < input.freeLines) return 0;
  return (Math.floor((position - input.freeLines) / input.lines) + 1) * input.avgCallSeconds;
}

const normalizeItems = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * Compares a row read from a khata photo with the entries already saved for that customer.
 * - Same date and amount: the page was photographed before ("duplicate").
 * - Same date, and the same items or an amount that matches what was crossed out on the page:
 *   the shopkeeper changed the entry ("changed").
 * The shopkeeper confirms either way; this only picks the default.
 */
export function matchSavedEntry<E extends Pick<LedgerEntry, "date" | "amount" | "items">>(
  row: { date: string; amount: number; items: string; struckAmount?: number },
  saved: E[],
): { kind: "duplicate" | "changed"; entry: E } | undefined {
  const sameDay = saved.filter((e) => e.date === row.date);
  const duplicate = sameDay.find((e) => e.amount === row.amount);
  if (duplicate) return { kind: "duplicate", entry: duplicate };
  const items = normalizeItems(row.items);
  const changed = sameDay.find((e) => e.amount === row.struckAmount || (items !== "" && normalizeItems(e.items) === items));
  return changed ? { kind: "changed", entry: changed } : undefined;
}

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

/** ₹1,240 — Indian digit grouping (₹1,24,000 for lakhs). */
export function formatINR(rupees: number): string {
  return inr.format(rupees);
}

/** +91 ••••• •0012 — phone numbers are never shown in full in screenshots or demos. */
export function maskPhone(e164: string): string {
  const digits = e164.replace(/\D/g, "");
  const last4 = digits.slice(-4);
  const cc = digits.length > 10 ? `+${digits.slice(0, digits.length - 10)} ` : "";
  return `${cc}••••• •${last4.slice(-4)}`;
}

/** +91 98765 43210: a number as people read it. Not masked; it's the shopkeeper's own customer list. */
export function formatPhone(e164: string): string {
  const digits = e164.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  return e164;
}

/** Accepts 10-digit Indian mobiles with or without +91 / 0; returns E.164 or null. */
export function normalizeIndianMobile(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  const local = digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits.length === 11 && digits.startsWith("0") ? digits.slice(1) : digits;
  return /^[6-9]\d{9}$/.test(local) ? `+91${local}` : null;
}

const SCRIPTS: Record<Language, RegExp> = {
  en: /^[\x20-\x7E]+$/,
  hi: /[\u0900-\u097F]/,
  or: /[\u0B00-\u0B7F]/,
  bn: /[\u0980-\u09FF]/,
  mr: /[\u0900-\u097F]/,
};

/**
 * The name to say on a call in `language`: the khata's native-script name when it is written in that
 * language's script (Bengali for bn, Devanagari for hi and mr, Odia for or), otherwise the Latin name. A Bengali-script name
 * read out in a Hindi call comes out wrong.
 */
export function spokenName(c: { name: string; nameNative?: string }, language: Language): string {
  return c.nameNative && language !== "en" && SCRIPTS[language].test(c.nameNative) ? c.nameNative : c.name;
}

/** Bolna's confidence labels. */
export function confidenceLabel(c: number): "High" | "Medium" | "Low" {
  if (c >= 0.8) return "High";
  if (c >= 0.5) return "Medium";
  return "Low";
}

/** UPI deep link that any UPI app understands. */
/** No fixed note (`tn`), so customers can write their own when they pay. */
export function upiLink(input: { upiId: string; payeeName: string; amount: number }): string {
  const params = new URLSearchParams({ pa: input.upiId, pn: input.payeeName, am: String(input.amount), cu: "INR" });
  return `upi://pay?${params.toString()}`;
}

/** WhatsApp share link with a prefilled message. Works without any API. */
export function whatsappShareLink(e164: string, message: string): string {
  return `https://wa.me/${e164.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`;
}

/**
 * The 2–3 line memory passed into the next reminder call as a variable, so the agent can say
 * "last week you said Friday". Built from history; the real system will let an LLM write it.
 */
export function buildMemory(
  input: {
    promises: PaymentPromise[];
    disputes: Dispute[];
    notes: Note[];
  },
  now: Date,
  fmtDate: (isoDate: string) => string,
): string {
  const lines: string[] = [];
  const byNewest = <T extends { createdAt: string }>(xs: T[]) => [...xs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const promises = byNewest(input.promises);
  const latest = promises[0];
  if (latest) {
    const broken = promises.filter((p) => isPromiseBroken(p, now)).length;
    if (latest.status === "open" && !isPromiseBroken(latest, now)) {
      lines.push(`Promised ${formatINR(latest.amount)} by ${fmtDate(latest.dueDate)}.`);
    } else if (isPromiseBroken(latest, now)) {
      lines.push(`Missed the promise of ${formatINR(latest.amount)} due ${fmtDate(latest.dueDate)}.`);
    } else if (latest.status === "kept") {
      lines.push(`Kept the last promise (${formatINR(latest.amount)}).`);
    }
    if (broken >= 2) lines.push(`Has missed ${broken} promises; ask for a firm date.`);
  }

  const openDispute = byNewest(input.disputes).find((d) => d.status === "open");
  if (openDispute) lines.push(`Open dispute: ${openDispute.reason}. Do not ask for the disputed amount.`);

  const note = byNewest(input.notes).find((n) => n.kind === "life_event" || n.kind === "request" || n.kind === "relationship");
  if (note) lines.push(note.text);

  return lines.slice(0, 3).join(" ") || "No previous calls.";
}

const DIALING: CallStatus[] = ["queued", "ringing", "in_progress"];

/**
 * A batch's status from its calls' statuses. Cancelled only when no call in it ever ran; a batch where
 * some calls finished and the rest were removed is completed.
 */
export function batchStatus(calls: CallStatus[]): BatchStatus {
  if (calls.some((s) => s === "scheduled" || DIALING.includes(s))) {
    return calls.some((s) => s !== "scheduled" && s !== "cancelled") ? "running" : "scheduled";
  }
  return calls.every((s) => s === "cancelled") ? "cancelled" : "completed";
}

/** A batch's time can change only before it starts dialing: every call still in it is waiting for its time. */
export function canChangeBatchTime(calls: CallStatus[]): boolean {
  return calls.some((s) => s === "scheduled") && calls.every((s) => s === "scheduled" || s === "cancelled");
}

/* ---------------------------------------------------------------- plans */

/**
 * What each plan includes. The khata is free; Asha's calls are what a shop pays for, because each
 * call costs us money and WhatsApp costs almost nothing. `photoReadsPerDay` keeps the AI models'
 * cost in check; `summaryCalls` is how often the evening summary is a phone call.
 */
export const PLANS: Record<PlanId, { price: number; callsPerMonth: number; photoReadsPerDay: number; summaryCalls: "none" | "weekly" | "daily" }> = {
  free: { price: 0, callsPerMonth: 0, photoReadsPerDay: 2, summaryCalls: "none" },
  asha: { price: 199, callsPerMonth: 25, photoReadsPerDay: 30, summaryCalls: "weekly" },
  asha_plus: { price: 399, callsPerMonth: 60, photoReadsPerDay: 30, summaryCalls: "daily" },
};

/** Extra calls on any plan. They don't expire, and are used once a month's calls run out. */
export const CALL_PACK = { price: 49, calls: 10 } as const;

/** Smaller dues get WhatsApp reminders only. */
export const MIN_DUE_FOR_CALL = 300;
/** Reminder calls to one customer in a calendar month. */
export const CALLS_PER_CUSTOMER_PER_MONTH = 2;
/** Days after a WhatsApp reminder before Asha may call, giving the customer time to pay or reply. */
export const WHATSAPP_WAIT_DAYS = 3;
/** A WhatsApp reminder older than this no longer counts towards a call. */
export const WHATSAPP_VALID_DAYS = 30;
/** On the Asha plan the summary call comes on Saturdays (0 is Sunday). */
export const WEEKLY_SUMMARY_DAY = 6;

const DAY_MS = 24 * 60 * 60 * 1000;
const monthKey = (d: Date) => toDateKey(d).slice(0, 7);

/** True when `at` falls in the same calendar month as `now`. */
export const inSameMonth = (at: Date, now: Date) => monthKey(at) === monthKey(now);

/** Calls a shop can still place: what's left of this month's plus its call packs. */
export function callsLeft(plan: PlanId, usedThisMonth: number, extraCalls: number): { monthly: number; extra: number; total: number } {
  const monthly = Math.max(0, PLANS[plan].callsPerMonth - usedThisMonth);
  const extra = Math.max(0, extraCalls);
  return { monthly, extra, total: monthly + extra };
}

/** How many of `count` new calls come out of call packs, after this month's calls are used. */
export function packCallsUsed(plan: PlanId, usedThisMonth: number, count: number): number {
  return Math.max(0, count - Math.max(0, PLANS[plan].callsPerMonth - usedThisMonth));
}

/** Whether today's evening summary is a phone call on this plan. */
export function summaryCallToday(plan: PlanId, now: Date): boolean {
  const every = PLANS[plan].summaryCalls;
  return every === "daily" || (every === "weekly" && now.getDay() === WEEKLY_SUMMARY_DAY);
}

/**
 * Whether Asha may call yet, going by WhatsApp: a reminder sent at least WHATSAPP_WAIT_DAYS ago,
 * within the last WHATSAPP_VALID_DAYS, with no payment since it. A missed promise or a request to
 * be called back skips this: the customer has already been in touch.
 */
export function whatsappStep(
  sent: Date[],
  lastPaymentAt: Date | undefined,
  now: Date,
): { ready: true } | { ready: false; sentAt?: Date; callableFrom?: Date } {
  const valid = sent.filter((d) => now.getTime() - d.getTime() <= WHATSAPP_VALID_DAYS * DAY_MS && (!lastPaymentAt || d > lastPaymentAt));
  if (valid.length === 0) return { ready: false };
  const first = valid.reduce((a, b) => (a < b ? a : b));
  const callableFrom = new Date(first.getTime() + WHATSAPP_WAIT_DAYS * DAY_MS);
  return now >= callableFrom ? { ready: true } : { ready: false, sentAt: first, callableFrom };
}

/** When calls are fewer than the customers chosen, who gets them: oldest dues first, then the largest. */
export function byCallPriority<T extends { oldestDue?: string; balance: number }>(a: T, b: T): number {
  const ao = a.oldestDue ?? "9999";
  const bo = b.oldestDue ?? "9999";
  return ao !== bo ? ao.localeCompare(bo) : b.balance - a.balance;
}
