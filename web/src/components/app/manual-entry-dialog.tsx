"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import type { KhataLineInput } from "@/lib/api/contract";
import { useT } from "@/lib/i18n";

type Draft = { key: number; name: string; amount: string; items: string; date: string; phone: string };

/** Types a page of khata lines by hand; they go through the same review as a photo. */
export function ManualEntryDialog({ open, onOpenChange, today, onLines }: { open: boolean; onOpenChange: (v: boolean) => void; today: string; onLines: (lines: KhataLineInput[]) => void }) {
  const t = useT().khata.manual;
  const blank = (key: number): Draft => ({ key, name: "", amount: "", items: "", date: today, phone: "" });
  const [rows, setRows] = useState<Draft[]>(() => [blank(1), blank(2), blank(3)]);
  const [error, setError] = useState<string | null>(null);
  const set = (key: number, patch: Partial<Draft>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const lines = rows
      .filter((r) => r.name.trim() || r.amount.trim())
      .map((r) => ({ name: r.name.trim(), amount: Math.round(Number(r.amount)), items: r.items.trim(), date: r.date || today, phone: r.phone.trim() || undefined }));
    if (lines.length === 0 || lines.some((l) => !l.name || !Number.isFinite(l.amount) || l.amount <= 0)) return setError(t.invalid);
    onLines(lines);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t.title}</DialogTitle>
            <DialogDescription>{t.description}</DialogDescription>
          </DialogHeader>
          <div className="max-h-[55vh] space-y-3 overflow-y-auto pr-1">
            {rows.map((r, i) => (
              <div key={r.key} className="grid grid-cols-2 gap-2 rounded-lg border p-2 sm:grid-cols-[2fr_1fr_2fr_1.3fr_1.6fr_auto] sm:border-0 sm:p-0">
                <Input aria-label={`${t.name} ${i + 1}`} placeholder={t.name} value={r.name} onChange={(e) => set(r.key, { name: e.target.value })} className="col-span-2 sm:col-span-1" />
                <Input aria-label={`${t.amount} ${i + 1}`} placeholder={t.amount} inputMode="numeric" value={r.amount} onChange={(e) => set(r.key, { amount: e.target.value })} />
                <Input aria-label={`${t.items} ${i + 1}`} placeholder={t.items} value={r.items} onChange={(e) => set(r.key, { items: e.target.value })} />
                <DateInput aria-label={`${t.date} ${i + 1}`} max={today} value={r.date} onChange={(e) => set(r.key, { date: e.target.value })} />
                <Input aria-label={`${t.phone} ${i + 1}`} placeholder={t.phone} inputMode="tel" value={r.phone} onChange={(e) => set(r.key, { phone: e.target.value })} />
                <Button type="button" variant="ghost" size="icon" aria-label={t.remove} onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : rs))}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
          <Button type="button" variant="outline" onClick={() => setRows((rs) => [...rs, blank(Math.max(...rs.map((x) => x.key)) + 1)])}>
            <Plus /> {t.addLine}
          </Button>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="submit" size="lg">
              {t.continue}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
