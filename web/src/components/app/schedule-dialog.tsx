"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/label";
import { useT } from "@/lib/i18n";

const MAX_DAYS_AHEAD = 30;
const pad = (n: number) => String(n).padStart(2, "0");
const toDateInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toTimeInput = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function ScheduleDialog({
  open,
  onOpenChange,
  pending,
  initialAt,
  labels,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  pending: boolean;
  /** ISO string to pre-fill. If omitted, defaults to five minutes from now. */
  initialAt?: string;
  /** Overrides the single-call wording, e.g. for moving a whole batch. */
  labels?: { title: string; description: string; submit: string };
  onSubmit: (iso: string) => Promise<void>;
}) {
  const s = { ...useT().customers.detail.scheduleDialog, ...labels };
  const [{ date, time, maxDate }] = useState(() => {
    const now = new Date();
    const base = initialAt ? new Date(initialAt) : new Date(now.getTime() + 5 * 60_000);
    const max = new Date(now);
    max.setDate(max.getDate() + MAX_DAYS_AHEAD);
    return { date: toDateInput(base), time: toTimeInput(base), maxDate: toDateInput(max) };
  });
  const [dateValue, setDate] = useState(date);
  const [timeValue, setTime] = useState(time);
  const [error, setError] = useState<string | null>(null);
  const minDate = toDateInput(new Date());

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const [y, m, dd] = dateValue.split("-").map(Number);
    const [hh, mm] = timeValue.split(":").map(Number);
    const when = new Date(y, (m ?? 1) - 1, dd ?? 1, hh ?? 0, mm ?? 0, 0, 0);
    if (!Number.isFinite(when.getTime()) || when.getTime() <= Date.now()) {
      return setError(s.invalidPast);
    }
    await onSubmit(when.toISOString());
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{s.title}</DialogTitle>
            <DialogDescription>{s.description}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="schedule-date">{s.date}</Label>
              <DateInput
                id="schedule-date"
                min={minDate}
                max={maxDate}
                value={dateValue}
                onChange={(e) => { setDate(e.target.value); setError(null); }}
                aria-invalid={!!error}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="schedule-time">{s.time}</Label>
              <Input
                id="schedule-time"
                type="time"
                value={timeValue}
                onChange={(e) => { setTime(e.target.value); setError(null); }}
                aria-invalid={!!error}
              />
            </div>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="submit" size="lg" disabled={pending}>
              {s.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
