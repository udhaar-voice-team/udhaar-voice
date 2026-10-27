import { addDays, format } from "date-fns";
import { formatINR, isPromiseBroken, toDateKey } from "@/lib/domain/rules";
import type { AskAnswer, ScheduleInput, ScheduleResult } from "@/lib/api/contract";
import type { ShopData } from "./data";
import { candidates, customerSummary, findCustomerByName, fmtDay, summaries } from "./queries";

/**
 * "Ask your khata" without an LLM, until Gemini answers instead: keyword intents mapped to the
 * tools the model will call (get_summary, list_promises, ...).
 */

const has = (q: string, words: string[]) => words.some((w) => q.includes(w));

const WORDS = {
  call: ["call", "phone", "ring", "ফোন", "फ़ोन", "फोन", "कॉल"],
  tomorrow: ["tomorrow", "kal", "কাল", "कल"],
  week: ["week", "hafte", "hafta", "সপ্তাহ", "सप्ताह", "हफ्ते", "हफ़्ते"],
  whoPays: ["who will pay", "kaun", "dega", "dene", "কে ", "দেবে", "कौन", "देगा", "देंगे"],
  today: ["today", "aaj", "আজ", "आज"],
  dispute: ["dispute", "jhagda", "galat", "wrong amount", "বিবাদ", "ঝামেলা", "झगड़ा", "गलत"],
  broken: ["broke", "missed", "toda", "tod", "didn't pay", "did not pay", "রাখেনি", "वादा"],
  product: ["stock", "ask for", "asked for", "want", "demand", "chahiye", "mangaya", "চেয়েছে", "চেয়েছিল", "চাইছে", "চায়", "माँग", "मांग", "चाहिए", "maggi"],
  balance: ["kitna", "how much", "baaki", "baki", "balance", "pending", "owe", "কত", "বাকি", "कितना", "बाकी"],
  total: ["total", "overall", "sab", "সব", "कुल"],
};

export async function answerQuestion(
  db: ShopData,
  question: string,
  now: Date,
  schedule: (input: ScheduleInput) => Promise<ScheduleResult>,
): Promise<AskAnswer> {
  const q = ` ${question.toLowerCase().trim()} `;
  const named = findCustomerByName(db, q);

  // schedule_call: "Ramesh ko kal call karo", "call Sunita tomorrow"
  if (named && has(q, WORDS.call)) {
    const when = addDays(now, has(q, WORDS.tomorrow) ? 1 : 0);
    if (has(q, WORDS.tomorrow)) when.setHours(10, 0, 0, 0);
    const eligible = candidates(db, now).find((c) => c.customer.id === named.id);
    if (!eligible?.eligible) {
      return {
        question,
        tool: `schedule_call(name: "${named.name}")`,
        answer: `I can't call ${named.name} right now: ${eligible?.reason ?? "not eligible"}.`,
      };
    }
    const result = await schedule({ customerIds: [named.id], at: has(q, WORDS.tomorrow) ? when.toISOString() : "now", language: "auto", bypassHours: db.shop.demoBypassHours });
    if (result.outsideHours) {
      const hour = (h: number) => format(new Date(2026, 0, 1, h), "h a");
      return {
        question,
        tool: `schedule_call(name: "${named.name}")`,
        answer: `That's outside calling hours (${hour(result.outsideHours.start)}–${hour(result.outsideHours.end)}). Tell me a time inside them.`,
      };
    }
    const at = result.batch?.scheduledAt ?? when.toISOString();
    return {
      question,
      tool: `schedule_call(name: "${named.name}", when: "${format(new Date(at), "EEE h:mm a")}")`,
      answer: `Done. I'll call ${named.name} ${format(new Date(at), "EEEE 'at' h:mm a")}.`,
      action: { label: "See the scheduled call", href: result.batch ? `/app/calls/${result.batch.callIds[0]}` : "/app/calls" },
    };
  }

  // list_promises(range: "week")
  if (has(q, WORDS.week) || (has(q, WORDS.whoPays) && !named)) {
    const today = toDateKey(now);
    const end = toDateKey(addDays(now, 6));
    const list = db.promises
      .filter((p) => p.status === "open" && p.dueDate >= today && p.dueDate <= end)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const total = list.reduce((s, p) => s + p.amount, 0);
    return {
      question,
      tool: `list_promises(range: "next_7_days")`,
      answer: list.length
        ? `${list.length} ${list.length === 1 ? "customer has" : "customers have"} promised ${formatINR(total)} in the next 7 days.`
        : "Nobody has promised to pay in the next 7 days yet.",
      items: list.map((p) => {
        const c = db.customers.find((x) => x.id === p.customerId);
        return { label: c?.name ?? "Unknown", value: `${formatINR(p.amount)} · ${fmtDay(p.dueDate)}`, href: c ? `/app/customers/${c.id}` : undefined };
      }),
    };
  }

  // get_summary(date: "today")
  if (has(q, WORDS.today)) {
    const today = toDateKey(now);
    const collected = db.payments.filter((p) => p.date === today);
    const promised = db.promises.filter((p) => toDateKey(new Date(p.createdAt)) === today);
    const sum = (xs: { amount: number }[]) => xs.reduce((s, x) => s + x.amount, 0);
    return {
      question,
      tool: `get_summary(date: "${today}")`,
      answer: `Today ${formatINR(sum(collected))} came in from ${collected.length} ${collected.length === 1 ? "customer" : "customers"}, and ${promised.length} new ${promised.length === 1 ? "promise" : "promises"} worth ${formatINR(sum(promised))} were made.`,
      items: collected.map((p) => {
        const c = db.customers.find((x) => x.id === p.customerId);
        return { label: c?.name ?? "Unknown", value: `${formatINR(p.amount)} · ${p.method.toUpperCase()}`, href: c ? `/app/customers/${c.id}` : undefined };
      }),
    };
  }

  // list_disputes(status: "open")
  if (has(q, WORDS.dispute)) {
    const open = db.disputes.filter((d) => d.status === "open");
    return {
      question,
      tool: `list_disputes(status: "open")`,
      answer: open.length ? `${open.length} open ${open.length === 1 ? "dispute" : "disputes"} to check.` : "No open disputes.",
      items: open.map((d) => {
        const c = db.customers.find((x) => x.id === d.customerId);
        return { label: c?.name ?? "Unknown", value: d.reason, href: c ? `/app/customers/${c.id}` : undefined };
      }),
    };
  }

  // list_broken_promises()
  if (has(q, WORDS.broken)) {
    const counts = new Map<string, number>();
    for (const p of db.promises) if (isPromiseBroken(p, now)) counts.set(p.customerId, (counts.get(p.customerId) ?? 0) + 1);
    const list = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    return {
      question,
      tool: "list_broken_promises()",
      answer: list.length ? `${list.length} ${list.length === 1 ? "customer has" : "customers have"} missed a promise.` : "Nobody has missed a promise.",
      items: list.map(([id, n]) => {
        const c = db.customers.find((x) => x.id === id);
        return { label: c?.name ?? "Unknown", value: `${n} missed`, href: `/app/customers/${id}` };
      }),
    };
  }

  // find_notes(kind: "product_demand")
  if (has(q, WORDS.product)) {
    const notes = db.notes.filter((n) => n.kind === "product_demand");
    const byProduct = new Map<string, string[]>();
    for (const n of notes) {
      const c = db.customers.find((x) => x.id === n.customerId);
      byProduct.set(n.product ?? n.text, [...(byProduct.get(n.product ?? n.text) ?? []), c?.name ?? "Unknown"]);
    }
    return {
      question,
      tool: `find_notes(kind: "product_demand")`,
      answer: byProduct.size ? `Customers asked for ${[...byProduct.keys()].join(", ")}.` : "No product requests from customers yet.",
      items: [...byProduct.entries()].map(([product, names]) => ({ label: product, value: `asked by ${names.join(", ")}` })),
    };
  }

  // get_customer(name)
  if (named) {
    const s = customerSummary(db, named, now);
    const next = s.nextPromise ? ` Next promise: ${formatINR(s.nextPromise.amount)} by ${fmtDay(s.nextPromise.dueDate)}.` : "";
    const dispute = s.openDispute ? ` Open dispute: ${s.openDispute.reason}.` : "";
    return {
      question,
      tool: `get_customer(name: "${named.name.split(" ")[0]}")`,
      answer:
        s.balance > 0
          ? `${named.name} owes ${formatINR(s.balance)}.${next}${dispute}`
          : `${named.name} has nothing pending.`,
      action: { label: `Open ${named.name.split(" ")[0]}'s page`, href: `/app/customers/${named.id}` },
    };
  }

  // get_summary()
  if (has(q, WORDS.balance) || has(q, WORDS.total)) {
    const owing = summaries(db, now).filter((s) => s.balance > 0);
    const total = owing.reduce((s, x) => s + x.balance, 0);
    return {
      question,
      tool: "get_summary()",
      answer: `${formatINR(total)} is pending from ${owing.length} customers. The largest dues are below.`,
      items: [...owing].sort((a, b) => b.balance - a.balance).slice(0, 4).map((s) => ({ label: s.customer.name, value: formatINR(s.balance), href: `/app/customers/${s.customer.id}` })),
    };
  }

  return {
    question,
    tool: "none",
    answer: "I didn't catch that. Try asking who will pay this week, how much someone owes, today's collection, open disputes, or tell me to call someone tomorrow.",
  };
}
