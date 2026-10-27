import { format } from "date-fns";
import { canChangeBatchTime, isWithinCallingHours } from "@/lib/domain/rules";
import type { Call, CallingHours, Customer, Language, ReminderBatch } from "@/lib/domain/types";
import type { ScheduleInput } from "@/lib/api/contract";
import type { ShopData } from "./data";
import { candidates } from "./queries";

/**
 * Decides what scheduling, moving and cancelling calls should change. Pure: lib/server/api.ts
 * writes the result to the database, and the call dispatcher dials the calls when their time comes.
 */

export type PlannedCall = { customerId: string; toNumber: string; language: Language };

export type SchedulePlan =
  /** Outside calling hours nothing is scheduled: the shopkeeper picks another time. */
  | { kind: "outside_hours"; hours: CallingHours }
  | { kind: "nothing"; skipped: { customer: Customer; reason: string }[] }
  | {
      kind: "batch";
      at: Date;
      language: ScheduleInput["language"];
      calls: PlannedCall[];
      skipped: { customer: Customer; reason: string }[];
      /** Goes on each call's timeline. */
      detail?: string;
    };

export function planSchedule(db: ShopData, input: ScheduleInput, now: Date): SchedulePlan {
  const at = input.at === "now" ? now : new Date(input.at);
  if (!Number.isFinite(at.getTime())) throw new Error("Invalid time");
  const hours = db.shop.callingHours;
  const inside = isWithinCallingHours(at, hours);
  if (!inside && !input.bypassHours) return { kind: "outside_hours", hours };

  const pool = new Map(candidates(db, now).map((c) => [c.customer.id, c]));
  const skipped: { customer: Customer; reason: string }[] = [];
  const calls: PlannedCall[] = [];
  for (const id of new Set(input.customerIds)) {
    const candidate = pool.get(id);
    if (!candidate) continue;
    if (!candidate.eligible) {
      skipped.push({ customer: candidate.customer, reason: candidate.reason ?? "Not eligible" });
      continue;
    }
    const c = candidate.customer;
    calls.push({ customerId: c.id, toNumber: c.phone, language: input.language === "auto" ? c.language : input.language });
  }
  if (calls.length === 0) return { kind: "nothing", skipped };
  const detail = inside ? undefined : "Outside calling hours: bypassed for this demo";
  return { kind: "batch", at, language: input.language, calls, skipped, detail };
}

export type MovePlan =
  | { kind: "outside_hours"; hours: CallingHours }
  | {
      kind: "move";
      at: Date;
      detail: string;
      /** The waiting calls that move. */
      callIds: string[];
      /** A batch whose time follows, when it holds only this call. */
      batchId?: string;
    };

function checkTime(at: string, hours: CallingHours, bypassHours: boolean): { when: Date; inside: boolean } | { outside: CallingHours } {
  const when = new Date(at);
  if (!Number.isFinite(when.getTime())) throw new Error("Invalid time");
  const inside = isWithinCallingHours(when, hours);
  if (!inside && !bypassHours) return { outside: hours };
  return { when, inside };
}

export function planCallMove(db: ShopData, callId: string, at: string, bypassHours: boolean): MovePlan {
  const call = db.calls.find((c) => c.id === callId);
  if (!call) throw new Error("Call not found");
  if (call.status !== "scheduled") throw new Error("Only scheduled calls can be moved");
  const time = checkTime(at, db.shop.callingHours, bypassHours);
  if ("outside" in time) return { kind: "outside_hours", hours: time.outside };
  const batch = call.batchId ? db.batches.find((b) => b.id === call.batchId) : undefined;
  return {
    kind: "move",
    at: time.when,
    detail: time.inside ? `Rescheduled to ${format(time.when, "EEE d MMM, h:mm a")}` : "Rescheduled outside calling hours: bypassed for this demo",
    callIds: [call.id],
    batchId: batch && batch.callIds.length === 1 ? batch.id : undefined,
  };
}

export function planBatchMove(db: ShopData, batchId: string, at: string, bypassHours: boolean): MovePlan {
  const batch = db.batches.find((b) => b.id === batchId);
  if (!batch) throw new Error("Batch not found");
  const calls = batchCalls(db, batch);
  if (!canChangeBatchTime(calls.map((c) => c.status))) throw new Error("This batch has started calling, so its time can't change");
  const time = checkTime(at, db.shop.callingHours, bypassHours);
  if ("outside" in time) return { kind: "outside_hours", hours: time.outside };
  return {
    kind: "move",
    at: time.when,
    detail: time.inside ? `Batch moved to ${format(time.when, "EEE d MMM, h:mm a")}` : "Batch moved outside calling hours: bypassed for this demo",
    callIds: calls.filter((c) => c.status === "scheduled").map((c) => c.id),
    batchId: batch.id,
  };
}

const batchCalls = (db: ShopData, batch: ReminderBatch): Call[] =>
  batch.callIds.flatMap((id) => db.calls.filter((c) => c.id === id));

/** Calls that haven't been handed to a line yet can still be cancelled. */
const cancellable = (c: Call) => c.status === "scheduled" || c.status === "queued";

/** The calls cancelling this call removes: none once it has started or ended. */
export function callsToCancel(db: ShopData, callId: string): string[] {
  const call = db.calls.find((c) => c.id === callId);
  return call && cancellable(call) ? [call.id] : [];
}

export function batchCallsToCancel(db: ShopData, batchId: string): string[] {
  const batch = db.batches.find((b) => b.id === batchId);
  if (!batch || batch.status === "completed" || batch.status === "cancelled") return [];
  return batchCalls(db, batch).filter(cancellable).map((c) => c.id);
}
