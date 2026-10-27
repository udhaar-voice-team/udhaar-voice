import { z } from "zod";

/**
 * Domain model for Udhaar Voice, as the screens see it.
 * The Supabase tables (web/supabase/migrations) store these; lib/server/rows.ts maps between the two.
 */

export const Language = z.enum(["bn", "hi", "en"]);
export type Language = z.infer<typeof Language>;

const isoDateTime = z.string(); // ISO 8601 timestamp
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/); // calendar date, shop's local time
const rupees = z.number().int().nonnegative(); // whole rupees; khata amounts are never fractional

export const CallingHours = z
  .object({ start: z.number().int().min(0).max(23), end: z.number().int().min(1).max(24) })
  .refine((h) => h.end > h.start, { message: "Calling hours must end after they start" });
export type CallingHours = z.infer<typeof CallingHours>;

export const User = z.object({
  id: z.string(),
  shopId: z.string(),
  phone: z.string(),
  email: z.string().optional(),
  name: z.string().min(1),
  createdAt: isoDateTime,
});
export type User = z.infer<typeof User>;

export const Shop = z.object({
  id: z.string(),
  /** The user account that owns this shop. */
  ownerUserId: z.string().optional(),
  name: z.string().min(1),
  ownerName: z.string().min(1),
  ownerPhone: z.string(),
  /** Empty until the shopkeeper adds it on their profile. */
  upiId: z.string(),
  /** The language new customers are called in until it is changed on their page. */
  defaultCustomerLanguage: Language,
  callingHours: CallingHours,
  reminderGapDays: z.number().int().min(1).max(14),
  maxCallMinutes: z.number().int().min(1).max(10),
  /** The evening voice summary call to the shopkeeper. */
  reportEnabled: z.boolean(),
  reportTime: z.string().regex(/^\d{2}:\d{2}$/),
  reportLanguage: Language,
  /** Mirrors Bolna's bypass_call_guardrails flag. Only for demos outside calling hours. */
  demoBypassHours: z.boolean(),
});
export type Shop = z.infer<typeof Shop>;

export const Customer = z.object({
  id: z.string(),
  shopId: z.string(),
  name: z.string().min(1),
  /** Name in Bengali or Devanagari script, as the shopkeeper writes it. */
  nameNative: z.string().optional(),
  phone: z.string(), // E.164, e.g. +919876543210
  language: Language,
  optedOut: z.boolean(),
  /** Another customer who pays for this one (e.g. a son paying his mother's dues). */
  paysThroughId: z.string().optional(),
  createdAt: isoDateTime,
});
export type Customer = z.infer<typeof Customer>;

export const EntrySource = z.enum(["photo", "manual", "voice"]);
export type EntrySource = z.infer<typeof EntrySource>;

export const LedgerEntry = z.object({
  id: z.string(),
  customerId: z.string(),
  amount: rupees,
  items: z.string(),
  date: isoDate,
  source: EntrySource,
  /** The khata photo import that added it, so a whole import can be undone at once. */
  importId: z.string().optional(),
  createdAt: isoDateTime,
});
export type LedgerEntry = z.infer<typeof LedgerEntry>;

/** One saved khata photo: what it added and changed, so the shopkeeper can undo it in one go. */
export const KhataImport = z.object({
  id: z.string(),
  shopId: z.string(),
  source: z.enum(["sample", "upload"]),
  createdAt: isoDateTime,
  entryIds: z.array(z.string()),
  /** Customers created by this import. */
  customerIds: z.array(z.string()),
  /** Saved entries this import changed, with their values before the change. */
  updates: z.array(z.object({ entryId: z.string(), previous: z.object({ amount: rupees, items: z.string() }) })),
  undoneAt: isoDateTime.optional(),
});
export type KhataImport = z.infer<typeof KhataImport>;

export const PaymentMethod = z.enum(["cash", "upi"]);
export const Payment = z.object({
  id: z.string(),
  customerId: z.string(),
  amount: rupees,
  method: PaymentMethod,
  date: isoDate,
  createdAt: isoDateTime,
});
export type Payment = z.infer<typeof Payment>;

export const PromiseStatus = z.enum(["open", "kept", "broken"]);
export type PromiseStatus = z.infer<typeof PromiseStatus>;

/** A customer's promise to pay, usually captured by a reminder call. */
export const PaymentPromise = z.object({
  id: z.string(),
  customerId: z.string(),
  callId: z.string().optional(),
  amount: rupees,
  dueDate: isoDate,
  status: PromiseStatus,
  createdAt: isoDateTime,
});
export type PaymentPromise = z.infer<typeof PaymentPromise>;

export const DisputeKind = z.enum(["already_paid", "wrong_amount", "other"]);
export const Dispute = z.object({
  id: z.string(),
  customerId: z.string(),
  callId: z.string().optional(),
  kind: DisputeKind,
  reason: z.string(),
  amount: rupees.optional(),
  status: z.enum(["open", "resolved"]),
  createdAt: isoDateTime,
});
export type Dispute = z.infer<typeof Dispute>;

export const NoteKind = z.enum(["request", "complaint", "life_event", "product_demand", "relationship", "other"]);
export type NoteKind = z.infer<typeof NoteKind>;

/** A short fact pulled from a call transcript. Notes feed the knowledge graph and the agent's memory. */
export const Note = z.object({
  id: z.string(),
  customerId: z.string(),
  callId: z.string().optional(),
  kind: NoteKind,
  text: z.string(),
  /** For product_demand notes: the product asked for, e.g. "Maggi". */
  product: z.string().optional(),
  createdAt: isoDateTime,
});
export type Note = z.infer<typeof Note>;

export const CallKind = z.enum(["reminder", "report"]);
export type CallKind = z.infer<typeof CallKind>;

/** Mirrors Bolna's execution statuses, plus "scheduled" for calls we have not handed to Bolna yet. */
export const CallStatus = z.enum([
  "scheduled",
  "queued",
  "ringing",
  "in_progress",
  "completed",
  "no_answer",
  "busy",
  "failed",
  "rescheduled",
  "cancelled",
]);
export type CallStatus = z.infer<typeof CallStatus>;

export const CallOutcome = z.enum([
  "promised",
  "disputed",
  "callback",
  "refused",
  "wrong_number",
  "opted_out",
  "no_answer",
  "report_delivered",
]);
export type CallOutcome = z.infer<typeof CallOutcome>;

export const Turn = z.object({
  speaker: z.enum(["agent", "customer", "shopkeeper"]),
  /** What was said, in the language of the call. */
  text: z.string(),
  /** English translation for the shopkeeper and the judges. */
  gloss: z.string().optional(),
  /** Seconds from the start of the conversation. */
  at: z.number().nonnegative(),
});
export type Turn = z.infer<typeof Turn>;

/** Structured result of a call, as produced by Bolna's post-call extractions. */
export const Extraction = z.object({
  outcome: CallOutcome,
  promises: z.array(z.object({ amount: rupees, dueDate: isoDate })),
  dispute: z.object({ kind: DisputeKind, reason: z.string(), amount: rupees.optional() }).optional(),
  callbackAt: isoDateTime.optional(),
  notes: z.array(z.object({ kind: NoteKind, text: z.string(), product: z.string().optional() })),
  sentiment: z.enum(["positive", "neutral", "negative"]),
  /** 0–1. Bolna labels ≥ 0.8 High, ≥ 0.5 Medium, else Low. */
  confidence: z.number().min(0).max(1),
  summary: z.string(),
});
export type Extraction = z.infer<typeof Extraction>;

export const CallEvent = z.object({ at: isoDateTime, status: CallStatus, detail: z.string().optional() });
export type CallEvent = z.infer<typeof CallEvent>;

export const Call = z.object({
  id: z.string(),
  shopId: z.string(),
  kind: CallKind,
  /** Empty for report calls, which go to the shopkeeper. */
  customerId: z.string().optional(),
  batchId: z.string().optional(),
  /** The number dialled (Bolna reports it as to_number). Lets us tell if a wrong number was fixed. */
  toNumber: z.string().optional(),
  language: Language,
  status: CallStatus,
  scheduledAt: isoDateTime,
  startedAt: isoDateTime.optional(),
  answeredAt: isoDateTime.optional(),
  endedAt: isoDateTime.optional(),
  durationSec: z.number().nonnegative().optional(),
  costUsd: z.number().nonnegative().optional(),
  transcript: z.array(Turn),
  extraction: Extraction.optional(),
  events: z.array(CallEvent),
});
export type Call = z.infer<typeof Call>;

export const BatchStatus = z.enum(["scheduled", "running", "completed", "cancelled"]);
export type BatchStatus = z.infer<typeof BatchStatus>;
export const ReminderBatch = z.object({
  id: z.string(),
  shopId: z.string(),
  scheduledAt: isoDateTime,
  language: z.union([z.literal("auto"), Language]),
  callIds: z.array(z.string()),
  status: BatchStatus,
  createdAt: isoDateTime,
});
export type ReminderBatch = z.infer<typeof ReminderBatch>;

/** Customer state shown as a chip everywhere. Derived, never stored. */
export type CustomerStatus = "paid" | "opted_out" | "disputed" | "overdue" | "promised" | "due";
