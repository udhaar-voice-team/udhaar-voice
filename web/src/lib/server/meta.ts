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

/**
 * Meta's Muse Spark, tried when Gemini fails (`lib/server/ai.ts`), through Meta Model API's
 * OpenAI-style chat completions. Server only: it carries our API key.
 * Meta says Muse Spark 1.3's audio support isn't complete and suggests 1.2, but in our tests 1.3 heard
 * Bengali questions right where 1.2 didn't, so it does both (`META_AUDIO_MODEL` can switch back).
 * Muse Voice Transcribe has no Odia and doesn't say which language was spoken, so it isn't used.
 */

const BASE_URL = "https://api.meta.ai/v1";

export const metaConfigured = () => Boolean(process.env.META_API_KEY);
export const metaModel = () => process.env.META_MODEL || "muse-spark-1.3";
const audioModel = () => process.env.META_AUDIO_MODEL || metaModel();

type Part = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } } | { type: "input_audio"; input_audio: { data: string; format: "wav" | "mp3" } };
type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
type Message =
  | { role: "system"; content: string }
  | { role: "user"; content: string | Part[] }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };
type ReplyMessage = { content?: string | null; tool_calls?: ToolCall[] };
type Usage = { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
type ChatResponse = { choices?: { message?: ReplyMessage }[]; usage?: Usage };

/** Muse Spark's pay-as-you-go prices, US dollars per million tokens (dev.meta.ai/docs/pricing-rate-limits). */
const PRICE = { input: 1.25, cached: 0.15, output: 4.25 };

/** What a reply cost, from its token counts. Logged with every call, to keep an eye on spend. */
export function costOf(usage: Usage | undefined): number {
  const cached = usage?.prompt_tokens_details?.cached_tokens ?? 0;
  const input = (usage?.prompt_tokens ?? 0) - cached;
  return (input * PRICE.input + cached * PRICE.cached + (usage?.completion_tokens ?? 0) * PRICE.output) / 1e6;
}

/** One chat completion within `timeout` ms. Low reasoning effort: these are lookups, not puzzles. */
async function chat(body: Record<string, unknown>, timeout: number): Promise<ReplyMessage> {
  const apiKey = process.env.META_API_KEY;
  if (!apiKey) throw new Error("META_API_KEY is not set (web/.env.local).");
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ reasoning_effort: "low", ...body }),
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(`Meta ${res.status}: ${err?.error?.message ?? res.statusText}`);
  }
  const reply = (await res.json()) as ChatResponse;
  const u = reply.usage;
  console.info(`[meta] ${String(body.model)}: ${u?.prompt_tokens ?? "?"} in (${u?.prompt_tokens_details?.cached_tokens ?? 0} cached), ${u?.completion_tokens ?? "?"} out, $${costOf(u).toFixed(5)}`);
  const message = reply.choices?.[0]?.message;
  if (!message) throw new Error("Meta returned nothing.");
  return message;
}

async function json<T>(model: string, timeout: number, instruction: string, content: Part[], name: string, schema: unknown): Promise<T> {
  const message = await chat(
    {
      model,
      messages: [
        { role: "system", content: instruction },
        { role: "user", content },
      ] satisfies Message[],
      response_format: { type: "json_schema", json_schema: { name, schema } },
    },
    timeout,
  );
  if (!message.content) throw new Error("Meta returned nothing.");
  return JSON.parse(message.content) as T;
}

const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

async function readKhataPhoto(image: Uint8Array, mime: string, today: string): Promise<ReadLine[]> {
  const url = `data:${baseMime(mime) || "image/jpeg"};base64,${base64(image)}`;
  const result = await json<{ rows: ReadLine[] }>(
    metaModel(),
    45_000,
    KHATA_INSTRUCTION,
    [
      { type: "image_url", image_url: { url } },
      { type: "text", text: khataPrompt(today) },
    ],
    "khata_page",
    KHATA_SCHEMA,
  );
  return usableLines(result.rows);
}

/** Muse Spark takes WAV or MP3; the browser sends questions as WAV. */
const transcribeQuestion: Provider["transcribeQuestion"] = (audio, mime) => {
  const type = baseMime(mime);
  const format = type === "audio/wav" || type === "audio/x-wav" || type === "audio/wave" ? "wav" : type === "audio/mpeg" || type === "audio/mp3" ? "mp3" : null;
  if (!format) throw new Error(`Meta can't read ${type || "this"} audio.`);
  return json(
    audioModel(),
    20_000,
    TRANSCRIPT_INSTRUCTION,
    [
      { type: "input_audio", input_audio: { data: base64(audio), format } },
      { type: "text", text: TRANSCRIPT_PROMPT },
    ],
    "transcript",
    TRANSCRIPT_SCHEMA,
  );
};

/** The assistant: Muse Spark calls our tools on the shop's data, a few rounds at most, within ~45 s. */
async function answerWithTools(question: string, tools: ToolSpec[], run: ToolRun, instruction: string): Promise<ToolAnswer> {
  const deadline = Date.now() + 45_000;
  const functions = tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parametersJsonSchema ?? { type: "object", properties: {} } },
  }));
  const messages: Message[] = [
    { role: "system", content: instruction },
    { role: "user", content: question },
  ];
  const calls: ToolAnswer["calls"] = [];
  for (let round = 0; round < 4; round++) {
    const left = deadline - Date.now();
    if (left < 3_000) throw new Error("Out of time");
    const message = await chat({ model: metaModel(), messages, tools: functions }, Math.min(20_000, left));
    const wanted = message.tool_calls ?? [];
    if (wanted.length === 0) return { answer: (message.content ?? "").trim(), calls };
    messages.push({ role: "assistant", content: message.content ?? null, tool_calls: wanted });
    for (const tc of wanted) {
      const name = tc.function.name;
      let args: Record<string, unknown> = {};
      let response: unknown;
      try {
        args = tc.function.arguments ? (JSON.parse(tc.function.arguments) as Record<string, unknown>) : {};
        calls.push({ name, args });
        response = await run(name, args);
      } catch (err) {
        response = { error: err instanceof Error ? err.message : String(err) };
      }
      messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify({ result: response }) });
    }
  }
  return { answer: "", calls };
}

const mapColumns: Provider["mapColumns"] = (sample) =>
  json(metaModel(), 20_000, COLUMNS_INSTRUCTION, [{ type: "text", text: columnsPrompt(sample) }], "spreadsheet_columns", COLUMNS_SCHEMA);

export const meta: Provider = {
  name: "meta",
  configured: metaConfigured,
  model: metaModel,
  readKhataPhoto,
  transcribeQuestion,
  answerWithTools,
  mapColumns,
};
