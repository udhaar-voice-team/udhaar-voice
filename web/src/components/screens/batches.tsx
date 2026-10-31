"use client";

import { addDays, format, parseISO } from "date-fns";
import { AlertTriangle, CalendarClock, ChevronDown, Info, PhoneCall, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { CallStatusPill, CustomerName, ErrorBlock, hourLabel, LoadingBlock, Money, OutcomeBadge, StatusChip } from "@/components/app/bits";
import { ScheduleDialog } from "@/components/app/schedule-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import type { BatchSummary, CallListItem, EligibleCustomer } from "@/lib/api/contract";
import { attempt, useApiMutation, useReminderCandidates, useShop } from "@/lib/api/hooks";
import { isWithinCallingHours, toDateKey } from "@/lib/domain/rules";
import type { CallOutcome } from "@/lib/domain/types";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const MINUTES_PER_CALL = 2;
const USD_PER_MINUTE = 0.06;
const BATCH_TIME = "EEE d MMM, h:mm a";

/** Pick customers and a time. Lives in the "New batch" sheet on the Calls page. */
export function NewBatchForm({ onScheduled }: { onScheduled: () => void }) {
  const t = useT().batches;
  const shop = useShop();
  const q = useReminderCandidates();
  const schedule = useApiMutation(api.scheduleReminders);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<"now" | "later">("now");
  // Filled in when "Later" is picked. Reading the clock during render would freeze the build day's date.
  const [date, setDate] = useState("");
  const [time, setTime] = useState("10:00");
  const [bypass, setBypass] = useState(false);

  if (q.isPending || shop.isPending) return <LoadingBlock />;
  if (q.isError || shop.isError) return <ErrorBlock onRetry={() => q.refetch()} />;

  const hours = shop.data.callingHours;
  const eligible = q.data.filter((c) => c.eligible);
  const requested = mode === "now" ? new Date() : new Date(`${date}T${time}`);
  const outside = !isWithinCallingHours(requested, hours);
  const blocked = outside && !bypass;
  const count = [...selected].filter((id) => eligible.some((c) => c.customer.id === id)).length;
  const minutes = count * MINUTES_PER_CALL;

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const submit = async () => {
    const done = await attempt(
      schedule.mutateAsync({
        customerIds: [...selected],
        at: mode === "now" ? "now" : requested.toISOString(),
        language: "auto",
        bypassHours: bypass,
      }),
    );
    if (!done) return;
    const r = done.value;
    if (r.outsideHours) return toast.error(t.outsideHours(hourLabel(r.outsideHours.start), hourLabel(r.outsideHours.end)));
    if (!r.batch) return toast.error(r.skipped[0]?.reason ?? "Nothing scheduled");
    toast.success(t.scheduled(r.batch.callIds.length), { description: r.skipped.length ? t.skipped(r.skipped.length) : undefined });
    setSelected(new Set());
    onScheduled();
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="outline" size="sm" onClick={() => setSelected(new Set(eligible.map((c) => c.customer.id)))} disabled={eligible.length === 0}>
          {t.selectAll(eligible.length)}
        </Button>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">{t.selected(count)}</span>
          {selected.size ? (
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              {t.clear}
            </Button>
          ) : null}
        </div>
      </div>

      <ul className="divide-y rounded-lg border">
        {q.data
          .filter((c) => c.balance > 0)
          .map((c) => (
            <CandidateRow key={c.customer.id} c={c} checked={selected.has(c.customer.id)} onToggle={() => toggle(c.customer.id)} />
          ))}
      </ul>

      <div className="space-y-3">
        <Label>{t.when}</Label>
        <RadioGroup
          value={mode}
          onValueChange={(v) => {
            setMode(v as "now" | "later");
            if (v === "later" && !date) setDate(toDateKey(addDays(new Date(), 1)));
          }}
          className="flex gap-6"
        >
          <label className="flex items-center gap-2 text-sm">
            <RadioGroupItem value="now" id="when-now" /> {t.now}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <RadioGroupItem value="later" id="when-later" /> {t.later}
          </label>
        </RadioGroup>
        {mode === "later" ? (
          <div className="flex flex-wrap gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="batch-date" className="text-xs text-muted-foreground">
                {t.date}
              </Label>
              <DateInput id="batch-date" value={date} min={toDateKey(new Date())} onChange={(e) => setDate(e.target.value)} className="h-10 w-44" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="batch-time" className="text-xs text-muted-foreground">
                {t.time}
              </Label>
              <Input id="batch-time" type="time" step={1800} value={time} onChange={(e) => setTime(e.target.value)} className="h-10 w-32" />
            </div>
          </div>
        ) : null}
        {outside ? (
          <div className="space-y-3 rounded-lg border border-promised/40 bg-promised-soft/60 p-3 text-sm">
            {blocked ? (
              <p className="flex gap-2 font-medium">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-promised" />
                {t.outsideHours(hourLabel(hours.start), hourLabel(hours.end))}
              </p>
            ) : null}
            <label className="flex items-start gap-3">
              <Switch checked={bypass} onCheckedChange={setBypass} id="bypass-hours" />
              <span>
                <span className="font-medium">{t.bypass}</span>
                <span className="block text-xs text-muted-foreground">{t.bypassHint}</span>
              </span>
            </label>
          </div>
        ) : null}
      </div>

      <div className="sticky bottom-0 -mx-4 flex flex-col gap-3 border-t bg-popover px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm">
          <p className="font-medium">{t.estimate(count, minutes, `$${(minutes * USD_PER_MINUTE).toFixed(2)}`)}</p>
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <Info className="size-3.5" /> {t.estimateHint}
          </p>
        </div>
        <Button size="lg" onClick={submit} disabled={count === 0 || blocked || schedule.isPending}>
          <PhoneCall /> {t.schedule(count)}
        </Button>
      </div>
    </div>
  );
}

function CandidateRow({ c, checked, onToggle }: { c: EligibleCustomer; checked: boolean; onToggle: () => void }) {
  const id = `pick-${c.customer.id}`;
  return (
    <li className={cn("flex items-start gap-3 px-3 py-2.5", !c.eligible && "opacity-60")}>
      <Checkbox id={id} checked={checked && c.eligible} disabled={!c.eligible} onCheckedChange={onToggle} className="mt-1" />
      <label htmlFor={id} className={cn("flex min-w-0 flex-1 flex-col gap-1", c.eligible && "cursor-pointer")}>
        <span className="flex items-center justify-between gap-3">
          <CustomerName name={c.customer.name} nativeName={c.customer.nameNative} language={c.customer.language} />
          <span className="flex shrink-0 items-center gap-2">
            <StatusChip status={c.status} className="hidden sm:inline-flex" />
            <Money amount={c.balance} className="font-semibold" />
          </span>
        </span>
        {c.reason ? <span className="text-xs text-muted-foreground">{c.reason}</span> : null}
        {c.note ? <span className="text-xs font-medium text-promised">{c.note}</span> : null}
      </label>
    </li>
  );
}

export function BatchCard({ b }: { b: BatchSummary }) {
  const { batches: t, common } = useT();
  const cancel = useApiMutation(api.cancelBatch);
  const move = useApiMutation((v: { at: string }) => api.rescheduleBatch(b.batch.id, v.at, false));
  const active = b.batch.status === "scheduled" || b.batch.status === "running";
  const [open, setOpen] = useState(active);
  const [moving, setMoving] = useState(false);
  const total = b.calls.length - b.counts.removed;
  const next = b.calls.flatMap((x) => (x.queue ? [x.queue] : [])).sort((a, z) => a.position - z.position)[0];
  const statusTone =
    b.batch.status === "running" ? "bg-paid-soft text-paid" : b.batch.status === "scheduled" ? "bg-callback-soft text-callback" : "bg-muted text-muted-foreground";

  const moveTo = async (at: string) => {
    const done = await attempt(move.mutateAsync({ at }));
    if (!done) return;
    const r = done.value;
    // Outside calling hours nothing moves; the dialog stays open for another pick.
    if (r.outsideHours) return void toast.error(t.outsideHours(hourLabel(r.outsideHours.start), hourLabel(r.outsideHours.end)));
    toast.success(t.moved(format(parseISO(r.batch.scheduledAt), BATCH_TIME)));
    setMoving(false);
  };

  return (
    <li className={cn("space-y-3 rounded-xl border bg-card p-4", active && "border-primary/40")}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium">{t.batchTitle(format(parseISO(b.batch.scheduledAt), BATCH_TIME))}</p>
          <p className="text-xs text-muted-foreground">{t.counts(b.counts.waiting, b.counts.active, b.counts.done, b.counts.removed)}</p>
          {next && next.waitSeconds > 0 ? <p className="text-xs font-medium text-promised">{t.linesBusy(next.lines, common.wait(next.waitSeconds))}</p> : null}
        </div>
        <span className={cn("inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-xs font-semibold", statusTone)}>{t.batchStatus[b.batch.status]}</span>
      </div>
      <Progress value={(b.counts.done / Math.max(1, total)) * 100} />
      {Object.keys(b.outcomes).length ? (
        <div className="flex flex-wrap gap-1.5">
          {(Object.entries(b.outcomes) as [CallOutcome, number][]).map(([outcome, n]) => (
            <span key={outcome} className="inline-flex items-center gap-1">
              <OutcomeBadge outcome={outcome} />
              <span className="text-xs text-muted-foreground tabular">×{n}</span>
            </span>
          ))}
        </div>
      ) : null}
      {b.batch.status === "running" && b.counts.waiting > 0 ? <p className="text-xs text-muted-foreground">{t.timeLocked}</p> : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <ChevronDown className={cn("transition-transform", open && "rotate-180")} /> {open ? t.hideCalls : t.showCalls(b.calls.length)}
        </Button>
        <div className="flex flex-wrap gap-2">
          {b.canChangeTime ? (
            <Button variant="outline" size="sm" onClick={() => setMoving(true)}>
              <CalendarClock /> {t.changeTime}
            </Button>
          ) : null}
          {active && b.counts.waiting > 0 ? (
            <Button
              variant="outline"
              size="sm"
              disabled={cancel.isPending}
              onClick={async () => {
                if (await attempt(cancel.mutateAsync(b.batch.id))) toast.success(t.cancelled);
              }}
            >
              {t.cancel}
            </Button>
          ) : null}
        </div>
      </div>
      {open ? (
        <ul className="divide-y rounded-lg border">
          {b.calls.map((item) => (
            <BatchCallRow key={item.call.id} item={item} />
          ))}
        </ul>
      ) : null}
      {moving ? (
        <ScheduleDialog open={moving} onOpenChange={setMoving} pending={move.isPending} initialAt={b.batch.scheduledAt} labels={t.changeDialog} onSubmit={moveTo} />
      ) : null}
    </li>
  );
}

function BatchCallRow({ item: { call, customer, queue } }: { item: CallListItem }) {
  const t = useT().batches;
  const remove = useApiMutation(api.cancelCall);
  const [confirming, setConfirming] = useState(false);
  const name = customer?.name ?? "Shopkeeper";
  // Anyone not yet on a call can still be taken out of the batch.
  const removable = call.status === "scheduled" || call.status === "queued";

  return (
    <li className="flex items-center gap-2 pr-2">
      <Link href={`/app/calls/${call.id}`} className="flex min-w-0 flex-1 items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-muted/40">
        <span className="truncate">
          {name}
          {queue ? <span className="ml-2 text-xs text-muted-foreground">{t.inLine(queue.position)}</span> : null}
        </span>
        {call.status === "completed" && call.extraction ? <OutcomeBadge outcome={call.extraction.outcome} /> : <CallStatusPill status={call.status} />}
      </Link>
      {removable ? (
        <Button
          variant={confirming ? "destructive" : "ghost"}
          size="sm"
          aria-label={t.removeLabel(name)}
          disabled={remove.isPending}
          onBlur={() => setConfirming(false)}
          onClick={async () => {
            if (!confirming) return setConfirming(true);
            if (await attempt(remove.mutateAsync(call.id))) toast.success(t.removed(name));
          }}
        >
          {confirming ? (
            t.confirmRemove
          ) : (
            <>
              <X /> <span className="hidden sm:inline">{t.remove}</span>
            </>
          )}
        </Button>
      ) : null}
    </li>
  );
}
