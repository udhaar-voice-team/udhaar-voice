import type { Call, CallOutcome, CallStatus, Dispute, Extraction, Note, PaymentPromise, Turn } from "@/lib/domain/types";
import type { Execution, ExecutionStatus } from "./client";
import { EXTRACTIONS } from "./prompts";

/** Turns what Bolna reports about a call into the app's shapes. Pure. */

type DisputeKind = Dispute["kind"];

const FINAL: CallStatus[] = ["completed", "no_answer", "busy", "failed", "cancelled"];
export const isFinal = (s: CallStatus) => FINAL.includes(s);

/**
 * Bolna's execution status as ours. "call-disconnected" comes before "completed" and carries no
 * results yet, so the call still counts as in progress until "completed" arrives. A completed call
 * nobody spoke on counts as unanswered.
 */
export function toCallStatus(e: Pick<Execution, "status" | "conversation_duration" | "answered_by_voice_mail" | "transcript">): CallStatus {
  const map: Record<ExecutionStatus, CallStatus> = {
    scheduled: "ringing",
    queued: "ringing",
    rescheduled: "ringing",
    initiated: "ringing",
    ringing: "ringing",
    "in-progress": "in_progress",
    "call-disconnected": "in_progress",
    completed: "completed",
    busy: "busy",
    "no-answer": "no_answer",
    canceled: "cancelled",
    failed: "failed",
    "balance-low": "failed",
    stopped: "failed",
    error: "failed",
  };
  const status = map[e.status] ?? "failed";
  const someoneSpoke = /^\s*(user|customer|human)\s*:/im.test(e.transcript ?? "");
  if (status === "completed" && (e.answered_by_voice_mail || (!e.conversation_duration && !someoneSpoke))) return "no_answer";
  return status;
}

/** Bolna's transcript ("assistant: …" / "user: …" lines) as turns, spread evenly over the call. */
export function parseTranscript(text: string | null | undefined, kind: Call["kind"], durationSec = 0): Turn[] {
  if (!text) return [];
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const turns: Omit<Turn, "at">[] = [];
  for (const line of lines) {
    const m = /^(assistant|agent|bot|user|customer|human)\s*:\s*(.*)$/i.exec(line);
    if (m) {
      const agent = /^(assistant|agent|bot)$/i.test(m[1]);
      turns.push({ speaker: agent ? "agent" : kind === "report" ? "shopkeeper" : "customer", text: m[2] });
    } else if (turns.length) {
      turns[turns.length - 1].text += ` ${line}`;
    }
  }
  const step = turns.length > 1 && durationSec > 0 ? durationSec / turns.length : 4;
  return turns.filter((t) => t.text).map((t, i) => ({ ...t, at: Math.round(i * step) }));
}

type Answer = { value: string; confidence?: number };

/**
 * One extraction's answer, wherever it sits: extracted_data[category][name] with subjective/objective
 * values (Bolna's extractions), or a flat extracted_data[name] (older agents).
 */
export function findAnswer(data: unknown, name: string): Answer | undefined {
  if (!data || typeof data !== "object") return undefined;
  const lower = name.toLowerCase();
  const read = (v: unknown): Answer | undefined => {
    if (v === null || v === undefined) return undefined;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return { value: String(v).trim() };
    if (typeof v === "object") {
      const o = v as { objective?: unknown; subjective?: unknown; confidence?: unknown };
      const value = [o.objective, o.subjective].find((x) => x !== null && x !== undefined && String(x).trim() !== "");
      if (value === undefined) return { value: "", confidence: typeof o.confidence === "number" ? o.confidence : undefined };
      return { value: String(value).trim(), confidence: typeof o.confidence === "number" ? o.confidence : undefined };
    }
    return undefined;
  };
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (key.toLowerCase() === lower) return read(value);
  }
  for (const value of Object.values(data as Record<string, unknown>)) {
    if (value && typeof value === "object" && !("subjective" in value) && !("objective" in value)) {
      const found = findAnswer(value, name);
      if (found) return found;
    }
  }
  return undefined;
}

const EMPTY = /^(|none|null|n\/a|na|no|nothing|empty|-)$/i;
const present = (a: Answer | undefined) => (a && !EMPTY.test(a.value) ? a.value : undefined);
const rupees = (a: Answer | undefined) => {
  const v = present(a);
  const n = v ? Math.round(Number(v.replace(/[^\d.]/g, ""))) : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
};
/** "2000 on 2026-10-31; 6200 on 2026-11-30" → one promise per part, in date order. */
export function parsePlan(text: string | undefined): { amount: number; dueDate: string }[] {
  const parts = [...(text ?? "").matchAll(/₹?\s*(\d[\d,]*)(?:\s*(?:rupees|rs\.?|on|by|@|-|,))*\s*(\d{4}-\d{2}-\d{2})/gi)]
    .map((m) => ({ amount: Math.round(Number(m[1].replace(/,/g, ""))), dueDate: m[2] }))
    .filter((p) => Number.isFinite(p.amount) && p.amount > 0);
  return parts.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

const OUTCOMES: CallOutcome[] = ["promised", "disputed", "callback", "refused", "wrong_number", "opted_out", "no_answer"];
const DISPUTES: DisputeKind[] = ["already_paid", "wrong_amount", "other"];

/** The structured result of a customer call, from Bolna's extractions. */
export function toExtraction(e: Pick<Execution, "extracted_data" | "summary">, status: CallStatus): Extraction {
  const data = e.extracted_data;
  const outcomeAnswer = findAnswer(data, EXTRACTIONS.outcome);
  const said = present(outcomeAnswer)?.toLowerCase().replace(/[\s-]+/g, "_");
  // A promise in parts ("₹2,000 now, the rest next month") is one promise per part.
  const plan = parsePlan(present(findAnswer(data, EXTRACTIONS.plan)));
  let outcome: CallOutcome = OUTCOMES.find((o) => o === said) ?? (status === "completed" ? "refused" : "no_answer");
  if (status !== "completed") outcome = "no_answer";

  const kindSaid = present(findAnswer(data, EXTRACTIONS.disputeKind))?.toLowerCase().replace(/[\s-]+/g, "_");
  const disputeKind = DISPUTES.find((k) => k === kindSaid);
  const disputeReason = present(findAnswer(data, EXTRACTIONS.disputeReason));
  // A vague "other" on a call that wasn't about the dues (an opt-out, say) is not a dispute.
  const disputed = outcome === "disputed" || disputeKind === "already_paid" || disputeKind === "wrong_amount";
  const dispute = disputed
    ? { kind: disputeKind ?? "other", reason: disputeReason ?? "The customer disagreed with the amount.", amount: rupees(findAnswer(data, EXTRACTIONS.disputeAmount)) }
    : undefined;

  const callback = present(findAnswer(data, EXTRACTIONS.callbackAt));
  const callbackMatch = callback ? /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})$/.exec(callback) : null;

  const notes: Extraction["notes"] = [];
  for (const product of (present(findAnswer(data, EXTRACTIONS.products)) ?? "").split(/[,;]/).map((p) => p.trim()).filter((p) => p && !EMPTY.test(p))) {
    notes.push({ kind: "product_demand", text: `Asked the shop to keep ${product}.`, product });
  }
  const note = present(findAnswer(data, EXTRACTIONS.note));
  if (note) notes.push({ kind: "other", text: note });

  const mood = present(findAnswer(data, EXTRACTIONS.sentiment))?.toLowerCase();
  const confidence = outcomeAnswer?.confidence ?? (said ? 0.8 : 0.4);

  return {
    outcome,
    promises: outcome === "promised" ? plan : [],
    dispute,
    // Callback times are said in Indian time.
    callbackAt: callbackMatch ? new Date(`${callbackMatch[1]}T${callbackMatch[2]}:00+05:30`).toISOString() : undefined,
    notes,
    sentiment: mood === "positive" || mood === "negative" ? mood : "neutral",
    confidence,
    summary: e.summary?.trim() || describe(outcome, plan),
  };
}

function describe(outcome: CallOutcome, plan: { amount: number; dueDate: string }[]): string {
  switch (outcome) {
    case "promised":
      return plan.length ? `Promised ${plan.map((p) => `₹${p.amount.toLocaleString("en-IN")} by ${p.dueDate}`).join(", then ")}.` : "Promised to pay; check the amount and date.";
    case "disputed":
      return "Disagreed with the amount. Check before calling again.";
    case "callback":
      return "Asked to be called back.";
    case "refused":
      return "Didn't commit to a date.";
    case "wrong_number":
      return "The number reached someone else.";
    case "opted_out":
      return "Asked not to be called again.";
    default:
      return "Nobody answered.";
  }
}

/** What a finished customer call adds to the khata, skipping anything already recorded. */
export function planCallResult(
  call: { id: string; customerId: string },
  ex: Extraction,
  existing: { promises: PaymentPromise[]; disputes: Dispute[]; notes: Note[] },
): {
  promises: { amount: number; dueDate: string }[];
  dispute?: { kind: DisputeKind; reason: string; amount?: number };
  notes: Extraction["notes"];
  optOut: boolean;
} {
  const mine = <T extends { customerId: string }>(xs: T[]) => xs.filter((x) => x.customerId === call.customerId);
  const promises = ex.promises.filter(
    (p) => !mine(existing.promises).some((x) => x.status === "open" && x.dueDate === p.dueDate && x.amount === p.amount),
  );
  const dispute = ex.dispute && !mine(existing.disputes).some((d) => d.status === "open" && d.kind === ex.dispute?.kind) ? ex.dispute : undefined;
  const notes = ex.notes.filter((n) => !mine(existing.notes).some((x) => x.text === n.text));
  return { promises, dispute, notes, optOut: ex.outcome === "opted_out" };
}
