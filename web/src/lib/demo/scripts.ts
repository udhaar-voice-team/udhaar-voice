import { toDateKey } from "@/lib/domain/rules";
import type { Extraction, Language, Turn } from "@/lib/domain/types";

/**
 * Scripted reminder conversations: the demo shop's call history, and the /try page's demo call
 * until it dials for real. Real calls get transcripts and extractions from Bolna's webhook.
 * Also the evening summary's script.
 */

export type Persona =
  | "promise"
  | "salary"
  | "callback"
  | "upi_tonight"
  | "dispute_paid"
  | "no_answer"
  | "partial"
  | "refuse"
  | "promise_product"
  | "opt_out"
  | "wrong_number"
  | "family_mother"
  | "family_son"
  | "repeat_breaker"
  | "paid_up";

export type ScriptContext = {
  now: Date;
  customer: { name: string; nameNative?: string; language: Language };
  /** Amount the agent asks about (current balance). */
  amount: number;
  openPromise?: { amount: number; dueDate: string };
  hasOpenDispute?: boolean;
  /** Promises this customer has already missed. */
  missedPromises?: { amount: number; dueDate: string }[];
};

export type ScriptResult = { answered: boolean; turns: Turn[]; extraction: Extraction };

const SHOP = { en: "Maa Tara Variety Stores", bn: "মা তারা ভ্যারাইটি স্টোর্স", hi: "माँ तारा वैरायटी स्टोर्स" };

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
const BN_DAYS = ["রবিবার", "সোমবার", "মঙ্গলবার", "বুধবার", "বৃহস্পতিবার", "শুক্রবার", "শনিবার"];
const HI_DAYS = ["रविवार", "सोमवार", "मंगलवार", "बुधवार", "गुरुवार", "शुक्रवार", "शनिवार"];
const EN_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const BN_MONTHS = ["জানুয়ারি", "ফেব্রুয়ারি", "মার্চ", "এপ্রিল", "মে", "জুন", "জুলাই", "আগস্ট", "সেপ্টেম্বর", "অক্টোবর", "নভেম্বর", "ডিসেম্বর"];
const HI_MONTHS = ["जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितंबर", "अक्टूबर", "नवंबर", "दिसंबर"];
const EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const bnNum = (n: number) => n.toLocaleString("en-IN").replace(/\d/g, (d) => BN_DIGITS[Number(d)]);
const hiNum = (n: number) => n.toLocaleString("en-IN");
const rs = (n: number) => `₹${n.toLocaleString("en-IN")}`;

export function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

/** The next given weekday strictly after `from` (0 = Sunday). */
export function nextWeekday(from: Date, dow: number): Date {
  const ahead = (dow - from.getDay() + 7) % 7 || 7;
  return addDays(from, ahead);
}

/** The next 5th of the month (salary day) after `from`. */
function nextFifth(from: Date): Date {
  const d = new Date(from);
  if (d.getDate() >= 5) d.setMonth(d.getMonth() + 1);
  d.setDate(5);
  return d;
}

const dayName = (d: Date, lang: Language) => (lang === "bn" ? BN_DAYS : lang === "hi" ? HI_DAYS : EN_DAYS)[d.getDay()];
const dateName = (d: Date, lang: Language) =>
  lang === "bn"
    ? `${bnNum(d.getDate())} ${BN_MONTHS[d.getMonth()]}`
    : lang === "hi"
      ? `${d.getDate()} ${HI_MONTHS[d.getMonth()]}`
      : `${d.getDate()} ${EN_MONTHS[d.getMonth()]}`;
const enDay = (d: Date) => `${EN_DAYS[d.getDay()].slice(0, 3)} ${d.getDate()} ${EN_MONTHS[d.getMonth()]}`;

type Line = [speaker: Turn["speaker"], text: string, gloss: string];

/** Assigns start times: roughly how long each line takes to say, with short pauses. */
function timeLines(lines: Line[]): Turn[] {
  let t = 0.6;
  return lines.map(([speaker, text, gloss]) => {
    const turn: Turn = { speaker, text, gloss, at: Math.round(t * 10) / 10 };
    t += Math.min(8.5, Math.max(2, 1.3 + text.length * 0.055)) + 0.5;
    return turn;
  });
}

/** Total spoken length of a timed transcript, in seconds. */
export function transcriptSeconds(turns: Turn[]): number {
  const last = turns[turns.length - 1];
  if (!last) return 0;
  return Math.round(last.at + Math.min(8.5, Math.max(2, 1.3 + last.text.length * 0.055)) + 1);
}

function greet(ctx: ScriptContext): Line[] {
  const { name, nameNative, language } = ctx.customer;
  const native = nameNative ?? name;
  if (language === "bn")
    return [
      ["agent", `নমস্কার, আমি আশা, ${SHOP.bn}-এর AI সহকারী বলছি। আপনি কি ${native} বলছেন?`, `Hello, I'm Asha, the AI assistant of ${SHOP.en}. Am I speaking with ${name}?`],
      ["customer", "হ্যাঁ, বলুন।", "Yes, go ahead."],
    ];
  if (language === "hi")
    return [
      ["agent", `नमस्ते, मैं आशा बोल रही हूँ, ${SHOP.hi} की AI सहायक। क्या मेरी बात ${native} जी से हो रही है?`, `Hello, I'm Asha, the AI assistant of ${SHOP.en}. Am I speaking with ${name}?`],
      ["customer", "हाँ, बोलिए।", "Yes, go ahead."],
    ];
  return [
    ["agent", `Hello, this is Asha, the AI assistant of ${SHOP.en}. Am I speaking with ${name}?`, `Hello, this is Asha, the AI assistant of ${SHOP.en}. Am I speaking with ${name}?`],
    ["customer", "Yes, go ahead.", "Yes, go ahead."],
  ];
}

function ask(ctx: ScriptContext): Line {
  const a = ctx.amount;
  if (ctx.customer.language === "bn")
    return ["agent", `আপনার খাতায় ${bnNum(a)} টাকা বাকি আছে। কবে নাগাদ দিতে পারবেন?`, `You have ${rs(a)} pending in the khata. By when can you pay?`];
  if (ctx.customer.language === "hi")
    return ["agent", `आपके खाते में ${hiNum(a)} रुपये बाकी हैं। आप कब तक दे पाएँगे?`, `You have ${rs(a)} pending in the khata. By when can you pay?`];
  return ["agent", `You have ${rs(a)} pending in the khata. By when can you pay?`, `You have ${rs(a)} pending in the khata. By when can you pay?`];
}

function result(
  lines: Line[],
  extraction: Omit<Extraction, "notes" | "promises" | "sentiment" | "confidence"> & Partial<Extraction>,
): ScriptResult {
  return {
    answered: true,
    turns: timeLines(lines),
    extraction: { promises: [], notes: [], sentiment: "neutral", confidence: 0.9, ...extraction },
  };
}

/** Builds the conversation and the extraction result for one reminder call. */
export function buildReminderScript(persona: Persona, ctx: ScriptContext): ScriptResult {
  const { now } = ctx;
  const a = ctx.amount;
  const lang = ctx.customer.language;

  switch (persona) {
    case "no_answer":
      return {
        answered: false,
        turns: [],
        extraction: { outcome: "no_answer", promises: [], notes: [], sentiment: "neutral", confidence: 1, summary: "No answer. Auto-retry in 30 minutes." },
      };

    case "wrong_number": {
      const first = ctx.customer.name.split(" ")[0];
      return result(
        [
          greet(ctx)[0],
          ["customer", `${ctx.customer.nameNative?.split(" ")[0] ?? first}? না না, এটা ভুল নম্বর।`, `${first}? No, no, this is the wrong number.`],
          ["agent", "দুঃখিত, বিরক্ত করার জন্য ক্ষমা করবেন।", "Sorry, please excuse the disturbance."],
        ],
        { outcome: "wrong_number", confidence: 0.95, summary: "Wrong number. Ask the shopkeeper for the correct number." },
      );
    }

    case "salary": {
      const due = ctx.openPromise ? new Date(ctx.openPromise.dueDate) : nextFifth(now);
      const lines: Line[] = ctx.openPromise
        ? [
            ...greet(ctx),
            ["agent", `আগের বার বলেছিলেন ${bnNum(due.getDate())} তারিখে দেবেন, শুধু মনে করিয়ে দিচ্ছি।`, `Last time you said you'd pay on the ${due.getDate()}th; just a reminder.`],
            ["customer", `হ্যাঁ, মনে আছে। ${bnNum(due.getDate())} তারিখেই দেব।`, `Yes, I remember. I'll pay on the ${due.getDate()}th.`],
            ["agent", "ধন্যবাদ, ভালো থাকবেন।", "Thank you, take care."],
          ]
        : [
            ...greet(ctx),
            ask(ctx),
            ["customer", "মাসের শেষে একটু টানাটানি চলছে। পাঁচ তারিখে মাইনে পেলেই দিয়ে দেব।", "Money is tight at the end of the month. I'll pay as soon as I get my salary on the 5th."],
            ["agent", `কোনো অসুবিধা নেই। ${dateName(due, "bn")}-এর জন্য ${bnNum(a)} টাকা লিখে রাখলাম। ভালো থাকবেন।`, `No problem. I've noted ${rs(a)} for ${dateName(due, "en")}. Take care.`],
          ];
      return result(lines, {
        outcome: "promised",
        promises: [{ amount: a, dueDate: toDateKey(due) }],
        notes: ctx.openPromise ? [] : [{ kind: "life_event", text: "Pays after salary arrives on the 5th." }],
        sentiment: "positive",
        confidence: 0.93,
        summary: `Promised ${rs(a)} on ${enDay(due)} (after salary).`,
      });
    }

    case "callback": {
      const at = addDays(now, 1);
      at.setHours(10, 0, 0, 0);
      return result(
        [
          ...greet(ctx),
          ask(ctx),
          ["customer", "এখন একটু ব্যস্ত আছি, কাল সকালে ফোন করবেন?", "I'm a bit busy right now. Could you call tomorrow morning?"],
          ["agent", "অবশ্যই, কাল সকাল দশটায় আবার ফোন করব। ধন্যবাদ।", "Of course, I'll call again tomorrow at 10 AM. Thank you."],
        ],
        { outcome: "callback", callbackAt: at.toISOString(), confidence: 0.91, summary: `Asked for a call back tomorrow at 10 AM.` },
      );
    }

    case "upi_tonight":
      return result(
        [
          ...greet(ctx),
          ask(ctx),
          ["customer", "আজ রাতেই UPI করে দিচ্ছি।", "I'll pay by UPI tonight."],
          ["agent", `দারুণ, আজকের জন্য ${bnNum(a)} টাকা লিখে রাখলাম। দোকান থেকে আপনাকে UPI লিঙ্ক পাঠিয়ে দেওয়া হবে। ধন্যবাদ!`, `Great, I've noted ${rs(a)} for today. The shop will send you the UPI link. Thank you!`],
        ],
        {
          outcome: "promised",
          promises: [{ amount: a, dueDate: toDateKey(now) }],
          notes: [{ kind: "request", text: "Wants the UPI link to pay tonight." }],
          sentiment: "positive",
          confidence: 0.94,
          summary: `Promised ${rs(a)} by UPI tonight. Send the UPI link.`,
        },
      );

    case "dispute_paid": {
      const claimed = 200;
      const rest = Math.max(0, a - claimed);
      const due = ctx.openPromise ? new Date(ctx.openPromise.dueDate) : addDays(now, 5);
      if (ctx.hasOpenDispute) {
        return result(
          [
            ...greet(ctx),
            ["agent", `आपके ${hiNum(rest)} रुपये बाकी हैं, जो आपने ${dayName(due, "hi")} तक देने को कहा था। 200 रुपये वाली बात दुकान वाले देख रहे हैं।`, `You have ${rs(rest)} pending, which you said you'd pay by ${dayName(due, "en")}. The shop is checking the ₹200.`],
            ["customer", `हाँ, ${dayName(due, "hi")} को पक्का दे दूँगी।`, `Yes, I'll definitely pay on ${dayName(due, "en")}.`],
            ["agent", "धन्यवाद, नमस्ते!", "Thank you, goodbye!"],
          ],
          { outcome: "promised", promises: [{ amount: rest, dueDate: toDateKey(due) }], sentiment: "positive", confidence: 0.9, summary: `Confirmed ${rs(rest)} by ${enDay(due)}. ₹200 payment claim still being checked.` },
        );
      }
      return result(
        [
          ...greet(ctx),
          ask(ctx),
          ["customer", "मैंने तो पिछले हफ़्ते 200 रुपये UPI से दे दिए थे।", "I already paid ₹200 by UPI last week."],
          ["agent", `समझ गई। मैं दुकान वालों को बता दूँगी कि आप 200 रुपये दे चुकी हैं, वे जाँच कर लेंगे। बाकी ${hiNum(rest)} रुपये आप कब तक दे पाएँगी?`, `Understood. I'll tell the shop you've already paid ₹200; they'll check. When can you pay the remaining ${rs(rest)}?`],
          ["customer", `वो अगले ${dayName(due, "hi")} तक दे दूँगी।`, `I'll pay that by next ${dayName(due, "en")}.`],
          ["agent", `ठीक है, ${dayName(due, "hi")} के लिए ${hiNum(rest)} रुपये नोट कर लिए। धन्यवाद!`, `Okay, I've noted ${rs(rest)} for ${dayName(due, "en")}. Thank you!`],
        ],
        {
          outcome: "disputed",
          promises: [{ amount: rest, dueDate: toDateKey(due) }],
          dispute: { kind: "already_paid", reason: "Says ₹200 was already paid by UPI last week", amount: claimed },
          sentiment: "neutral",
          confidence: 0.86,
          summary: `Says ₹200 was already paid by UPI (check it). Promised the remaining ${rs(rest)} by ${enDay(due)}.`,
        },
      );
    }

    case "partial": {
      const now500 = Math.min(500, a);
      const rest = Math.max(0, a - now500);
      const later = addDays(now, 7);
      return result(
        [
          ...greet(ctx),
          ask(ctx),
          ["customer", "আজ পাঁচশো দিয়ে দেব, বাকিটা সামনের সপ্তাহে।", "I'll pay 500 today and the rest next week."],
          ["agent", `ঠিক আছে, আজ ${bnNum(now500)} টাকা আর বাকি ${bnNum(rest)} টাকা আগামী ${dayName(later, "bn")}-এর মধ্যে লিখে রাখলাম, ঠিক তো?`, `Okay, I've noted ${rs(now500)} today and the remaining ${rs(rest)} by next ${dayName(later, "en")}. Is that right?`],
          ["customer", "হ্যাঁ, ঠিক আছে।", "Yes, that's fine."],
          ["agent", "ধন্যবাদ, ভালো থাকবেন।", "Thank you, take care."],
        ],
        {
          outcome: "promised",
          promises: [
            { amount: now500, dueDate: toDateKey(now) },
            { amount: rest, dueDate: toDateKey(later) },
          ],
          sentiment: "positive",
          confidence: 0.72,
          summary: `Split payment: ${rs(now500)} today, ${rs(rest)} by ${enDay(later)}. Medium confidence, please confirm.`,
        },
      );
    }

    case "refuse":
      return result(
        [
          ...greet(ctx),
          ask(ctx),
          ["customer", "বারবার ফোন করবেন না তো! আমি নিজেই দোকানে গিয়ে কথা বলব।", "Stop calling again and again! I'll go to the shop and talk myself."],
          ["agent", "বিরক্ত করার জন্য দুঃখিত। দোকানদারকে জানিয়ে দিচ্ছি যে আপনি নিজে এসে কথা বলবেন। ভালো থাকবেন।", "Sorry for the trouble. I'll let the shopkeeper know you'll come and talk in person. Take care."],
        ],
        {
          outcome: "refused",
          notes: [{ kind: "complaint", text: "Annoyed by calls; will settle in person at the shop." }],
          sentiment: "negative",
          confidence: 0.9,
          summary: "Refused; the agent apologised and ended the call. Will come to the shop to settle. Avoid further calls for now.",
        },
      );

    case "promise_product": {
      const due = nextWeekday(now, 0);
      return result(
        [
          ...greet(ctx),
          ask(ctx),
          ["customer", `${dayName(due, "bn")} দিয়ে দেব। আর একটা কথা, ম্যাগি কবে আসবে? ক'দিন ধরে পাচ্ছি না।`, `I'll pay on ${dayName(due, "en")}. One more thing: when will Maggi be back? I haven't found it for days.`],
          ["agent", `${dayName(due, "bn")}-এর জন্য ${bnNum(a)} টাকা লিখে রাখলাম। ম্যাগির কথাটা দোকানদারকে জানিয়ে দেব। ধন্যবাদ!`, `I've noted ${rs(a)} for ${dayName(due, "en")}. I'll tell the shopkeeper about Maggi. Thank you!`],
        ],
        {
          outcome: "promised",
          promises: [{ amount: a, dueDate: toDateKey(due) }],
          notes: [{ kind: "product_demand", text: "Asked when Maggi will be back in stock.", product: "Maggi" }],
          sentiment: "positive",
          confidence: 0.92,
          summary: `Promised ${rs(a)} on ${enDay(due)}. Asked for Maggi to be restocked.`,
        },
      );
    }

    case "opt_out":
      return result(
        [
          ...greet(ctx),
          ask(ctx),
          ["customer", "मुझे फ़ोन मत कीजिए, मैं खुद दुकान आकर दे दूँगी।", "Please don't call me. I'll come to the shop and pay myself."],
          ["agent", "ठीक है, अब से आपको फ़ोन नहीं आएगा। धन्यवाद, नमस्ते।", "Okay, you won't get any more calls. Thank you, goodbye."],
        ],
        { outcome: "opted_out", notes: [{ kind: "request", text: "Asked not to be called; will pay at the shop." }], confidence: 0.96, summary: "Asked not to be called again. Added to the opt-out list." },
      );

    case "family_mother": {
      const due = nextWeekday(now, 6);
      return result(
        [
          ...greet(ctx),
          ask(ctx),
          ["customer", `আমার ছেলে সঞ্জয়ই সব দেয়। ওকে বলে দেব, ${dayName(due, "bn")} দিয়ে দেবে।`, `My son Sanjay pays for everything. I'll tell him; he'll pay on ${dayName(due, "en")}.`],
          ["agent", `ঠিক আছে, ${dayName(due, "bn")}-এর জন্য ${bnNum(a)} টাকা লিখে রাখলাম। ধন্যবাদ, ভালো থাকবেন।`, `Okay, I've noted ${rs(a)} for ${dayName(due, "en")}. Thank you, take care.`],
        ],
        {
          outcome: "promised",
          promises: [{ amount: a, dueDate: toDateKey(due) }],
          notes: [{ kind: "relationship", text: "Her son Sanjay Halder pays her dues." }],
          sentiment: "positive",
          confidence: 0.88,
          summary: `Promised ${rs(a)} on ${enDay(due)}; her son Sanjay will pay.`,
        },
      );
    }

    case "family_son": {
      const due = nextWeekday(now, 6);
      return result(
        [
          ...greet(ctx),
          ask(ctx),
          ["customer", `আমারটা দিয়ে দেব। আর মায়ের হিসেবটাও ${dayName(due, "bn")} মিটিয়ে দেব।`, `I'll pay mine. And I'll settle my mother's account on ${dayName(due, "en")} too.`],
          ["agent", `ধন্যবাদ! আপনার ${bnNum(a)} টাকা ${dayName(due, "bn")}-এর জন্য লিখে রাখলাম। মায়ের হিসেবটা দোকানদার আপনাকে আলাদা করে জানিয়ে দেবেন।`, `Thank you! I've noted your ${rs(a)} for ${dayName(due, "en")}. The shopkeeper will tell you your mother's balance separately.`],
        ],
        {
          outcome: "promised",
          promises: [{ amount: a, dueDate: toDateKey(due) }],
          notes: [{ kind: "relationship", text: "Will also clear his mother Rina Halder's dues." }],
          sentiment: "positive",
          confidence: 0.9,
          summary: `Promised ${rs(a)} on ${enDay(due)}; will also clear his mother's account. The agent did not disclose her balance.`,
        },
      );
    }

    case "repeat_breaker": {
      const missed = ctx.missedPromises ?? [];
      const due = nextWeekday(now, 1);
      if (missed.length === 0) {
        return result(
          [
            ...greet(ctx),
            ask(ctx),
            ["customer", `${dayName(due, "hi")} तक पूरा दे दूँगा।`, `I'll pay it all by ${dayName(due, "en")}.`],
            ["agent", `ठीक है, ${dayName(due, "hi")} के लिए ${hiNum(a)} रुपये नोट कर लिए। धन्यवाद।`, `Okay, I've noted ${rs(a)} for ${dayName(due, "en")}. Thank you.`],
          ],
          { outcome: "promised", promises: [{ amount: a, dueDate: toDateKey(due) }], sentiment: "neutral", confidence: 0.85, summary: `Promised ${rs(a)} by ${enDay(due)}.` },
        );
      }
      if (missed.length === 1) {
        const part = 1000;
        return result(
          [
            ...greet(ctx),
            ask(ctx),
            ["customer", `अभी पूरा नहीं हो पाएगा। ${dayName(due, "hi")} तक ${hiNum(part)} दे दूँगा।`, `I can't pay it all now. I'll pay ${rs(part)} by ${dayName(due, "en")}.`],
            ["agent", `ठीक है, ${dayName(due, "hi")} के लिए ${hiNum(part)} रुपये नोट कर लिए। धन्यवाद।`, `Okay, I've noted ${rs(part)} for ${dayName(due, "en")}. Thank you.`],
          ],
          { outcome: "promised", promises: [{ amount: part, dueDate: toDateKey(due) }], sentiment: "neutral", confidence: 0.82, summary: `Promised a partial ${rs(part)} by ${enDay(due)}. Missed one earlier promise.` },
        );
      }
      const last = missed[missed.length - 1];
      return result(
        [
          ...greet(ctx),
          ["agent", `आपके ${hiNum(a)} रुपये बाकी हैं। पिछली बार आपने ${dateName(new Date(last.dueDate), "hi")} तक देने का वादा किया था, जो रह गया। इस बार कौन-सा दिन पक्का है?`, `You have ${rs(a)} pending. Last time you promised to pay by ${dateName(new Date(last.dueDate), "en")}, which was missed. Which day is firm this time?`],
          ["customer", `हाँ, माफ़ कीजिए, थोड़ी दिक्कत थी। इस बार ${dayName(due, "hi")} को पक्का दे दूँगा।`, `Yes, sorry, I had some trouble. This time I'll definitely pay on ${dayName(due, "en")}.`],
          ["agent", `ठीक है, ${dayName(due, "hi")} के लिए ${hiNum(a)} रुपये नोट कर लिए। धन्यवाद।`, `Okay, I've noted ${rs(a)} for ${dayName(due, "en")}. Thank you.`],
        ],
        {
          outcome: "promised",
          promises: [{ amount: a, dueDate: toDateKey(due) }],
          notes: [{ kind: "other", text: `New promise after missing ${missed.length} earlier promises.` }],
          sentiment: "neutral",
          confidence: 0.66,
          summary: `Promised ${rs(a)} on ${enDay(due)} after missing ${missed.length} promises. Medium confidence, follow up in person.`,
        },
      );
    }

    case "promise":
    case "paid_up":
    default: {
      const due = nextWeekday(now, 5);
      const lines: Line[] =
        lang === "bn"
          ? [
              ...greet(ctx),
              ask(ctx),
              ["customer", `${dayName(due, "bn")} দিয়ে দেব।`, `I'll pay on ${dayName(due, "en")}.`],
              ["agent", `ঠিক আছে, ${dayName(due, "bn")}-এর জন্য ${bnNum(a)} টাকা লিখে রাখলাম। ধন্যবাদ, ভালো থাকবেন।`, `Okay, I've noted ${rs(a)} for ${dayName(due, "en")}. Thank you, take care.`],
            ]
          : lang === "hi"
            ? [
                ...greet(ctx),
                ask(ctx),
                ["customer", `${dayName(due, "hi")} तक दे दूँगा।`, `I'll pay by ${dayName(due, "en")}.`],
                ["agent", `ठीक है, ${dayName(due, "hi")} के लिए ${hiNum(a)} रुपये नोट कर लिए। धन्यवाद, नमस्ते!`, `Okay, I've noted ${rs(a)} for ${dayName(due, "en")}. Thank you, goodbye!`],
              ]
            : [
                ...greet(ctx),
                ask(ctx),
                ["customer", `I'll pay by ${dayName(due, "en")}.`, `I'll pay by ${dayName(due, "en")}.`],
                ["agent", `Okay, I've noted ${rs(a)} for ${dayName(due, "en")}. Thank you, goodbye!`, `Okay, I've noted ${rs(a)} for ${dayName(due, "en")}. Thank you, goodbye!`],
              ];
      return result(lines, {
        outcome: "promised",
        promises: [{ amount: a, dueDate: toDateKey(due) }],
        sentiment: "positive",
        confidence: 0.92,
        summary: `Promised ${rs(a)} by ${enDay(due)}.`,
      });
    }
  }
}

/** The evening report call to the shopkeeper, in Bengali. */
/** A person in the report: Latin name for English text, Bengali-script name for the spoken Bengali. */
type ReportPerson = { name: string; spokenName: string };

export function buildReportScript(input: {
  ownerFirstName: string;
  /** Bengali-script first name for the spoken line; falls back to the Latin name. */
  ownerFirstNameBn?: string;
  collected: number;
  promisesMade: (ReportPerson & { amount: number })[];
  dueTomorrow: (ReportPerson & { amount: number })[];
  disputes: (ReportPerson & { reason: string })[];
  productRequests: string[];
}): { turns: Turn[]; spokenBn: string; spokenEn: string } {
  const promised = input.promisesMade.length;
  const promisedTotal = input.promisesMade.reduce((s, p) => s + p.amount, 0);
  const lines: Line[] = [
    [
      "agent",
      input.ownerFirstNameBn ? `নমস্কার ${input.ownerFirstNameBn}বাবু, আমি আশা। আজকের হিসেব শোনাচ্ছি।` : `নমস্কার ${input.ownerFirstName}, আমি আশা। আজকের হিসেব শোনাচ্ছি।`,
      `Hello ${input.ownerFirstName}, this is Asha. Here is today's summary.`,
    ],
    [
      "agent",
      promised
        ? `আজ ${bnNum(input.collected)} টাকা জমা পড়েছে। ${bnNum(promised)} জন মোট ${bnNum(promisedTotal)} টাকা দেওয়ার কথা দিয়েছেন।`
        : `আজ ${bnNum(input.collected)} টাকা জমা পড়েছে। আজ নতুন কেউ দেওয়ার কথা দেননি।`,
      promised
        ? `Today ${rs(input.collected)} came in. ${promised} ${promised === 1 ? "customer" : "customers"} promised ${rs(promisedTotal)} in total.`
        : `Today ${rs(input.collected)} came in. No new promises today.`,
    ],
  ];
  if (input.dueTomorrow.length)
    lines.push([
      "agent",
      `কাল দেওয়ার কথা ${input.dueTomorrow.map((d) => d.spokenName).join(", ")}-এর।`,
      `Due tomorrow: ${input.dueTomorrow.map((d) => `${d.name} (${rs(d.amount)})`).join(", ")}.`,
    ]);
  if (input.disputes.length)
    lines.push([
      "agent",
      `${bnNum(input.disputes.length)}টা বিবাদ দেখতে হবে: ${input.disputes.map((d) => d.spokenName).join(", ")}।`,
      `${input.disputes.length} ${input.disputes.length === 1 ? "dispute" : "disputes"} to check: ${input.disputes.map((d) => `${d.name}: ${d.reason}`).join("; ")}.`,
    ]);
  if (input.productRequests.length)
    lines.push(["agent", `খরিদ্দাররা চেয়েছেন: ${input.productRequests.join(", ")}।`, `Customers asked for: ${input.productRequests.join(", ")}.`]);
  lines.push(["shopkeeper", "ঠিক আছে। কাল সকালে কাকে আগে ফোন করব?", "Okay. Whom should I call first tomorrow morning?"]);
  const first = input.dueTomorrow[0] ?? input.promisesMade[0];
  lines.push([
    "agent",
    first ? `${first.spokenName}-কে আগে ফোন করুন, ওঁর ${bnNum(first.amount)} টাকা দেওয়ার কথা।` : "কাল কারও দেওয়ার কথা নেই, তাই কোনো তাড়া নেই।",
    first ? `Call ${first.name} first; ${rs(first.amount)} is due from them.` : "Nobody is due tomorrow, so there's no rush.",
  ]);
  lines.push(["shopkeeper", "ধন্যবাদ।", "Thank you."]);
  lines.push(["agent", "ভালো থাকবেন, শুভরাত্রি।", "Take care, good night."]);
  const turns = timeLines(lines);
  return {
    turns,
    spokenBn: lines.filter((l) => l[0] === "agent").map((l) => l[1]).join(" "),
    spokenEn: lines.filter((l) => l[0] === "agent").map((l) => l[2]).join(" "),
  };
}
