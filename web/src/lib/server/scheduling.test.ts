import { describe, expect, it } from "vitest";
import { createSeed } from "@/lib/demo/seed";
import type { Call } from "@/lib/domain/types";
import type { ScheduleInput, ScheduleResult } from "@/lib/api/contract";
import { answerQuestion } from "./assistant";
import type { ShopData } from "./data";
import { callItems, candidates, dailyReport, dashboard, graph, summaries } from "./queries";
import { batchCallsToCancel, callsToCancel, planBatchMove, planCallMove, planSchedule } from "./scheduling";

// A fixed Wednesday inside calling hours keeps these tests independent of when they run.
const NOW = new Date("2026-10-21T11:00:00");

const fresh = (): ShopData => ({ ...createSeed(NOW), imports: [], lines: { lines: 2, onLine: [], waiting: [] } });
const status = (db: ShopData, id: string, now = NOW) => summaries(db, now).find((s) => s.customer.id === id)?.status;
const eligibility = (db: ShopData, id: string) => candidates(db, NOW).find((c) => c.customer.id === id);

let nextId = 0;

/** Does in memory what lib/server/api.ts writes to the database for a schedule plan. */
function schedule(db: ShopData, input: ScheduleInput, now = NOW): ScheduleResult {
  const plan = planSchedule(db, input, now);
  if (plan.kind === "outside_hours") return { skipped: [], outsideHours: plan.hours };
  if (plan.kind === "nothing") return { skipped: plan.skipped };
  const batchId = `test-b${++nextId}`;
  const calls: Call[] = plan.calls.map((c) => ({
    id: `test-k${++nextId}`,
    shopId: db.shop.id,
    kind: "reminder",
    customerId: c.customerId,
    batchId,
    toNumber: c.toNumber,
    language: c.language,
    status: "scheduled",
    scheduledAt: plan.at.toISOString(),
    transcript: [],
    events: [],
  }));
  db.calls.push(...calls);
  const batch = { id: batchId, shopId: db.shop.id, scheduledAt: plan.at.toISOString(), language: plan.language, callIds: calls.map((c) => c.id), status: "scheduled" as const, createdAt: now.toISOString() };
  db.batches.push(batch);
  return { batch, skipped: plan.skipped };
}

const setStatus = (db: ShopData, id: string, s: Call["status"]) => {
  db.calls.find((c) => c.id === id)!.status = s;
};

describe("seed", () => {
  it("starts with ₹9,560 pending across 14 customers", () => {
    const d = dashboard(fresh(), NOW);
    expect(d.totalPending).toBe(9560);
    expect(d.customersOwing).toBe(14);
    expect(d.openDisputes).toBe(1);
  });

  it("covers every customer state", () => {
    const db = fresh();
    expect(status(db, "c13")).toBe("overdue");
    expect(status(db, "c05")).toBe("disputed");
    expect(status(db, "c02")).toBe("promised");
    expect(status(db, "c10")).toBe("opted_out");
    expect(status(db, "c14")).toBe("paid");
    expect(status(db, "c01")).toBe("due");
  });

  it("builds a connected knowledge graph", () => {
    const g = graph(fresh(), NOW);
    const ids = new Set(g.nodes.map((n) => n.id));
    expect(g.edges.every((e) => ids.has(e.source) && ids.has(e.target))).toBe(true);
    expect(g.edges.some((e) => e.kind === "pays_through")).toBe(true);
  });
});

describe("who can be called", () => {
  it("skips opted-out, fully paid and recently reminded customers", () => {
    const db = fresh();
    expect(eligibility(db, "c10")?.reason).toBe("Asked not to be called");
    expect(eligibility(db, "c14")?.reason).toBe("Nothing due");
    expect(eligibility(db, "c05")?.reason).toMatch(/^Reminded/);
  });

  it("never re-dials a wrong number until it is changed", () => {
    const db = fresh();
    const later = new Date("2026-10-23T11:00:00"); // past the 3-day reminder gap
    const at = (when: Date) => candidates(db, when).find((c) => c.customer.id === "c11");
    expect(at(later)?.reason).toMatch(/Update the number/);
    db.customers.find((c) => c.id === "c11")!.phone = "+919876500011";
    expect(at(NOW)?.reason).toMatch(/^Reminded/); // the gap still applies today
    expect(at(later)?.eligible).toBe(true);
  });

  it("leaves a customer alone for 14 days after a refusal", () => {
    expect(eligibility(fresh(), "c08")?.reason).toMatch(/settle in person/);
  });

  it("schedules nothing outside calling hours, so the shopkeeper can pick another time", () => {
    const db = fresh();
    const evening = new Date("2026-10-21T20:30:00");
    const plan = planSchedule(db, { customerIds: ["c01"], at: evening.toISOString(), language: "auto", bypassHours: false }, NOW);
    expect(plan).toEqual({ kind: "outside_hours", hours: db.shop.callingHours });
  });

  it("schedules outside calling hours only when the demo bypass is on, and says so on the call", () => {
    const db = fresh();
    const evening = new Date("2026-10-21T20:30:00").toISOString();
    const plan = planSchedule(db, { customerIds: ["c01"], at: evening, language: "auto", bypassHours: true }, NOW);
    expect(plan).toMatchObject({ kind: "batch", detail: expect.stringMatching(/bypassed/) });
  });

  it("calls each customer in their own language unless the batch picks one, and reports who was skipped", () => {
    const db = fresh();
    const auto = planSchedule(db, { customerIds: ["c01", "c03", "c02", "c10"], at: "now", language: "auto", bypassHours: false }, NOW);
    expect(auto.kind === "batch" && auto.calls.map((c) => [c.customerId, c.language])).toEqual([
      ["c01", "hi"],
      ["c03", "bn"],
    ]);
    // Sunita was reminded three days ago this evening; Anjali asked not to be called.
    expect(auto.kind === "batch" && auto.skipped.map((s) => s.customer.id)).toEqual(["c02", "c10"]);
    const english = planSchedule(db, { customerIds: ["c01"], at: "now", language: "en", bypassHours: false }, NOW);
    expect(english.kind === "batch" && english.calls[0].language).toBe("en");
  });

  it("schedules nothing when nobody in the list can be called", () => {
    const plan = planSchedule(fresh(), { customerIds: ["c10", "c14"], at: "now", language: "auto", bypassHours: false }, NOW);
    expect(plan.kind).toBe("nothing");
  });
});

describe("rescheduling", () => {
  it("leaves the call unchanged when the new time is outside calling hours", () => {
    const db = fresh();
    const r = schedule(db, { customerIds: ["c01"], at: new Date("2026-10-21T15:00:00").toISOString(), language: "auto", bypassHours: false });
    const plan = planCallMove(db, r.batch!.callIds[0], new Date("2026-10-21T21:00:00").toISOString(), false);
    expect(plan).toEqual({ kind: "outside_hours", hours: db.shop.callingHours });
  });

  it("moves a one-call batch with its call", () => {
    const db = fresh();
    const batch = schedule(db, { customerIds: ["c01"], at: new Date("2026-10-21T15:00:00").toISOString(), language: "auto", bypassHours: false }).batch!;
    const plan = planCallMove(db, batch.callIds[0], new Date("2026-10-22T10:30:00").toISOString(), false);
    expect(plan).toMatchObject({ kind: "move", callIds: batch.callIds, batchId: batch.id });
  });

  it("refuses to move a call that has left the schedule", () => {
    const db = fresh();
    const batch = schedule(db, { customerIds: ["c01"], at: "now", language: "auto", bypassHours: false }).batch!;
    setStatus(db, batch.callIds[0], "ringing");
    expect(() => planCallMove(db, batch.callIds[0], new Date("2026-10-22T10:30:00").toISOString(), false)).toThrow(/Only scheduled/);
  });
});

describe("editing a batch", () => {
  const later = new Date("2026-10-21T15:00:00").toISOString();

  it("moves every waiting call while the batch hasn't started", () => {
    const db = fresh();
    const batch = schedule(db, { customerIds: ["c01", "c03", "c13"], at: later, language: "auto", bypassHours: false }).batch!;
    setStatus(db, batch.callIds[0], "cancelled");
    const plan = planBatchMove(db, batch.id, new Date("2026-10-22T10:30:00").toISOString(), false);
    expect(plan).toMatchObject({ kind: "move", batchId: batch.id, callIds: batch.callIds.slice(1) });
  });

  it("changes nothing when the new time is outside calling hours", () => {
    const db = fresh();
    const batch = schedule(db, { customerIds: ["c01", "c03"], at: later, language: "auto", bypassHours: false }).batch!;
    expect(planBatchMove(db, batch.id, new Date("2026-10-21T21:00:00").toISOString(), false).kind).toBe("outside_hours");
  });

  it("refuses to move a batch that started calling, but still removes waiting customers", () => {
    const db = fresh();
    const batch = schedule(db, { customerIds: ["c01", "c03", "c13"], at: "now", language: "auto", bypassHours: false }).batch!;
    setStatus(db, batch.callIds[0], "in_progress");
    setStatus(db, batch.callIds[1], "queued");
    expect(() => planBatchMove(db, batch.id, later, false)).toThrow(/started calling/);
    expect(callsToCancel(db, batch.callIds[1])).toEqual([batch.callIds[1]]);
    expect(callsToCancel(db, batch.callIds[0])).toEqual([]);
    expect(batchCallsToCancel(db, batch.id)).toEqual(batch.callIds.slice(1));
  });
});

describe("waiting for a line", () => {
  it("tells waiting calls their place in line, sharing lines with other shops", () => {
    const db = fresh();
    const batch = schedule(db, { customerIds: ["c01", "c03", "c13"], at: "now", language: "auto", bypassHours: false }).batch!;
    for (const id of batch.callIds) setStatus(db, id, "queued");
    const mine = batch.callIds.map((id, i) => ({ id, shopId: db.shop.id, scheduledAt: `2026-10-21T05:30:0${i}Z`, status: "queued" as const }));
    db.lines = {
      lines: 2,
      onLine: [{ id: "x1", shopId: "other", scheduledAt: "2026-10-21T05:00:00Z", status: "in_progress" }],
      waiting: [...mine, { id: "x2", shopId: "other", scheduledAt: "2026-10-21T05:00:00Z", status: "queued" }],
    };
    const spots = callItems(db).filter((x) => x.call.status === "queued").map((x) => x.queue!);
    // The other shop already has a call on the line, so this shop's oldest call goes first.
    expect(spots.map((s) => s.position)).toEqual([1, 3, 4]);
    expect(spots[0]).toMatchObject({ lines: 2, busyLines: 1, waitSeconds: 0 });
  });
});

describe("ask your khata", () => {
  const ask = (q: string, db = fresh(), scheduled: ScheduleInput[] = []) =>
    answerQuestion(db, q, NOW, async (input) => {
      scheduled.push(input);
      return schedule(db, input);
    });

  it("understands Hinglish, Bengali and English", async () => {
    expect((await ask("Kaun is hafte dega?")).tool).toMatch(/^list_promises/);
    expect((await ask("এই সপ্তাহে কে দেবে?")).tool).toMatch(/^list_promises/);
    expect((await ask("Ramesh ka kitna baaki hai?")).answer).toContain("₹350");
    expect((await ask("any disputes?")).tool).toMatch(/^list_disputes/);
    expect((await ask("who broke a promise")).answer).toMatch(/1 customer/);
    expect((await ask("what did customers ask for")).tool).toMatch(/^find_notes/);
  });

  it("schedules a call when asked", async () => {
    const scheduled: ScheduleInput[] = [];
    const a = await ask("Ramesh ko kal call karo", fresh(), scheduled);
    expect(a.tool).toMatch(/^schedule_call/);
    expect(scheduled).toEqual([expect.objectContaining({ customerIds: ["c01"] })]);
    expect(a.action?.href).toMatch(/^\/app\/calls\/test-k/);
  });
});

describe("evening report", () => {
  it("reads naturally when nobody promised anything today", () => {
    const r = dailyReport(fresh(), NOW);
    expect(r.spoken.en).toContain("No new promises today");
    expect(r.spoken.en).not.toMatch(/\(s\)/);
    expect(r.spoken.en).not.toMatch(/[ऀ-ॿ]/); // no Devanagari in the English text
  });
});
