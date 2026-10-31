import { GoogleGenAI, type Content, type GenerateContentConfig, type GenerateContentResponse } from "@google/genai";
import {
  baseMime,
  COLUMNS_INSTRUCTION,
  COLUMNS_SCHEMA,
  columnsPrompt,
  KHATA_INSTRUCTION,
  KHATA_SCHEMA,
  khataPrompt,
  TRANSCRIPT_INSTRUCTION,
  TRANSCRIPT_PROMPT,
  TRANSCRIPT_SCHEMA,
  usableLines,
  type Provider,
  type ReadLine,
  type ToolAnswer,
  type ToolRun,
  type ToolSpec,
} from "./ai";

/** Gemini, the first provider tried (`lib/server/ai.ts`). Server only: it carries our API key. */

export const geminiConfigured = () => Boolean(process.env.GEMINI_API_KEY);
export const geminiModel = () => process.env.GEMINI_MODEL || "gemini-3.8-flash";

/**
 * The model to try when the main one is busy: in testing, gemini-3.8-flash often answered 503
 * ("high demand"), and the SDK's default five retries with back-off took minutes. With Meta set up,
 * Meta is the fallback instead: when one Gemini model is down, the other usually is too.
 */
const fallbackModel = () => process.env.GEMINI_FALLBACK_MODEL || "gemini-3.6-flash";
const models = () => (process.env.META_API_KEY ? [geminiModel()] : [...new Set([geminiModel(), fallbackModel()])]);

let client: GoogleGenAI | undefined;
function ai(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set (web/.env.local).");
  // One attempt per model (the SDK would otherwise retry five times with back-off); each call sets its own timeout.
  client ??= new GoogleGenAI({ apiKey, httpOptions: { retryOptions: { attempts: 1 } } });
  return client;
}

/**
 * Runs `attempt` with each model in turn until one answers, each within its time budget (ms).
 * The budgets add up to well under the 60 s a server request may take.
 */
async function withFallback<T>(label: string, budgets: [number, number], attempt: (model: string, timeout: number) => Promise<T>): Promise<T> {
  let last: unknown;
  for (const [i, model] of models().entries()) {
    try {
      return await attempt(model, budgets[Math.min(i, 1)]);
    } catch (err) {
      last = err;
      console.warn(`[gemini] ${label} failed on ${model}:`, err instanceof Error ? err.message.slice(0, 200) : err);
    }
  }
  throw last;
}

const generate = (model: string, timeout: number, contents: Content[], config: GenerateContentConfig): Promise<GenerateContentResponse> =>
  ai().models.generateContent({ model, contents, config: { ...config, httpOptions: { timeout, retryOptions: { attempts: 1 } } } });

async function json<T>(label: string, budgets: [number, number], contents: Content[], schema: unknown, systemInstruction: string): Promise<T> {
  return withFallback(label, budgets, async (model, timeout) => {
    const res = await generate(model, timeout, contents, { systemInstruction, responseMimeType: "application/json", responseJsonSchema: schema, temperature: 0 });
    if (!res.text) throw new Error("Gemini returned nothing.");
    return JSON.parse(res.text) as T;
  });
}

const inline = (bytes: Uint8Array, mime: string) => ({ inlineData: { mimeType: mime, data: Buffer.from(bytes).toString("base64") } });

async function readKhataPhoto(image: Uint8Array, mime: string, today: string): Promise<ReadLine[]> {
  const result = await json<{ rows: ReadLine[] }>(
    "khata photo",
    [30_000, 20_000],
    [{ role: "user", parts: [inline(image, baseMime(mime) || "image/jpeg"), { text: khataPrompt(today) }] }],
    KHATA_SCHEMA,
    KHATA_INSTRUCTION,
  );
  return usableLines(result.rows);
}

const transcribeQuestion: Provider["transcribeQuestion"] = (audio, mime) =>
  json(
    "transcription",
    [15_000, 12_000],
    [{ role: "user", parts: [inline(audio, baseMime(mime) || "audio/webm"), { text: TRANSCRIPT_PROMPT }] }],
    TRANSCRIPT_SCHEMA,
    TRANSCRIPT_INSTRUCTION,
  );

/**
 * Answers a question by letting Gemini call our tools on the shop's data, a few rounds at most.
 * Returns the final answer and the calls made, in order.
 */
async function answerWithTools(question: string, tools: ToolSpec[], run: ToolRun, systemInstruction: string): Promise<ToolAnswer> {
  // A conversation stays on one model: thought signatures only mean something to the model that made them.
  // The whole answer must arrive within ~40 s, inside one server request.
  const deadline = Date.now() + 40_000;
  return withFallback("ask", [12_000, 12_000], (model, timeout) => converse(model, timeout, deadline, question, tools, run, systemInstruction));
}

async function converse(model: string, timeout: number, deadline: number, question: string, tools: ToolSpec[], run: ToolRun, systemInstruction: string) {
  const contents: Content[] = [{ role: "user", parts: [{ text: question }] }];
  const calls: ToolAnswer["calls"] = [];
  for (let round = 0; round < 4; round++) {
    const left = deadline - Date.now();
    if (left < 3_000) throw new Error("Out of time");
    const res = await generate(model, Math.min(timeout, left), contents, { systemInstruction, tools: [{ functionDeclarations: tools }], temperature: 0.2 });
    const wanted = res.functionCalls ?? [];
    if (wanted.length === 0) return { answer: (res.text ?? "").trim(), calls };
    // The model's turn goes back as it came, so its thought signatures stay attached.
    const turn = res.candidates?.[0]?.content;
    if (turn) contents.push(turn);
    const parts = [];
    for (const fc of wanted) {
      const name = fc.name ?? "";
      const args = (fc.args ?? {}) as Record<string, unknown>;
      calls.push({ name, args });
      let response: unknown;
      try {
        response = await run(name, args);
      } catch (err) {
        response = { error: err instanceof Error ? err.message : String(err) };
      }
      parts.push({ functionResponse: { id: fc.id, name, response: { result: response } } });
    }
    contents.push({ role: "user", parts });
  }
  return { answer: "", calls };
}

const mapColumns: Provider["mapColumns"] = (sample) =>
  json("spreadsheet columns", [12_000, 10_000], [{ role: "user", parts: [{ text: columnsPrompt(sample) }] }], COLUMNS_SCHEMA, COLUMNS_INSTRUCTION);

export const gemini: Provider = {
  name: "gemini",
  configured: geminiConfigured,
  model: geminiModel,
  readKhataPhoto,
  transcribeQuestion,
  answerWithTools,
  mapColumns,
};
