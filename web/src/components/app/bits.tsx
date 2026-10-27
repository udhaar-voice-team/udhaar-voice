"use client";

import { format, formatDistanceToNowStrict } from "date-fns";
import { AlertTriangle, Inbox, Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { confidenceLabel, formatINR, maskPhone } from "@/lib/domain/rules";
import type { CallOutcome, CallStatus, CustomerStatus, Language } from "@/lib/domain/types";
import { useT } from "@/lib/i18n";
import { useNow } from "@/hooks/use-now";

/* ---------- money, phone, language ---------- */

/** "8 AM", for calling hours. */
export const hourLabel = (h: number) => format(new Date(2026, 0, 1, h), "h a");

export function Money({ amount, className }: { amount: number; className?: string }) {
  return <span className={cn("tabular font-mono", className)}>{formatINR(amount)}</span>;
}

export function MaskedPhone({ phone, className }: { phone: string; className?: string }) {
  const t = useT();
  if (!phone) return <span className={cn("text-muted-foreground italic", className)}>No number</span>;
  return (
    <span className={cn("tabular font-mono text-muted-foreground", className)} title={t.common.prototype.masked}>
      {maskPhone(phone)}
    </span>
  );
}

export function LanguageTag({ language }: { language: Language }) {
  const t = useT();
  return (
    <span
      className="inline-flex h-5 items-center rounded-md border px-1.5 font-mono text-[10px] font-semibold tracking-wider text-muted-foreground"
      title={t.common.language[language]}
    >
      {t.common.languageShort[language]}
    </span>
  );
}

/** A name in Latin script with the native-script name underneath, rendered with the right font. */
export function CustomerName({ name, nativeName, language, className }: { name: string; nativeName?: string; language?: Language; className?: string }) {
  return (
    <span className={cn("flex min-w-0 flex-col", className)}>
      <span className="truncate font-medium">{name}</span>
      {nativeName && nativeName !== name ? (
        <span lang={language} className="truncate text-xs text-muted-foreground">
          {nativeName}
        </span>
      ) : null}
    </span>
  );
}

/* ---------- state chips ---------- */

const STATUS_STYLE: Record<CustomerStatus, string> = {
  due: "bg-due-soft text-due",
  overdue: "bg-overdue-soft text-overdue",
  promised: "bg-promised-soft text-promised",
  disputed: "bg-disputed-soft text-disputed",
  paid: "bg-paid-soft text-paid",
  opted_out: "bg-muted text-muted-foreground",
};

const chip = "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold whitespace-nowrap";

export function StatusChip({ status, className }: { status: CustomerStatus; className?: string }) {
  const t = useT();
  return (
    <span className={cn(chip, STATUS_STYLE[status], className)}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {t.common.status[status]}
    </span>
  );
}

const OUTCOME_STYLE: Record<CallOutcome, string> = {
  promised: "bg-promised-soft text-promised",
  disputed: "bg-disputed-soft text-disputed",
  callback: "bg-callback-soft text-callback",
  refused: "bg-due-soft text-due",
  wrong_number: "bg-overdue-soft text-overdue",
  opted_out: "bg-muted text-muted-foreground",
  no_answer: "bg-muted text-muted-foreground",
  report_delivered: "bg-paid-soft text-paid",
};

export function OutcomeBadge({ outcome, className }: { outcome: CallOutcome; className?: string }) {
  const t = useT();
  return <span className={cn(chip, OUTCOME_STYLE[outcome], className)}>{t.common.outcome[outcome]}</span>;
}

const LIVE: CallStatus[] = ["queued", "ringing", "in_progress"];
const CALL_STYLE: Record<CallStatus, string> = {
  scheduled: "bg-callback-soft text-callback",
  queued: "bg-callback-soft text-callback",
  ringing: "bg-promised-soft text-promised",
  in_progress: "bg-paid-soft text-paid",
  completed: "bg-muted text-foreground",
  no_answer: "bg-muted text-muted-foreground",
  busy: "bg-muted text-muted-foreground",
  failed: "bg-due-soft text-due",
  rescheduled: "bg-callback-soft text-callback",
  cancelled: "bg-muted text-muted-foreground line-through",
};

export function CallStatusPill({ status, className }: { status: CallStatus; className?: string }) {
  const t = useT();
  const live = LIVE.includes(status);
  return (
    <span className={cn(chip, CALL_STYLE[status], className)}>
      <span className="relative flex size-2" aria-hidden>
        {live ? <span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-60" /> : null}
        <span className="relative inline-flex size-2 rounded-full bg-current" />
      </span>
      {t.common.callStatus[status]}
    </span>
  );
}

export function ConfidenceBadge({ value, className }: { value: number; className?: string }) {
  const t = useT();
  const label = confidenceLabel(value);
  const style = label === "High" ? "bg-paid-soft text-paid" : label === "Medium" ? "bg-promised-soft text-promised" : "bg-due-soft text-due";
  return (
    <span className={cn(chip, style, className)} title={`${Math.round(value * 100)}%`}>
      {t.common.confidence[label]}
    </span>
  );
}

/* ---------- time ---------- */

export function TimeAgo({ iso, className }: { iso: string; className?: string }) {
  const now = useNow(30_000);
  const date = new Date(iso);
  const label = date.getTime() > now ? `in ${formatDistanceToNowStrict(date)}` : `${formatDistanceToNowStrict(date)} ago`;
  return (
    <time dateTime={iso} className={cn("tabular", className)} title={date.toLocaleString("en-IN")}>
      {label}
    </time>
  );
}

/* ---------- page structure ---------- */

export function PageHeader({ title, description, actions, eyebrow }: { title: string; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 pb-2 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 space-y-1.5">
        {eyebrow ? <div className="font-mono text-xs font-semibold tracking-wider text-muted-foreground uppercase">{eyebrow}</div> : null}
        <h1 className="text-2xl font-bold sm:text-3xl">{title}</h1>
        {description ? <p className="max-w-2xl text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center">
      <div className="text-muted-foreground">{icon ?? <Inbox className="size-6" />}</div>
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        {children ? <div className="mx-auto max-w-sm text-sm text-muted-foreground">{children}</div> : null}
      </div>
      {action}
    </div>
  );
}

export function LoadingBlock({ label = "Loading…", className }: { label?: string; className?: string }) {
  return (
    <div className={cn("flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground", className)} role="status">
      <Loader2 className="size-4 animate-spin" /> {label}
    </div>
  );
}

export function ErrorBlock({ onRetry }: { onRetry?: () => void }) {
  const t = useT();
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-8 text-center" role="alert">
      <AlertTriangle className="size-5 text-destructive" />
      <p className="text-sm">{t.common.errors.loadFailed}</p>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          {t.common.actions.retry}
        </Button>
      ) : null}
    </div>
  );
}

/** A number with a label, used for the summary row on top of screens. */
export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "due" | "promised" | "paid" | "disputed" }) {
  const toneClass = tone === "due" ? "text-due" : tone === "promised" ? "text-promised" : tone === "paid" ? "text-paid" : tone === "disputed" ? "text-disputed" : "";
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-xl border bg-card p-4">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className={cn("font-heading text-2xl font-bold tabular", toneClass)}>{value}</span>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  );
}
