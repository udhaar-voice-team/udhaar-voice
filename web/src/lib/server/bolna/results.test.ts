import { describe, expect, it } from "vitest";
import { findAnswer, parsePlan, parseTranscript, planCallResult, toCallStatus, toExtraction } from "./results";

const answer = (objective: string | null, subjective = "", confidence = 0.9) => ({
  subjective,
  objective,
  confidence,
  confidence_label: "High",
  reasoning_subjective: null,
  reasoning_objective: null,
  validation: null,
});

const extracted = (fields: Record<string, ReturnType<typeof answer>>) => ({ "Udhaar Voice": fields });

describe("call status from Bolna", () => {
  it("maps Bolna's statuses to ours", () => {
    expect(toCallStatus({ status: "in-progress" })).toBe("in_progress");
    expect(toCallStatus({ status: "initiated" })).toBe("ringing");
    expect(toCallStatus({ status: "no-answer" })).toBe("no_answer");
    expect(toCallStatus({ status: "balance-low" })).toBe("failed");
    expect(toCallStatus({ status: "completed", conversation_duration: 74 })).toBe("completed");
  });

  it("waits for 'completed', which carries the results, after 'call-disconnected'", () => {
    expect(toCallStatus({ status: "call-disconnected", conversation_duration: 0 })).toBe("in_progress");
  });

  it("counts a call the customer spoke on as answered even if its length isn't in yet", () => {
    expect(toCallStatus({ status: "completed", conversation_duration: 0, transcript: "assistant: Namaste\nuser: haan" })).toBe("completed");
  });

  it("counts a call nobody spoke on, or voicemail, as unanswered", () => {
    expect(toCallStatus({ status: "completed", conversation_duration: 0 })).toBe("no_answer");
    expect(toCallStatus({ status: "completed", conversation_duration: 30, answered_by_voice_mail: true })).toBe("no_answer");
  });
});

describe("transcript", () => {
  it("splits Bolna's lines into turns, joining wrapped lines", () => {
    const turns = parseTranscript("assistant: Namaskar\nuser: haan bolo\nthis continues\nassistant: Dhonnobad", "reminder", 30);
    expect(turns.map((t) => [t.speaker, t.text])).toEqual([
      ["agent", "Namaskar"],
      ["customer", "haan bolo this continues"],
      ["agent", "Dhonnobad"],
    ]);
    expect(turns[2].at).toBe(20);
  });

  it("labels the other side the shopkeeper on summary calls", () => {
    expect(parseTranscript("user: thik ache", "report")[0].speaker).toBe("shopkeeper");
  });
});

describe("reading extractions", () => {
  it("finds an answer by name in any category, or flat", () => {
    expect(findAnswer(extracted({ "Call outcome": answer("promised") }), "call outcome")?.value).toBe("promised");
    expect(findAnswer({ "Payment plan": "500 on 2026-10-30" }, "Payment plan")?.value).toBe("500 on 2026-10-30");
    expect(findAnswer(null, "x")).toBeUndefined();
  });

  it("builds a promise from the amount and the exact date", () => {
    const ex = toExtraction(
      { extracted_data: extracted({ "Call outcome": answer("promised"), "Payment plan": answer(null, "₹500 on 2026-10-30") }), summary: "Will pay Friday." },
      "completed",
    );
    expect(ex).toMatchObject({ outcome: "promised", promises: [{ amount: 500, dueDate: "2026-10-30" }], summary: "Will pay Friday.", confidence: 0.9 });
  });

  it("keeps a promise in parts as one promise per part, not their total on the last date", () => {
    const ex = toExtraction(
      {
        extracted_data: extracted({
          "Call outcome": answer("promised"),
          "Payment plan": answer(null, "2000 on 2026-10-30; 6200 on 2026-11-30"),
        }),
      },
      "completed",
    );
    expect(ex.promises).toEqual([
      { amount: 2000, dueDate: "2026-10-30" },
      { amount: 6200, dueDate: "2026-11-30" },
    ]);
    expect(ex.summary).toBe("Promised ₹2,000 by 2026-10-30, then ₹6,200 by 2026-11-30.");
  });

  it("reads a payment plan written a few ways", () => {
    expect(parsePlan("₹6,200 by 2026-11-30, ₹2,000 rupees on 2026-10-30")).toEqual([
      { amount: 2000, dueDate: "2026-10-30" },
      { amount: 6200, dueDate: "2026-11-30" },
    ]);
    expect(parsePlan("500 - 2026-10-30")).toEqual([{ amount: 500, dueDate: "2026-10-30" }]);
    expect(parsePlan("")).toEqual([]);
    expect(parsePlan("next month")).toEqual([]);
  });

  it("skips a promise without a usable date rather than guessing one", () => {
    const ex = toExtraction({ extracted_data: extracted({ "Call outcome": answer("promised"), "Payment plan": answer(null, "500 on Friday") }) }, "completed");
    expect(ex.promises).toEqual([]);
  });

  it("records a dispute, products and a callback time in Indian time", () => {
    const ex = toExtraction(
      {
        extracted_data: extracted({
          "Call outcome": answer("disputed"),
          "Dispute type": answer("already_paid"),
          "Dispute details": answer(null, "Says she paid ₹200 by UPI last week."),
          "Products asked for": answer(null, "Maggi, Parle-G"),
          "Call back time": answer(null, "2026-10-29 18:30"),
        }),
      },
      "completed",
    );
    expect(ex.dispute).toEqual({ kind: "already_paid", reason: "Says she paid ₹200 by UPI last week.", amount: undefined });
    expect(ex.notes.map((n) => n.product)).toEqual(["Maggi", "Parle-G"]);
    expect(ex.callbackAt).toBe("2026-10-29T13:00:00.000Z");
  });

  it("doesn't turn an opt-out into a dispute because the dispute type said 'other'", () => {
    const ex = toExtraction({ extracted_data: extracted({ "Call outcome": answer("opted_out"), "Dispute type": answer("other"), "Dispute details": answer(null, "Asked not to be called.") }) }, "completed");
    expect(ex.dispute).toBeUndefined();
    const paid = toExtraction({ extracted_data: extracted({ "Call outcome": answer("refused"), "Dispute type": answer("already_paid") }) }, "completed");
    expect(paid.dispute?.kind).toBe("already_paid");
  });

  it("treats an unanswered call as no answer whatever was extracted", () => {
    expect(toExtraction({ extracted_data: extracted({ "Call outcome": answer("promised") }) }, "no_answer").outcome).toBe("no_answer");
  });

  it("ignores empty answers like 'none'", () => {
    const ex = toExtraction({ extracted_data: extracted({ "Call outcome": answer("refused"), "Products asked for": answer(null, "none"), "Other things to remember": answer(null, "N/A") }) }, "completed");
    expect(ex.notes).toEqual([]);
    expect(ex.dispute).toBeUndefined();
  });
});

describe("what a call adds to the khata", () => {
  const ex = toExtraction(
    {
      extracted_data: extracted({
        "Call outcome": answer("promised"),
        "Payment plan": answer(null, "500 on 2026-10-30"),
        "Products asked for": answer(null, "Maggi"),
      }),
    },
    "completed",
  );

  it("adds new promises and notes", () => {
    const plan = planCallResult({ id: "k1", customerId: "c1" }, ex, { promises: [], disputes: [], notes: [] });
    expect(plan.promises).toEqual([{ amount: 500, dueDate: "2026-10-30" }]);
    expect(plan.notes).toHaveLength(1);
    expect(plan.optOut).toBe(false);
  });

  it("doesn't repeat a promise or note already recorded for the customer", () => {
    const plan = planCallResult({ id: "k1", customerId: "c1" }, ex, {
      promises: [{ id: "p", customerId: "c1", amount: 500, dueDate: "2026-10-30", status: "open", createdAt: "" }],
      disputes: [],
      notes: [{ id: "n", customerId: "c1", kind: "product_demand", text: "Asked the shop to keep Maggi.", product: "Maggi", createdAt: "" }],
    });
    expect(plan.promises).toEqual([]);
    expect(plan.notes).toEqual([]);
  });

  it("opts the customer out when they ask", () => {
    const out = toExtraction({ extracted_data: extracted({ "Call outcome": answer("opted_out") }) }, "completed");
    expect(planCallResult({ id: "k1", customerId: "c1" }, out, { promises: [], disputes: [], notes: [] }).optOut).toBe(true);
  });
});
