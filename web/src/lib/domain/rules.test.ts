import { describe, expect, it } from "vitest";
import {
  spokenName,
  balanceOf,
  batchStatus,
  buildMemory,
  canChangeBatchTime,
  canRemind,
  confidenceLabel,
  customerStatus,
  dialOrder,
  estimatedWaitSeconds,
  formatINR,
  formatPhone,
  isPromiseBroken,
  isWithinCallingHours,
  maskPhone,
  matchSavedEntry,
  normalizeIndianMobile,
  toDateKey,
  upiLink,
  byCallPriority,
  callsLeft,
  packCallsUsed,
  summaryCallToday,
  whatsappStep,
} from "./rules";
import type { Dispute, Note, PaymentPromise } from "./types";

const at = (iso: string) => new Date(iso);
const hours = { start: 8, end: 19 };

describe("balanceOf", () => {
  it("subtracts payments from entries", () => {
    expect(balanceOf([{ amount: 300 }, { amount: 150 }], [{ amount: 100 }])).toBe(350);
  });
  it("never goes negative", () => {
    expect(balanceOf([{ amount: 100 }], [{ amount: 250 }])).toBe(0);
  });
});

describe("customerStatus", () => {
  const now = at("2026-10-21T12:00:00");
  const base = { balance: 500, optedOut: false, promises: [], disputes: [] };

  it("is paid when nothing is owed, even with an open dispute", () => {
    expect(customerStatus({ ...base, balance: 0, disputes: [{ status: "open" }] }, now)).toBe("paid");
  });
  it("puts opt-out ahead of disputes and promises", () => {
    expect(customerStatus({ ...base, optedOut: true, disputes: [{ status: "open" }] }, now)).toBe("opted_out");
  });
  it("puts disputes ahead of promises", () => {
    expect(
      customerStatus({ ...base, disputes: [{ status: "open" }], promises: [{ status: "open", dueDate: "2026-10-25" }] }, now),
    ).toBe("disputed");
  });
  it("is overdue when an open promise's date has passed", () => {
    expect(customerStatus({ ...base, promises: [{ status: "open", dueDate: "2026-10-20" }] }, now)).toBe("overdue");
  });
  it("is promised when an open promise is today or later", () => {
    expect(customerStatus({ ...base, promises: [{ status: "open", dueDate: "2026-10-21" }] }, now)).toBe("promised");
  });
  it("is due otherwise", () => {
    expect(customerStatus({ ...base, promises: [{ status: "kept", dueDate: "2026-10-01" }] }, now)).toBe("due");
  });
});

describe("isPromiseBroken", () => {
  const now = at("2026-10-21T09:00:00");
  it("treats a promise due today as not yet broken", () => {
    expect(isPromiseBroken({ status: "open", dueDate: "2026-10-21" }, now)).toBe(false);
  });
  it("treats an open promise due yesterday as broken", () => {
    expect(isPromiseBroken({ status: "open", dueDate: "2026-10-20" }, now)).toBe(true);
  });
  it("never treats a kept promise as broken", () => {
    expect(isPromiseBroken({ status: "kept", dueDate: "2026-09-01" }, now)).toBe(false);
  });
});

describe("calling hours", () => {
  it("allows calls inside the window", () => {
    expect(isWithinCallingHours(at("2026-10-21T08:00:00"), hours)).toBe(true);
    expect(isWithinCallingHours(at("2026-10-21T18:59:00"), hours)).toBe(true);
  });
  it("blocks calls at the end hour and before the start", () => {
    expect(isWithinCallingHours(at("2026-10-21T19:00:00"), hours)).toBe(false);
    expect(isWithinCallingHours(at("2026-10-21T07:59:00"), hours)).toBe(false);
  });
});

describe("canRemind", () => {
  const now = at("2026-10-21T12:00:00");
  it("allows the first reminder", () => {
    expect(canRemind(undefined, 3, now)).toBe(true);
  });
  it("blocks a second reminder inside the gap", () => {
    expect(canRemind(at("2026-10-19T12:00:01"), 3, now)).toBe(false);
  });
  it("allows a reminder once the gap has passed", () => {
    expect(canRemind(at("2026-10-18T12:00:00"), 3, now)).toBe(true);
  });
});

describe("formatting", () => {
  it("uses Indian digit grouping", () => {
    expect(formatINR(124000)).toBe("₹1,24,000");
    expect(formatINR(350)).toBe("₹350");
  });
  it("masks all but the last four digits", () => {
    expect(maskPhone("+919000000112")).toBe("+91 ••••• •0112");
  });
  it("groups Indian mobiles as +91 98765 43210", () => {
    expect(formatPhone("+919876543210")).toBe("+91 98765 43210");
    expect(formatPhone("+14155550100")).toBe("+14155550100");
  });
  it("formats local dates without UTC drift", () => {
    expect(toDateKey(at("2026-10-21T23:30:00"))).toBe("2026-10-21");
  });
  it("labels confidence like Bolna", () => {
    expect(confidenceLabel(0.8)).toBe("High");
    expect(confidenceLabel(0.65)).toBe("Medium");
    expect(confidenceLabel(0.4)).toBe("Low");
  });
});

describe("normalizeIndianMobile", () => {
  it("accepts common ways of writing an Indian mobile number", () => {
    expect(normalizeIndianMobile("98765 43210")).toBe("+919876543210");
    expect(normalizeIndianMobile("+91 98765-43210")).toBe("+919876543210");
    expect(normalizeIndianMobile("098765 43210")).toBe("+919876543210");
  });
  it("rejects landlines and short numbers", () => {
    expect(normalizeIndianMobile("033 2582 0000")).toBeNull();
    expect(normalizeIndianMobile("12345")).toBeNull();
  });
});

describe("upiLink", () => {
  it("builds a standard upi:// link", () => {
    const link = upiLink({ upiId: "shop@upi", payeeName: "Maa Tara Stores", amount: 350 });
    expect(link.startsWith("upi://pay?")).toBe(true);
    const params = new URLSearchParams(link.split("?")[1]);
    expect(params.get("am")).toBe("350");
    // No fixed note, so the customer can write their own.
    expect(params.has("tn")).toBe(false);
  });
});

describe("buildMemory", () => {
  const now = at("2026-10-21T12:00:00");
  const fmt = (d: string) => d;
  const promise = (p: Partial<PaymentPromise>): PaymentPromise => ({
    id: "p",
    customerId: "c",
    amount: 350,
    dueDate: "2026-10-24",
    status: "open",
    createdAt: "2026-10-20T10:00:00",
    ...p,
  });

  it("mentions an upcoming promise", () => {
    expect(buildMemory({ promises: [promise({})], disputes: [], notes: [] }, now, fmt)).toContain("Promised ₹350 by 2026-10-24");
  });
  it("warns after two missed promises", () => {
    const memory = buildMemory(
      {
        promises: [
          promise({ id: "a", dueDate: "2026-10-01", createdAt: "2026-09-28T10:00:00" }),
          promise({ id: "b", dueDate: "2026-10-15", createdAt: "2026-10-10T10:00:00" }),
        ],
        disputes: [],
        notes: [],
      },
      now,
      fmt,
    );
    expect(memory).toContain("Has missed 2 promises");
  });
  it("tells the agent not to chase a disputed amount", () => {
    const dispute: Dispute = { id: "d", customerId: "c", kind: "already_paid", reason: "Says ₹200 was paid by UPI", status: "open", createdAt: "2026-10-20T10:00:00" };
    expect(buildMemory({ promises: [], disputes: [dispute], notes: [] }, now, fmt)).toContain("Do not ask for the disputed amount");
  });
  it("includes a life event note", () => {
    const note: Note = { id: "n", customerId: "c", kind: "life_event", text: "Pays after salary on the 5th.", createdAt: "2026-10-20T10:00:00" };
    expect(buildMemory({ promises: [], disputes: [], notes: [note] }, now, fmt)).toContain("salary on the 5th");
  });
  it("says so when there is no history", () => {
    expect(buildMemory({ promises: [], disputes: [], notes: [] }, now, fmt)).toBe("No previous calls.");
  });
});

describe("dialOrder", () => {
  const call = (id: string, shopId: string, minute: number) => ({ id, shopId, scheduledAt: `2026-10-21T10:${String(minute).padStart(2, "0")}:00.000Z` });

  it("takes turns between shops instead of serving one shop's batch first", () => {
    const waiting = [call("a1", "A", 0), call("a2", "A", 1), call("a3", "A", 2), call("b1", "B", 5)];
    expect(dialOrder(waiting, []).map((c) => c.id)).toEqual(["a1", "b1", "a2", "a3"]);
  });
  it("gives the next line to the shop with fewer calls already on the line", () => {
    const waiting = [call("a1", "A", 0), call("b1", "B", 5)];
    expect(dialOrder(waiting, [{ shopId: "A" }]).map((c) => c.id)).toEqual(["b1", "a1"]);
  });
  it("serves a shop's own calls in the order they were scheduled", () => {
    expect(dialOrder([call("late", "A", 9), call("early", "A", 1)], []).map((c) => c.id)).toEqual(["early", "late"]);
  });
});

describe("estimatedWaitSeconds", () => {
  const lines = { lines: 2, avgCallSeconds: 90 };
  it("is zero while a line is free", () => {
    expect(estimatedWaitSeconds(0, { ...lines, freeLines: 1 })).toBe(0);
  });
  it("adds one average call for each round of lines ahead", () => {
    expect(estimatedWaitSeconds(0, { ...lines, freeLines: 0 })).toBe(90);
    expect(estimatedWaitSeconds(1, { ...lines, freeLines: 0 })).toBe(90);
    expect(estimatedWaitSeconds(2, { ...lines, freeLines: 0 })).toBe(180);
  });
});

describe("matchSavedEntry", () => {
  const saved = [{ id: "e1", date: "2026-10-20", amount: 120, items: "Rice 2 kg" }];
  it("spots a row that was saved before", () => {
    expect(matchSavedEntry({ date: "2026-10-20", amount: 120, items: "rice 2kg" }, saved)?.kind).toBe("duplicate");
  });
  it("spots a changed amount by the same items", () => {
    expect(matchSavedEntry({ date: "2026-10-20", amount: 150, items: "Rice, 2 kg" }, saved)).toEqual({ kind: "changed", entry: saved[0] });
  });
  it("spots a changed amount by what was crossed out", () => {
    expect(matchSavedEntry({ date: "2026-10-20", amount: 150, items: "চাল", struckAmount: 120 }, saved)?.kind).toBe("changed");
  });
  it("treats other days and other items as new", () => {
    expect(matchSavedEntry({ date: "2026-10-21", amount: 120, items: "Rice 2 kg" }, saved)).toBeUndefined();
    expect(matchSavedEntry({ date: "2026-10-20", amount: 40, items: "Milk" }, saved)).toBeUndefined();
  });
});

describe("batchStatus", () => {
  it("is scheduled until a call starts, then running", () => {
    expect(batchStatus(["scheduled", "scheduled"])).toBe("scheduled");
    expect(batchStatus(["scheduled", "cancelled"])).toBe("scheduled");
    expect(batchStatus(["queued", "scheduled"])).toBe("running");
    expect(batchStatus(["completed", "scheduled"])).toBe("running");
  });
  it("is completed when some calls ran and the rest were removed", () => {
    expect(batchStatus(["completed", "no_answer"])).toBe("completed");
    expect(batchStatus(["completed", "cancelled"])).toBe("completed");
  });
  it("is cancelled only when no call ran", () => {
    expect(batchStatus(["cancelled", "cancelled"])).toBe("cancelled");
  });
});

describe("canChangeBatchTime", () => {
  it("allows it while every remaining call is waiting for its time", () => {
    expect(canChangeBatchTime(["scheduled", "cancelled"])).toBe(true);
  });
  it("refuses once dialing started, or when nothing is left to move", () => {
    expect(canChangeBatchTime(["queued", "scheduled"])).toBe(false);
    expect(canChangeBatchTime(["completed", "scheduled"])).toBe(false);
    expect(canChangeBatchTime(["cancelled"])).toBe(false);
  });
});

describe("spoken name", () => {
  it("uses the khata's native name only when it's in the call language's script", () => {
    const tapas = { name: "Tapas Biswas", nameNative: "তাপস বিশ্বাস" };
    expect(spokenName(tapas, "bn")).toBe("তাপস বিশ্বাস");
    expect(spokenName(tapas, "hi")).toBe("Tapas Biswas");
    expect(spokenName({ name: "Ramesh Yadav", nameNative: "रमेश यादव" }, "hi")).toBe("रमेश यादव");
    expect(spokenName(tapas, "en")).toBe("Tapas Biswas");
    expect(spokenName({ name: "Haru Kaka" }, "bn")).toBe("Haru Kaka");
  });
});

describe("plans", () => {
  const now = new Date("2026-10-21T11:00:00");

  it("counts this month's calls first, then call packs", () => {
    expect(callsLeft("asha", 20, 10)).toEqual({ monthly: 5, extra: 10, total: 15 });
    expect(callsLeft("free", 0, 0).total).toBe(0);
    expect(packCallsUsed("asha", 20, 8)).toBe(3);
    expect(packCallsUsed("asha", 0, 8)).toBe(0);
  });

  it("makes the summary a call daily on Asha Plus, on Saturdays on Asha, never on the free plan", () => {
    const saturday = new Date("2026-10-24T20:00:00");
    expect(summaryCallToday("asha_plus", now)).toBe(true);
    expect(summaryCallToday("asha", now)).toBe(false);
    expect(summaryCallToday("asha", saturday)).toBe(true);
    expect(summaryCallToday("free", saturday)).toBe(false);
  });

  it("lets Asha call three days after a WhatsApp reminder with no payment since", () => {
    expect(whatsappStep([], undefined, now)).toEqual({ ready: false });
    expect(whatsappStep([new Date("2026-10-17T10:00:00")], undefined, now)).toEqual({ ready: true });
    expect(whatsappStep([new Date("2026-10-20T10:00:00")], undefined, now)).toMatchObject({ ready: false, callableFrom: new Date("2026-10-23T10:00:00") });
    expect(whatsappStep([new Date("2026-10-17T10:00:00")], new Date("2026-10-18T10:00:00"), now)).toEqual({ ready: false });
    expect(whatsappStep([new Date("2026-09-01T10:00:00")], undefined, now)).toEqual({ ready: false });
  });

  it("puts the oldest dues first, then the largest", () => {
    const list = [
      { id: "a", oldestDue: "2026-10-10", balance: 500 },
      { id: "b", oldestDue: "2026-10-01", balance: 100 },
      { id: "c", oldestDue: "2026-10-10", balance: 900 },
    ];
    expect([...list].sort(byCallPriority).map((x) => x.id)).toEqual(["b", "c", "a"]);
  });
});
