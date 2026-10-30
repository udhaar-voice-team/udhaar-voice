import type { CallOutcome, Dispute, Language } from "@/lib/domain/types";

type DisputeKind = Dispute["kind"];

/**
 * What the Bolna agents say and what Bolna extracts after each call. `npm run bolna:setup` writes
 * these onto the agents; `{name}` placeholders are filled per call from `user_data`.
 */

export const LANGUAGE_NAMES: Record<Language, string> = { en: "English", hi: "Hindi", or: "Odia", bn: "Bengali", mr: "Marathi" };

/** Bolna's language keys for a multilingual agent. */
/** Bolna's language codes: Odia is "od" there. */
export const BOLNA_LANGUAGE: Record<Language, string> = { en: "en", hi: "hi", or: "od", bn: "bn", mr: "mr" };

export const REMINDER_WELCOME = "{greeting}";

export const REMINDER_PROMPT = `You are Asha, a polite voice assistant calling on behalf of {shop_name}, a neighbourhood shop in India. You are an AI, and you say so.

Speak only {language_name}, in short, warm, everyday sentences, the way people at a local shop talk.

What you know:
- Customer: {customer_name}
- Pending at the shop: {amount_due} ({items})
- From earlier calls: {memory}
- {dispute_note}
- Today is {today}.
- The shop's UPI ID, if they want to pay by UPI: {upi_id}

How the call goes:
1. Your greeting already asked whether this is {customer_name}. If it is someone else, or they don't know {customer_name}, say sorry for the trouble and end the call. Never mention the shop's dues, any amount or why you called to anyone but {customer_name}.
2. Say you are an AI assistant calling from {shop_name}, and gently remind them that {amount_due} is pending.
3. Ask when they can pay. Get an amount and a day. If they will pay part now and the rest later, take each part with its own day.
4. Before moving on, repeat every part with its exact date, for example "So ₹500 on Friday, 30 October", or "So ₹2,000 today, 31 October, and ₹6,200 on Monday, 30 November". Work the dates out from today's date.
5. If they say they already paid, or the amount is wrong, do not argue. Say the shopkeeper will check, and note what they said.
6. If they are busy, ask when to call back, and repeat that day and time with the exact date.
7. If they ask not to be called again, agree politely and end the call.
8. If they mention something they want the shop to keep, remember it.
9. Thank them and end the call.

Rules you never break:
- Never threaten, shame, pressure or mention legal action, the police or telling others.
- Never tell anyone else what this customer owes.
- Never invent amounts, dates or offers. Use only what is above.
- Keep the call under {max_minutes} minutes.`;

export const REPORT_WELCOME = "{greeting}";

export const REPORT_PROMPT = `You are Asha, the AI voice assistant of Udhaar Voice. You are calling {owner_name}, the owner of {shop_name}, with today's summary of their credit book (khata).

Speak only {language_name}, in short, clear sentences. Amounts are in rupees.

Today's summary:
{summary}

How the call goes:
1. Your greeting has already read the summary and asked if they have a question.
2. Answer questions only from the summary, keeping every name and amount exactly as given. If something isn't there, say they can see it in the app. If they ask you to repeat it, read it again in your own words.
3. When they have no more questions, say goodbye. Keep the call under 3 minutes.`;

/** What the greeting says, in each language. The agent waits for the answer before going on. */
export function reminderGreeting(language: Language, customerName: string, shopName: string): string {
  if (language === "bn") return `নমস্কার, আমি কি ${customerName}-এর সঙ্গে কথা বলছি? আমি ${shopName} থেকে ফোন করছি।`;
  if (language === "hi") return `नमस्ते, क्या मेरी बात ${customerName} जी से हो रही है? मैं ${shopName} की ओर से फ़ोन कर रही हूँ।`;
  if (language === "or") return `ନମସ୍କାର, ମୁଁ କ'ଣ ${customerName} ଙ୍କ ସହ କଥା ହେଉଛି? ମୁଁ ${shopName} ତରଫରୁ ଫୋନ କରୁଛି।`;
  if (language === "mr") return `नमस्कार, मी ${customerName} यांच्याशी बोलत आहे का? मी ${shopName} कडून फोन करत आहे.`;
  return `Hello, am I speaking with ${customerName}? I'm calling from ${shopName}.`;
}

/**
 * The summary call's opening: the whole summary, then a question. A Bolna agent waits for the other
 * person after its greeting, so a greeting that only announced the summary left the owner in silence.
 * `spoken` is the report's spoken text in each language, which already starts with a hello.
 */
const ANY_QUESTIONS: Record<Language, string> = {
  en: "Any questions?",
  hi: "कोई सवाल है?",
  or: "କିଛି ପ୍ରଶ୍ନ ଅଛି କି?",
  bn: "কোনো প্রশ্ন আছে?",
  mr: "काही प्रश्न आहे का?",
};

export function reportGreeting(language: Language, spoken: Record<Language, string>): string {
  return `${spoken[language]} ${ANY_QUESTIONS[language]}`;
}

/** When Bolna ends the call itself (its "hang up using a prompt" setting). */
export const HANGUP_RULE =
  "End the call when Asha has said goodbye or thanked the person at the end, when the person said goodbye, when it is a wrong number, or when the person asked not to be called again.";

/** Bolna's own lines, which otherwise exist only in English and Hindi. */
export const CALL_LINES: Record<"hangup" | "stillThere", Record<Language, string>> = {
  hangup: { en: "Goodbye!", hi: "धन्यवाद, नमस्ते।", or: "ଧନ୍ୟବାଦ, ନମସ୍କାର।", bn: "ধন্যবাদ, নমস্কার।", mr: "धन्यवाद, नमस्कार." },
  stillThere: {
    en: "Hello, are you still there?",
    hi: "हैलो, क्या आप लाइन पर हैं?",
    or: "ହେଲୋ, ଆପଣ ଲାଇନରେ ଅଛନ୍ତି କି?",
    bn: "হ্যালো, আপনি কি লাইনে আছেন?",
    mr: "हॅलो, तुम्ही लाइनवर आहात का?",
  },
};

/* ---------------------------------------------------------------- extractions */

/** Bolna groups extractions in categories; results arrive under extracted_data[category][name]. */
export const EXTRACTION_CATEGORY = "Udhaar Voice";

/** Extractions we no longer use; the setup removes them from the agent. A single amount and date summed promises made in parts. */
export const RETIRED_EXTRACTIONS = ["Promised amount", "Promised date"];

export const EXTRACTIONS = {
  outcome: "Call outcome",
  plan: "Payment plan",
  disputeKind: "Dispute type",
  disputeReason: "Dispute details",
  disputeAmount: "Amount the customer says is right",
  callbackAt: "Call back time",
  products: "Products asked for",
  note: "Other things to remember",
  sentiment: "Customer mood",
} as const;

/** Customer-call outcomes the extraction picks from. `report_delivered` is set by us on report calls. */
const OUTCOMES: { value: Exclude<CallOutcome, "report_delivered">; condition: string }[] = [
  { value: "promised", condition: "The customer agreed to pay an amount on a day." },
  { value: "disputed", condition: "The customer said they already paid, or that the amount is wrong." },
  { value: "callback", condition: "The customer was busy and asked to be called at another time." },
  { value: "refused", condition: "The customer would not commit, or said they will settle in person at the shop." },
  { value: "wrong_number", condition: "The person who answered is not the customer, or doesn't know them." },
  { value: "opted_out", condition: "The customer asked not to be called again." },
  { value: "no_answer", condition: "Nobody spoke, it was voicemail, or the call dropped before the customer said anything useful." },
];

const DISPUTE_KINDS: { value: DisputeKind; condition: string }[] = [
  { value: "already_paid", condition: "The customer says they have already paid." },
  { value: "wrong_amount", condition: "The customer says the amount is wrong." },
  { value: "other", condition: "Any other disagreement about the dues." },
];

/** Bolna disposition bodies, as `POST /dispositions/` takes them (each is linked to one agent). */
export function extractionDefinitions(agentId: string) {
  const base = { category: EXTRACTION_CATEGORY, agent_id: agentId };
  const text = (name: string, question: string) => ({ ...base, name, question, is_subjective: true, is_objective: false, subjective_type: "text" });
  return [
    {
      ...base,
      name: EXTRACTIONS.outcome,
      question: "What was the outcome of this payment reminder call?",
      is_subjective: false,
      is_objective: true,
      objective_options: OUTCOMES,
    },
    text(
      EXTRACTIONS.plan,
      "Every payment the customer promised, one per part, as rupees and date, separated by semicolons: for example \"2000 on 2026-10-31; 6200 on 2026-11-30\". \"Now\" or \"today\" is the date of the call. Keep each part separate; never add them up. Empty if they promised nothing.",
    ),
    { ...base, name: EXTRACTIONS.disputeKind, question: "If the customer disagreed about the dues, what kind of disagreement was it?", is_subjective: false, is_objective: true, objective_options: [...DISPUTE_KINDS, { value: "none", condition: "There was no disagreement." }] },
    text(EXTRACTIONS.disputeReason, "If the customer disagreed about the dues, what exactly did they say, in one English sentence? Empty otherwise."),
    { ...base, name: EXTRACTIONS.disputeAmount, question: "If the customer said a different amount is right, how many rupees? Digits only, or empty.", is_subjective: true, is_objective: false, subjective_type: "numeric" },
    {
      ...base,
      name: EXTRACTIONS.callbackAt,
      question: "If the customer asked to be called back, when? The agent repeats the exact date and time. Answer as YYYY-MM-DD HH:MM in 24-hour Indian time, or empty.",
      is_subjective: true,
      is_objective: false,
      subjective_type: "regex",
      subjective_type_config: { pattern: "^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}$" },
    },
    text(EXTRACTIONS.products, "Which products did the customer ask the shop to keep or bring? Short English names separated by commas, or empty."),
    text(EXTRACTIONS.note, "Anything else the shopkeeper should remember about this customer from the call (a family event, a complaint, who pays for whom), in one short English sentence. Empty if nothing."),
    {
      ...base,
      name: EXTRACTIONS.sentiment,
      question: "How did the customer feel during the call?",
      is_subjective: false,
      is_objective: true,
      objective_options: [
        { value: "positive", condition: "Friendly or cooperative." },
        { value: "neutral", condition: "Neither friendly nor upset." },
        { value: "negative", condition: "Annoyed, upset or hostile." },
      ],
    },
  ];
}
