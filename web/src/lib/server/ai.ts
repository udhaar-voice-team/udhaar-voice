import type { AiProvider, AiStep } from "@/lib/api/contract";
import type { Language } from "@/lib/domain/types";

/**
 * What the app reads and understands (khata photos, spoken questions, the "Ask your khata"
 * assistant), with the same prompts and answer schemas for every model provider. Gemini is tried
 * first and Meta's Muse Spark after it. Each provider is one request from the browser, so each
 * gets a full server request's time, and the screen can say which one is working.
 */

/** One line of a khata page as read. Confidence is 0–1 per field. */
export type ReadLine = {
  name: string;
  name_native: string;
  amount: number;
  struck_amount: number | null;
  date: string | null;
  items: string;
  confidence: { name: number; amount: number; date: number; items: number };
};

/** A tool the assistant may call: a name, what it does, and its arguments as JSON Schema. */
export type ToolSpec = { name: string; description: string; parametersJsonSchema?: Record<string, unknown> };
export type ToolRun = (name: string, args: Record<string, unknown>) => Promise<unknown>;
export type ToolAnswer = { answer: string; calls: { name: string; args: Record<string, unknown> }[] };

export type Provider = {
  name: AiProvider;
  configured: () => boolean;
  /** The model that reads photos, saved with each import. */
  model: () => string;
  readKhataPhoto: (image: Uint8Array, mime: string, today: string) => Promise<ReadLine[]>;
  transcribeQuestion: (audio: Uint8Array, mime: string) => Promise<{ text: string; language: Language }>;
  answerWithTools: (question: string, tools: ToolSpec[], run: ToolRun, instruction: string) => Promise<ToolAnswer>;
  /** Which column of a spreadsheet holds what, from its first rows. */
  mapColumns: (sample: string[][]) => Promise<ColumnMap>;
};

/**
 * Runs one step on `requested` (or the first provider). If it fails and another provider comes
 * after it, the answer names that one for the browser to ask next; if none is left, the error is
 * thrown. `AI_TEST_FAIL=gemini` makes a provider fail on purpose, to try the fallback locally;
 * it is ignored on Vercel.
 */
export async function step<T>(providers: Provider[], requested: AiProvider | undefined, label: string, run: (p: Provider) => Promise<T>): Promise<AiStep<T>> {
  const ready = providers.filter((p) => p.configured());
  const index = Math.max(0, ready.findIndex((p) => p.name === requested));
  const provider = ready[index];
  if (!provider) throw new Error("No AI provider is set up (GEMINI_API_KEY or META_API_KEY).");
  try {
    if (failsOnPurpose(provider.name)) throw new Error(`${provider.name} failed on purpose (AI_TEST_FAIL)`);
    return { result: await run(provider) };
  } catch (err) {
    console.warn(`[ai] ${label} failed on ${provider.name}:`, err instanceof Error ? err.message.slice(0, 300) : err);
    const next = ready[index + 1];
    if (next) return { next: next.name };
    throw err;
  }
}

const failsOnPurpose = (name: AiProvider) =>
  !process.env.VERCEL &&
  (process.env.AI_TEST_FAIL ?? "")
    .split(",")
    .map((s) => s.trim())
    .includes(name);

/** "audio/webm;codecs=opus" → "audio/webm". */
export const baseMime = (mime: string) => mime.split(";")[0].trim().toLowerCase();

/* ---------------------------------------------------------------- khata photos */

const confidence = { type: "number", minimum: 0, maximum: 1 };
export const KHATA_SCHEMA = {
  type: "object",
  properties: {
    rows: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "The customer's name in Latin letters, e.g. Ramesh." },
          name_native: { type: "string", description: "The name exactly as written, in its own script. Empty if written in Latin letters." },
          amount: { type: "integer", description: "The amount owed in whole rupees, as finally written." },
          struck_amount: { type: ["integer", "null"], description: "An amount crossed out and written over, if any." },
          date: { type: ["string", "null"], description: "The entry's date as YYYY-MM-DD, or null if the line has none." },
          items: { type: "string", description: "What was bought, in short English, e.g. Rice 2 kg." },
          confidence: {
            type: "object",
            properties: { name: confidence, amount: confidence, date: confidence, items: confidence },
            required: ["name", "amount", "date", "items"],
          },
        },
        required: ["name", "name_native", "amount", "struck_amount", "date", "items", "confidence"],
      },
    },
  },
  required: ["rows"],
};

export const KHATA_INSTRUCTION = `You read photos of handwritten credit ledgers (khata) from small Indian shops. Pages may be in Bengali, Hindi, Odia, Marathi or English, often mixed, with Bengali, Devanagari, Odia or Latin digits.
Return one row per entry: who took goods on credit, what, how much and when.
- Skip headings, totals, page numbers and lines that are payments received ("jama", "জমা", "जमा").
- Read Bengali, Devanagari and Odia digits as numbers. "৳" or "/-" after a number marks rupees.
- If a number is crossed out and another written beside it, amount is the new one and struck_amount the crossed-out one.
- Dates are usually day/month. Use the year of today's date, or last year if that would put the date in the future.
- Confidence is how sure you are of each field: below 0.8 means the shopkeeper should check it. Never guess silently.`;

export const khataPrompt = (today: string) => `Today is ${today}. Read every entry on this page.`;

/** Rows without a name or a positive amount aren't entries. */
export const usableLines = (rows: ReadLine[]) => rows.filter((r) => r.name?.trim() && Number.isFinite(r.amount) && r.amount > 0);

/* ---------------------------------------------------------------- spreadsheets */

/** Column numbers from 0, or -1 when the sheet has no such column. */
export type ColumnMap = {
  header_rows: number;
  name: number;
  name_native: number;
  amount: number;
  paid: number;
  items: number;
  date: number;
  phone: number;
  date_order: "dmy" | "mdy" | "ymd";
};

const column = (description: string) => ({ type: "integer", minimum: -1, description });
export const COLUMNS_SCHEMA = {
  type: "object",
  properties: {
    header_rows: { type: "integer", minimum: 0, description: "How many rows at the top are headings or titles, not entries." },
    name: column("The customer's name."),
    name_native: column("A second name column in an Indian script, if the name is also written that way."),
    amount: column("What the customer owes or took on credit."),
    paid: column("A separate column of money the customer has paid back, if any."),
    items: column("What was bought."),
    date: column("The entry's date."),
    phone: column("The customer's mobile number."),
    date_order: { type: "string", enum: ["dmy", "mdy", "ymd"], description: "How dates are written: day first, month first or year first." },
  },
  required: ["header_rows", "name", "name_native", "amount", "paid", "items", "date", "phone", "date_order"],
};

export const COLUMNS_INSTRUCTION = `You look at the first rows of a spreadsheet a small shop in India keeps of goods given on credit (a khata), and say which column holds what. Column numbers start at 0; use -1 when there is no such column.
Shopkeepers name columns any way they like, in English, Hindi, Bengali, Odia, Marathi or a mix, or give no headings at all: judge by the values too.
- amount is what the customer owes or took on credit: "credit", "balance", "baki", "udhaar", "due", "total", "outstanding" and so on. If there is a running balance column, that is amount.
- paid is only a separate column of money paid back ("jama", "paid", "received"), never the balance itself.
- date_order: Indian sheets usually write the day first (28/10/2026). Say month first only when the values show it, such as 10/28/2026.`;

export const columnsPrompt = (sample: string[][]) => `The first rows, as JSON (one array per row):\n${JSON.stringify(sample)}`;

/** The first rows sent to a model: a few, short, enough to tell the columns apart. */
export const columnSample = (rows: string[][]) => rows.slice(0, 8).map((r) => r.slice(0, 12).map((c) => String(c ?? "").slice(0, 40)));

/* ---------------------------------------------------------------- spoken questions */

export const TRANSCRIPT_SCHEMA = {
  type: "object",
  properties: {
    text: { type: "string", description: "Exactly what was said, in the script of the language spoken. Empty if nothing was said." },
    language: { type: "string", enum: ["en", "hi", "or", "bn", "mr"] },
  },
  required: ["text", "language"],
};

export const TRANSCRIPT_INSTRUCTION = `You transcribe short questions a shopkeeper in India asks their credit book app, in English, Hindi, Odia, Bengali, Marathi or a mix.
Write each language in its own script: Hindi and Marathi in Devanagari, Odia in Odia, Bengali in Bengali. Names of people and shops go in that script too; English words said in the middle of a sentence stay in English.
Use Latin letters only for Hinglish: Hindi spoken mostly with English words, as people type it in chats.
Don't translate, answer or add anything. language is the main language spoken; Hinglish is hi.`;

export const TRANSCRIPT_PROMPT = "Transcribe this question.";
