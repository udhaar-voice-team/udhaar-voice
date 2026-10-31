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

/** Gives a customer another ₹`amount` of dues, so the minimum for a call doesn't decide the test. */
const owes = (db: ShopData, id: string, amount = 500) =>
  db.entries.push({ id: `extra-${id}`, customerId: id, amount, items: "", date: "2026-10-01", source: "manual", createdAt: "2026-10-01T10:00:00Z" });

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
    owes(db, "c11");
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
    owes(db, "c03");
    const auto = planSchedule(db, { customerIds: ["c01", "c03", "c02", "c10"], at: "now", language: "auto", bypassHours: false }, NOW);
    // Oldest dues first: Bapi's extra dues are from 1 October.
    expect(auto.kind === "batch" && auto.calls.map((c) => [c.customerId, c.language])).toEqual([
      ["c03", "bn"],
      ["c01", "hi"],
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

describe("plans and the reminder steps", () => {
  it("calls only from a plan or a call pack", () => {
    const db = fresh();
    db.shop.plan = "free";
    expect(eligibility(db, "c13")?.reason).toMatch(/Asha plan/);
    db.shop.extraCalls = 10;
    expect(eligibility(db, "c13")?.eligible).toBe(true);
  });

  it("keeps small dues to WhatsApp", () => {
    expect(eligibility(fresh(), "c06")?.reason).toMatch(/WhatsApp reminders only/);
  });

  it("can call at once, and suggests WhatsApp first until a reminder has had three days with no payment", () => {
    const db = fresh();
    db.usage.whatsapp = [];
    expect(eligibility(db, "c12")).toMatchObject({ eligible: true, note: expect.stringMatching(/No WhatsApp reminder yet/) });
    db.usage.whatsapp = [{ customerId: "c12", at: "2026-10-20T10:00:00" }];
    expect(eligibility(db, "c12")).toMatchObject({ eligible: true, note: expect.stringMatching(/Waiting until Fri 23 Oct/) });
    db.usage.whatsapp = [{ customerId: "c12", at: "2026-10-17T10:00:00" }];
    expect(eligibility(db, "c12")?.note).toBeUndefined();
    db.payments.push({ id: "p-new", customerId: "c12", amount: 100, method: "cash", date: "2026-10-20", createdAt: "2026-10-20T12:00:00" });
    expect(eligibility(db, "c12")?.note).toMatch(/No WhatsApp reminder yet/);
  });

  it("waits for a promise's date, and calls once it is missed", () => {
    const db = fresh();
    db.promises.push({ id: "pr1", customerId: "c12", amount: 500, dueDate: "2026-10-25", status: "open", createdAt: "2026-10-20T10:00:00Z" });
    expect(eligibility(db, "c12")?.reason).toMatch(/Promised ₹500 by/);
    db.promises[db.promises.length - 1].dueDate = "2026-10-19";
    db.usage.whatsapp = [];
    expect(eligibility(db, "c12")?.eligible).toBe(true);
  });

  it("calls a customer at most twice a month", () => {
    const db = fresh();
    for (const day of ["05", "12"]) {
      db.calls.push({ id: `k${day}`, shopId: db.shop.id, kind: "reminder", customerId: "c12", language: "bn", status: "completed", scheduledAt: `2026-10-${day}T10:00:00`, transcript: [], events: [] });
    }
    expect(eligibility(db, "c12")?.reason).toMatch(/2 times this month/);
  });

  it("calls the oldest and largest dues first when calls run short, then uses call packs", () => {
    const db = fresh();
    db.shop.plan = "free";
    db.shop.extraCalls = 1;
    const plan = planSchedule(db, { customerIds: ["c01", "c13", "c12"], at: "now", language: "auto", bypassHours: false }, NOW);
    expect(plan.kind === "batch" && plan.calls).toHaveLength(1);
    expect(plan.kind === "batch" && plan.packCalls).toBe(1);
    expect(plan.kind === "batch" && plan.skipped.map((s) => s.reason)).toEqual([expect.stringMatching(/No calls left/), expect.stringMatching(/No calls left/)]);
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
    owes(db, "c03");
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
  it("never suggests calling a customer who asked not to be called", () => {
    const db = fresh();
    const today = "2026-10-21";
    const sunita = db.customers.find((c) => c.id === "c02")!;
    sunita.optedOut = true;
    db.promises.push({ id: "p-today", customerId: "c02", amount: 400, dueDate: "2026-10-23", status: "open", createdAt: `${today}T05:00:00.000Z` });
    expect(dailyReport(db, NOW).spoken.en).not.toMatch(/Call Sunita/);
  });

  it("has a Hindi summary in Devanagari, with no Bengali in it", () => {
    const hi = dailyReport(fresh(), NOW).spoken.hi;
    expect(hi).toMatch(/[ऀ-ॿ]/);
    expect(hi).not.toMatch(/[ঀ-৿]/);
    expect(hi).toContain("आज किसी ने नया वादा नहीं किया");
  });

  it("flags a call that heard a promise but no amount or date", () => {
    const db = fresh();
    const ramesh = db.customers.find((c) => c.id === "c01")!;
    db.calls.push({
      id: "k-unclear",
      shopId: db.shop.id,
      kind: "reminder",
      customerId: ramesh.id,
      toNumber: ramesh.phone,
      language: "hi",
      status: "completed",
      scheduledAt: "2026-10-21T04:00:00.000Z",
      startedAt: "2026-10-21T04:00:05.000Z",
      transcript: [],
      events: [],
      extraction: { outcome: "promised", promises: [], notes: [], sentiment: "neutral", confidence: 0.9, summary: "Will pay soon." },
    });
    const flag = dashboard(db, NOW).attention.find((a) => a.callId === "k-unclear");
    expect(flag).toMatchObject({ kind: "low_confidence", text: expect.stringMatching(/no amount or date/) });
  });

  it("reads naturally when nobody promised anything today", () => {
    const r = dailyReport(fresh(), NOW);
    expect(r.spoken.en).toContain("No new promises today");
    expect(r.spoken.en).not.toMatch(/\(s\)/);
    expect(r.spoken.en).not.toMatch(/[ऀ-ॿ]/); // no Devanagari in the English text
  });
});
