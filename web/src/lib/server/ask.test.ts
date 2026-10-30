import { describe, expect, it, vi } from "vitest";
import { createSeed } from "@/lib/demo/seed";
import type { ScheduleInput } from "@/lib/api/contract";
import type { ShopData } from "./data";
import { fakeProvider } from "./fake-provider";
import { ask, runTool, TOOLS } from "./ask";
import { findCustomerByName } from "./queries";

const NOW = new Date("2026-10-21T11:00:00");
const fresh = (): ShopData => ({ ...createSeed(NOW), imports: [], lines: { lines: 2, onLine: [], waiting: [] } });
const noSchedule = async () => ({ skipped: [] as { customer: never; reason: string }[] });

describe("assistant tools", () => {
  it("declares every tool it can run", async () => {
    for (const t of TOOLS) {
      const args = t.name === "find_customer" || t.name === "schedule_call" ? { name: "Ramesh", when: "now" } : t.name === "list_promises" ? { range: "this_week" } : t.name === "list_collections" ? { period: "today" } : {};
      await expect(runTool(fresh(), NOW, t.name!, args, noSchedule)).resolves.toBeDefined();
    }
    await expect(runTool(fresh(), NOW, "drop_tables", {}, noSchedule)).rejects.toThrow(/Unknown tool/);
  });

  it("totals the shop", async () => {
    const r = await runTool(fresh(), NOW, "get_summary", {}, noSchedule);
    expect(r.data).toMatchObject({ pending: "₹9,560", customers_owing: 14, open_disputes: 1 });
  });

  it("finds a customer by first name and links to their page", async () => {
    const r = await runTool(fresh(), NOW, "find_customer", { name: "ramesh" }, noSchedule);
    expect(r.data).toMatchObject({ found: true, name: "Ramesh Yadav", owes: "₹350" });
    expect(r.action?.href).toBe("/app/customers/c01");
    expect((await runTool(fresh(), NOW, "find_customer", { name: "Nobody" }, noSchedule)).data).toEqual({ found: false });
  });

  it("lists open promises by range, and missed ones as overdue", async () => {
    const week = await runTool(fresh(), NOW, "list_promises", { range: "this_week" }, noSchedule);
    const overdue = await runTool(fresh(), NOW, "list_promises", { range: "overdue" }, noSchedule);
    expect(week.items?.every((i) => i.href?.startsWith("/app/customers/"))).toBe(true);
    expect(overdue.items?.map((i) => i.label)).toContain("Deepak Kumar");
  });

  it("lists the open dispute", async () => {
    const r = await runTool(fresh(), NOW, "list_disputes", {}, noSchedule);
    expect(r.items?.map((i) => i.label)).toEqual(["Priya Sharma"]);
  });

  it("won't schedule someone who can't be called, and says why", async () => {
    let asked = false;
    const r = await runTool(fresh(), NOW, "schedule_call", { name: "Anjali", when: "now" }, async () => {
      asked = true;
      return { skipped: [] };
    });
    expect(r.data).toEqual({ scheduled: false, reason: "Asked not to be called" });
    expect(asked).toBe(false);
  });

  it("schedules tomorrow morning inside calling hours", async () => {
    let input: ScheduleInput | undefined;
    await runTool(fresh(), NOW, "schedule_call", { name: "Ramesh", when: "tomorrow_morning" }, async (i) => {
      input = i;
      return { skipped: [] };
    });
    expect(new Date(input!.at).getHours()).toBe(10);
    expect(input!.customerIds).toEqual(["c01"]);
  });
});

describe("asking through the providers", () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  const answering = fakeProvider("meta", {
    answerWithTools: async (_q, _tools, run) => {
      await run("get_summary", {});
      return { answer: "₹9,560 is pending.", calls: [{ name: "get_summary", args: {} }] };
    },
  });

  it("hands over to Meta when Gemini fails, and Meta answers with the tools", async () => {
    const providers = [fakeProvider("gemini"), answering];
    expect(await ask(fresh(), "how much is pending?", NOW, noSchedule, undefined, providers)).toEqual({ next: "meta" });
    const step = await ask(fresh(), "how much is pending?", NOW, noSchedule, "meta", providers);
    expect(step).toMatchObject({ result: { answer: "₹9,560 is pending.", tool: "get_summary()" } });
  });

  it("falls back to keywords when every provider fails, or none is set up", async () => {
    const failed = await ask(fresh(), "how much is pending in total?", NOW, noSchedule, "meta", [fakeProvider("gemini"), fakeProvider("meta")]);
    expect(failed).toMatchObject({ result: { question: "how much is pending in total?" } });
    const none = await ask(fresh(), "how much is pending in total?", NOW, noSchedule, undefined, []);
    expect("result" in none).toBe(true);
  });
});

describe("finding a customer named in a question", () => {
  it("matches whole words, so a longer name isn't mistaken for a shorter one", () => {
    const c = fresh().customers[0];
    const db = { ...fresh(), customers: [{ ...c, id: "amit", name: "Amit Sharma", nameNative: undefined }] };
    expect(findCustomerByName(db, "How much does Amit owe?")?.id).toBe("amit");
    expect(findCustomerByName(db, "amit sharma's dues")?.id).toBe("amit");
    expect(findCustomerByName(db, "How much does Amitabh owe?")).toBeUndefined();
  });
});
