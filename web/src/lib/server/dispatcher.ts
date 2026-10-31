import type { SupabaseClient } from "@supabase/supabase-js";
import { format } from "date-fns";
import { dialOrder, formatINR, isWithinCallingHours, spokenName, summaryCallToday, toDateKey } from "@/lib/domain/rules";
import type { Language, Shop } from "@/lib/domain/types";
import { BolnaError, getExecution, makeCall } from "./bolna/client";
import { agentIds, bolnaConfigured } from "./bolna/config";
import { BOLNA_LANGUAGE, LANGUAGE_NAMES, reminderGreeting, reportGreeting } from "./bolna/prompts";
import { applyExecution } from "./call-results";
import { loadLines, loadShopData, loadShopsById, type LineCall } from "./data";
import { env } from "./env";
import { customerDetail, dailyReport } from "./queries";
import { adminClient, check } from "./supabase";

/**
 * Runs every minute (Supabase cron → /api/cron/dispatch), and right after a call is scheduled for now:
 * 1. checks calls on a line with Bolna, in case a webhook was missed;
 * 2. creates each shop's evening summary call at its chosen time, on the days its plan includes;
 * 3. queues calls whose time has come;
 * 4. dials queued calls while lines are free, taking turns between shops.
 */

type QueuedCall = LineCall & { kind: "reminder" | "report"; customerId: string | null; toNumber: string | null; language: Language };

/** Which waiting calls get the free lines now. Pure. */
export function callsToDial<T extends LineCall>(waiting: T[], onLine: LineCall[], lines: number, canDial: (c: T) => boolean): T[] {
  return dialOrder(waiting.filter(canDial), onLine).slice(0, Math.max(0, lines - onLine.length));
}

/**
 * A customer call dials only inside the shop's calling hours. One scheduled outside them was let
 * through by the demo bypass when it was scheduled, so it may dial. Summary calls go any time.
 */
export function mayDialNow(call: { kind: "reminder" | "report"; scheduledAt: string }, shop: Shop, now: Date): boolean {
  if (call.kind === "report") return true;
  const hours = shop.callingHours;
  return isWithinCallingHours(now, hours) || !isWithinCallingHours(new Date(call.scheduledAt), hours) || shop.demoBypassHours;
}

/** True when the summary call is due: within an hour after the shop's chosen time. */
export function reportDue(reportTime: string, now: Date): boolean {
  const [h, m] = reportTime.split(":").map(Number);
  const minutes = now.getHours() * 60 + now.getMinutes();
  const at = h * 60 + m;
  return minutes >= at && minutes < at + 60;
}

export type DispatchSummary = { checked: number; reports: number; queued: number; dialled: number; failed: number };

export async function runDispatcher(now = new Date()): Promise<DispatchSummary> {
  const admin = adminClient();
  const summary: DispatchSummary = { checked: 0, reports: 0, queued: 0, dialled: 0, failed: 0 };
  if (!bolnaConfigured()) return summary;
  summary.checked = await checkCallsOnLine(admin, now);
  summary.reports = await createEveningReports(admin, now);
  summary.queued = await queueDueCalls(admin, now);
  const { dialled, failed } = await dialFreeLines(admin, now);
  summary.dialled = dialled;
  summary.failed = failed;
  return summary;
}

let lastNudge = 0;

/** Runs the dispatcher at most every 15 s per server, when someone is watching calls. Never throws. */
export async function nudgeDispatcher(): Promise<void> {
  const t = Date.now();
  if (t - lastNudge < 15_000 || !bolnaConfigured()) return;
  lastNudge = t;
  try {
    await runDispatcher();
  } catch (err) {
    console.error("[dispatcher]", err instanceof Error ? err.message : err);
  }
}

async function checkCallsOnLine(admin: SupabaseClient, now: Date): Promise<number> {
  const stale = new Date(now.getTime() - 20_000).toISOString();
  const rows = check(
    await admin
      .from("calls")
      .select("id, bolna_execution_id, dispatched_at")
      .in("status", ["ringing", "in_progress"])
      .lt("updated_at", stale)
      .returns<{ id: string; bolna_execution_id: string | null; dispatched_at: string | null }[]>(),
  );
  let checked = 0;
  for (const r of rows) {
    if (!r.bolna_execution_id) {
      // Claimed for dialing but never handed to Bolna (the server stopped mid-way).
      if (r.dispatched_at && now.getTime() - Date.parse(r.dispatched_at) > 120_000) {
        check(await admin.from("calls").update({ status: "failed", error: "The call was never placed.", ended_at: now.toISOString() }).eq("id", r.id).select("id"));
      }
      continue;
    }
    try {
      await applyExecution(admin, await getExecution(r.bolna_execution_id), now);
      checked++;
    } catch (err) {
      console.error("[dispatcher] check", r.id, err instanceof Error ? err.message : err);
    }
  }
  return checked;
}

async function createEveningReports(admin: SupabaseClient, now: Date): Promise<number> {
  const settings = check(
    await admin.from("shop_settings").select("shop_id, report_time, report_language").eq("report_enabled", true).returns<{ shop_id: string; report_time: string; report_language: Language }[]>(),
  );
  const due = settings.filter((s) => reportDue(s.report_time.slice(0, 5), now));
  if (due.length === 0) return 0;
  const startOfDay = new Date(`${toDateKey(now)}T00:00:00`).toISOString();
  const already = new Set(
    check(
      await admin
        .from("calls")
        .select("shop_id")
        .eq("kind", "report")
        .gte("created_at", startOfDay)
        .in("shop_id", due.map((s) => s.shop_id))
        .returns<{ shop_id: string }[]>(),
    ).map((r) => r.shop_id),
  );
  const shops = await loadShopsById(admin, due.filter((s) => !already.has(s.shop_id)).map((s) => s.shop_id));
  let created = 0;
  for (const shop of shops.values()) {
    // Daily on Asha Plus, Saturdays on Asha, never on the free plan.
    if (!summaryCallToday(shop.plan, now)) continue;
    const row = check(
      await admin
        .from("calls")
        .insert({ shop_id: shop.id, kind: "report", to_number: shop.ownerPhone, language: shop.reportLanguage, status: "scheduled", scheduled_at: now.toISOString() })
        .select("id")
        .single<{ id: string }>(),
    );
    check(await admin.from("call_events").insert({ call_id: row.id, shop_id: shop.id, status: "scheduled", detail: "Evening summary at your chosen time" }).select("id"));
    created++;
  }
  return created;
}

async function queueDueCalls(admin: SupabaseClient, now: Date): Promise<number> {
  const due = check(
    await admin.from("calls").update({ status: "queued" }).eq("status", "scheduled").lte("scheduled_at", now.toISOString()).select("id, shop_id").returns<{ id: string; shop_id: string }[]>(),
  );
  if (due.length) {
    check(await admin.from("call_events").insert(due.map((c) => ({ call_id: c.id, shop_id: c.shop_id, status: "queued", detail: "Waiting for a free line" }))).select("id"));
  }
  return due.length;
}

async function dialFreeLines(admin: SupabaseClient, now: Date): Promise<{ dialled: number; failed: number }> {
  const lines = await loadLines(admin, env.callLines());
  if (lines.waiting.length === 0 || lines.onLine.length >= lines.lines) return { dialled: 0, failed: 0 };
  const waiting = check(
    await admin
      .from("calls")
      .select("id, shop_id, scheduled_at, status, kind, customer_id, to_number, language")
      .eq("status", "queued")
      .returns<{ id: string; shop_id: string; scheduled_at: string; status: "queued"; kind: "reminder" | "report"; customer_id: string | null; to_number: string | null; language: Language }[]>(),
  ).map(
    (r): QueuedCall => ({ id: r.id, shopId: r.shop_id, scheduledAt: r.scheduled_at, status: r.status, kind: r.kind, customerId: r.customer_id, toNumber: r.to_number, language: r.language }),
  );
  const shops = await loadShopsById(admin, [...new Set(waiting.map((c) => c.shopId))]);
  const picked = callsToDial(waiting, lines.onLine, lines.lines, (c) => {
    const shop = shops.get(c.shopId);
    return !!shop && mayDialNow(c, shop, now);
  });

  let dialled = 0;
  let failed = 0;
  for (const call of picked) {
    // Claim the call first, so two dispatchers running at once never dial it twice.
    const claimed = check(
      await admin.from("calls").update({ status: "ringing", dispatched_at: now.toISOString() }).eq("id", call.id).eq("status", "queued").select("id"),
    );
    if (claimed.length === 0) continue;
    const shop = shops.get(call.shopId)!;
    try {
      const executionId = await placeCall(admin, call, shop, now);
      check(await admin.from("calls").update({ bolna_execution_id: executionId, bolna_agent_id: call.kind === "report" ? agentIds().report : agentIds().reminder, started_at: now.toISOString() }).eq("id", call.id).select("id"));
      check(
        await admin
          .from("call_events")
          .insert({ call_id: call.id, shop_id: call.shopId, status: "ringing", detail: call.kind === "report" ? "Calling the shopkeeper" : "Calling from Bolna's shared +91 number" })
          .select("id"),
      );
      dialled++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[dispatcher] dial", call.id, message);
      check(await admin.from("calls").update({ status: "failed", error: message, ended_at: now.toISOString() }).eq("id", call.id).select("id"));
      check(await admin.from("call_events").insert({ call_id: call.id, shop_id: call.shopId, status: "failed", detail: "Bolna couldn't place the call" }).select("id"));
      failed++;
    }
  }
  return { dialled, failed };
}

/** Hands one call to Bolna with everything the agent needs to know. Returns Bolna's execution ID. */
async function placeCall(admin: SupabaseClient, call: QueuedCall, shop: Shop, now: Date): Promise<string> {
  const db = await loadShopData(admin, shop, { lines: 0, onLine: [], waiting: [] }, now);
  let userData: Record<string, string | number>;
  let to: string;
  if (call.kind === "report") {
    const report = dailyReport(db, now);
    const owner = shop.ownerName.split(" ")[0];
    to = shop.ownerPhone;
    userData = {
      owner_name: owner,
      shop_name: shop.name,
      language_name: LANGUAGE_NAMES[call.language],
      summary: report.spoken[call.language],
      greeting: reportGreeting(call.language, report.spoken),
    };
  } else {
    const detail = call.customerId ? customerDetail(db, call.customerId, now) : null;
    if (!detail) throw new Error("The customer no longer exists.");
    const c = detail.customer;
    to = call.toNumber || c.phone;
    if (!to) throw new Error("The customer has no phone number.");
    const spoken = spokenName(c, call.language);
    const items = detail.entries.slice(0, 3).map((e) => e.items).filter(Boolean).join(", ") || "items from the shop";
    userData = {
      customer_name: spoken,
      shop_name: shop.name,
      language_name: LANGUAGE_NAMES[call.language],
      amount_due: formatINR(detail.balance),
      items,
      memory: detail.memory,
      dispute_note: detail.openDispute
        ? `There is an open dispute: ${detail.openDispute.reason}. Do not ask for the disputed amount; say the shopkeeper is checking it.`
        : "There are no open disputes.",
      today: format(now, "EEEE, d MMMM yyyy"),
      upi_id: shop.upiId || "not set up; they can pay at the shop",
      max_minutes: shop.maxCallMinutes,
      greeting: reminderGreeting(call.language, spoken, shop.name),
    };
  }
  const base = {
    agent_id: call.kind === "report" ? agentIds().report : agentIds().reminder,
    recipient_phone_number: to,
    user_data: userData,
    // Calling hours are enforced here, per shop, before dialing.
    bypass_call_guardrails: true,
  };
  try {
    return (await makeCall({ ...base, agent_data: { language: BOLNA_LANGUAGE[call.language] } })).execution_id;
  } catch (err) {
    // An agent set up with one language can't be started in another; the prompt still names it.
    if (err instanceof BolnaError && err.status === 400 && /language|multilingual/i.test(err.message)) return (await makeCall(base)).execution_id;
    throw err;
  }
}
