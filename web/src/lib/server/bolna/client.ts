/** Bolna's REST API (https://www.bolna.ai/docs/api-reference). Server only: it carries our API key. */

const BASE = "https://api.bolna.ai";

function apiKey(): string {
  const key = process.env.BOLNA_API_KEY;
  if (!key) throw new Error("BOLNA_API_KEY is not set (web/.env.local).");
  return key;
}

async function request<T>(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { authorization: `Bearer ${apiKey()}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { message: text.slice(0, 300) };
  }
  if (!res.ok) {
    const raw = (json as { message?: unknown; detail?: unknown } | null)?.message ?? (json as { detail?: unknown } | null)?.detail ?? json;
    const message = typeof raw === "string" ? raw : JSON.stringify(raw) ?? res.statusText;
    throw new BolnaError(res.status, `Bolna ${method} ${path} failed (${res.status}): ${message}`);
  }
  return json as T;
}

export class BolnaError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export type MakeCallInput = {
  agent_id: string;
  recipient_phone_number: string;
  user_data?: Record<string, string | number | boolean>;
  /** Starts a multilingual agent in this language. Bolna answers 400 if the agent doesn't have it. */
  agent_data?: { language: string };
  bypass_call_guardrails?: boolean;
};

export const makeCall = (input: MakeCallInput) =>
  request<{ message: string; status: string; execution_id: string }>("POST", "/call", input);

/** Bolna's execution statuses. */
export type ExecutionStatus =
  | "scheduled"
  | "queued"
  | "rescheduled"
  | "initiated"
  | "ringing"
  | "in-progress"
  | "call-disconnected"
  | "completed"
  | "balance-low"
  | "busy"
  | "no-answer"
  | "canceled"
  | "failed"
  | "stopped"
  | "error";

/** The parts of an execution we read. */
export type Execution = {
  id: string;
  agent_id?: string;
  status: ExecutionStatus;
  conversation_duration?: number | null;
  /** In cents. */
  total_cost?: number | null;
  transcript?: string | null;
  summary?: string | null;
  extracted_data?: unknown;
  answered_by_voice_mail?: boolean | null;
  error_message?: string | null;
  termination_reason?: string | null;
  created_at?: string;
  updated_at?: string;
  telephony_data?: {
    duration?: string | number | null;
    to_number?: string | null;
    recording_url?: string | null;
    hangup_reason?: string | null;
  } | null;
};

export const getExecution = (executionId: string) => request<Execution>("GET", `/executions/${encodeURIComponent(executionId)}`);

export const patchAgent = (agentId: string, body: unknown) => request<unknown>("PATCH", `/v2/agent/${encodeURIComponent(agentId)}`, body);

/** The agent as Bolna stores it: settings at the top level, `tasks[0].tools_config` for audio and languages. */
export type StoredAgent = Record<string, unknown> & {
  tasks: {
    task_config?: Record<string, unknown>;
    tools_config: {
      multilingual_config?: {
        enabled: boolean;
        language_switch_trigger?: string;
        languages: Record<string, Record<string, unknown> & { system_prompt?: string | null; handoff_message?: string | null }>;
      };
    };
  }[];
};

export const getAgent = (agentId: string) => request<StoredAgent>("GET", `/v2/agent/${encodeURIComponent(agentId)}`);

/** Full update. Every setting is sent back as read, so only what the caller changed changes. */
export const putAgent = (agentId: string, body: unknown) => request<unknown>("PUT", `/v2/agent/${encodeURIComponent(agentId)}`, body);

export type Disposition = { id: string; name: string; agent_ids?: string[] };

/** The dispositions linked to one agent. */
export const listDispositions = async (agentId: string): Promise<Disposition[]> =>
  (await request<{ agent_dispositions?: Disposition[] }>("GET", `/dispositions/?agent_id=${encodeURIComponent(agentId)}`)).agent_dispositions ?? [];
export const createDisposition = (body: unknown) => request<Disposition>("POST", "/dispositions/", body);
export const updateDisposition = (id: string, body: unknown) => request<Disposition>("PUT", `/dispositions/${encodeURIComponent(id)}`, body);
export const deleteDisposition = (id: string) => request<unknown>("DELETE", `/dispositions/${encodeURIComponent(id)}`);
