/**
 * Writes Udhaar Voice's prompts, greeting, webhook and extractions onto the two Bolna agents
 * (BOLNA_REMINDER_AGENT_ID and BOLNA_REPORT_AGENT_ID). English and Hindi voices stay as set on Bolna;
 * Bengali, Odia and Marathi are added with Sarvam voices when an agent doesn't have them yet.
 * Safe to run again after a prompt change: existing extractions are updated, not duplicated, and
 * retired ones are removed.
 *
 * Runs as `npm run bolna:setup`.
 */
import { createDisposition, deleteDisposition, getAgent, listDispositions, patchAgent, putAgent, updateDisposition } from "../src/lib/server/bolna/client";
import { agentIds, appUrl, cronSecret, webhookUrl } from "../src/lib/server/bolna/config";
import { CALL_LINES, extractionDefinitions, RETIRED_EXTRACTIONS, HANGUP_RULE, REMINDER_PROMPT, REMINDER_WELCOME, REPORT_PROMPT, REPORT_WELCOME } from "../src/lib/server/bolna/prompts";

/** Settings PUT takes back from what GET returns. */
const AGENT_SETTINGS = [
  "agent_name",
  "agent_welcome_message",
  "webhook_url",
  "agent_type",
  "tasks",
  "calling_guardrails",
  "call_summary_enabled",
  "ingest_source_config",
  "webhook_config",
  "webhook_headers",
  "memory_config",
];

/**
 * Sarvam voices for the languages the setup adds. Bolna has Odia only on bulbul:v3, whose voices
 * speak every Indian language; Bengali and Marathi have their own conversational voices.
 */
const SARVAM_VOICES: Record<string, { voice: string; voice_id: string; model: string }> = {
  bn: { voice: "Roopa (Conversational)", voice_id: "roopa_bn_conversational", model: "bulbul:v4-flash" },
  od: { voice: "Priya", voice_id: "priya", model: "bulbul:v3" },
  mr: { voice: "Ishita (Conversational)", voice_id: "ishita_mr_conversational", model: "bulbul:v4-flash" },
};

/**
 * A multilingual agent keeps its own prompt per language, which the main-prompt update doesn't reach.
 * Every language gets the same prompt; it already says which language to speak.
 * Each call starts in the customer's own language, so the agent switches only when the customer asks:
 * auto-detection switched on one mis-heard word in testing, and announced it in English.
 * The agent also ends the call itself after goodbye, instead of asking "are you still there?".
 * Bolna's own call-backs are off: the app schedules every call, so opt-outs, calling hours and the
 * reminder gap apply. In testing, a call-back Bolna booked itself rang a customer who had opted out.
 */
async function setLanguagePrompts(agentId: string, prompt: string): Promise<string[]> {
  const agent = await getAgent(agentId);
  const multilingual = agent.tasks[0]?.tools_config.multilingual_config;
  if (!multilingual?.languages) return [];
  const languages = multilingual.languages;
  multilingual.language_switch_trigger = "caller_requested";
  for (const [code, voice] of Object.entries(SARVAM_VOICES)) {
    languages[code] ??= {
      agent_name: `${String(agent.agent_name)}-${code}`,
      synthesizer: { stream: true, provider: "sarvam", buffer_size: 200, provider_config: { ...voice, language: code }, pronunciation_rules: null },
      transcriber: { model: "saaras:v4", stream: true, language: code, provider: "sarvam" },
      system_prompt: prompt,
      handoff_message: null,
    };
  }
  for (const lang of Object.values(languages)) {
    lang.system_prompt = prompt;
    lang.handoff_message = null;
  }
  const taskConfig = agent.tasks[0].task_config ?? {};
  taskConfig.auto_reschedule = false;
  taskConfig.hangup_after_LLMCall = true;
  taskConfig.call_cancellation_prompt = HANGUP_RULE;
  taskConfig.call_hangup_message = CALL_LINES.hangup;
  taskConfig.check_user_online_message = CALL_LINES.stillThere;
  agent.tasks[0].task_config = taskConfig;
  const agentConfig = Object.fromEntries(AGENT_SETTINGS.filter((k) => agent[k] !== undefined && agent[k] !== null).map((k) => [k, agent[k]]));
  await putAgent(agentId, { agent_config: agentConfig, agent_prompts: { task_1: { system_prompt: prompt } } });
  return Object.keys(languages);
}

async function main() {
  const { reminder, report } = agentIds();
  const missing = [
    ["BOLNA_API_KEY", process.env.BOLNA_API_KEY],
    ["BOLNA_REMINDER_AGENT_ID", reminder],
    ["BOLNA_REPORT_AGENT_ID", report],
    ["APP_URL", appUrl()],
    ["CRON_SECRET", cronSecret()],
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) throw new Error(`Set ${missing.join(", ")} in web/.env.local first.`);

  await patchAgent(reminder, {
    agent_config: { agent_name: "Udhaar Voice · Reminder", agent_welcome_message: REMINDER_WELCOME, webhook_url: webhookUrl(), call_summary_enabled: true },
    agent_prompts: { task_1: { system_prompt: REMINDER_PROMPT } },
  });
  console.log(`Reminder agent updated (languages: ${(await setLanguagePrompts(reminder, REMINDER_PROMPT)).join(", ") || "one"}).`);

  await patchAgent(report, {
    agent_config: { agent_name: "Udhaar Voice · Evening summary", agent_welcome_message: REPORT_WELCOME, webhook_url: webhookUrl(), call_summary_enabled: false },
    agent_prompts: { task_1: { system_prompt: REPORT_PROMPT } },
  });
  console.log(`Evening summary agent updated (languages: ${(await setLanguagePrompts(report, REPORT_PROMPT)).join(", ") || "one"}).`);

  const existing = await listDispositions(reminder);
  for (const definition of extractionDefinitions(reminder)) {
    const found = existing.find((d) => d.name === definition.name);
    if (found) {
      await updateDisposition(found.id, definition);
      console.log(`Extraction updated: ${definition.name}`);
    } else {
      await createDisposition(definition);
      console.log(`Extraction created: ${definition.name}`);
    }
  }
  for (const old of existing.filter((d) => RETIRED_EXTRACTIONS.includes(d.name))) {
    await deleteDisposition(old.id);
    console.log(`Extraction removed: ${old.name}`);
  }
  console.log(`Done. Bolna sends call updates to ${appUrl()}/api/bolna/webhook.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
