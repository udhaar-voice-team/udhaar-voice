"use client";

import { format, parseISO } from "date-fns";
import {
  ArrowLeft,
  BadgeIndianRupee,
  CalendarClock,
  Ellipsis,
  MessageCircle,
  PhoneCall,
  PhoneOff,
  Phone,
  Plus,
  Sparkles,
  Pencil,
  Trash2,
  UserPen,
  QrCode,
  Languages,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  CallStatusPill,
  EmptyState,
  ErrorBlock,
  LanguageTag,
  LoadingBlock,
  PhoneNumber,
  Money,
  OutcomeBadge,
  hourLabel,
  StatusChip,
  TimeAgo,
} from "@/components/app/bits";
import { ScheduleDialog } from "@/components/app/schedule-dialog";
import { UpiQrDialog } from "@/components/app/upi-qr-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import type { CustomerDetail } from "@/lib/api/contract";
import { attempt, useApiMutation, useCustomer, useReminderCandidates, useShop } from "@/lib/api/hooks";
import { formatINR, isPromiseBroken, normalizeIndianMobile, payPageLink, toDateKey, upiLink, whatsappShareLink } from "@/lib/domain/rules";
import { LANGUAGES, type Language, type PaymentPromise } from "@/lib/domain/types";
import { dictionaryFor, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Initial } from "./customers";

export function CustomerDetailScreen() {
  const { id } = useParams<{ id: string }>();
  const t = useT();
  const q = useCustomer(id);

  if (q.isPending) return <LoadingBlock />;
  if (q.isError) return <ErrorBlock onRetry={() => q.refetch()} />;
  if (!q.data)
    return (
      <EmptyState title={t.customers.detail.notFound} action={<Button asChild variant="outline"><Link href="/app/customers">{t.customers.detail.back}</Link></Button>} />
    );
  return <CustomerView d={q.data} />;
}

function CustomerView({ d }: { d: CustomerDetail }) {
  const t = useT();
  const c = t.customers.detail;
  const { customer } = d;

  return (
    <div className="space-y-6">
      <Link href="/app/customers" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> {c.back}
      </Link>

      <Card>
        <CardContent className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <Initial name={customer.name} status={d.status} className="size-14 text-xl" />
            <div className="min-w-0 space-y-1.5">
              <h1 className="text-2xl font-bold">{customer.name}</h1>
              {customer.nameNative ? (
                <p lang={customer.language} className="text-muted-foreground">
                  {customer.nameNative}
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <StatusChip status={d.status} />
                <LanguageTag language={customer.language} />
                <PhoneNumber phone={customer.phone} />
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-3 md:items-end">
            <div className="md:text-right">
              <div className="text-xs font-medium text-muted-foreground">{c.balance}</div>
              <Money amount={d.balance} className={cn("font-heading text-3xl font-bold", d.balance > 0 ? "text-due" : "text-paid")} />
            </div>
            <CustomerActions d={d} />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card className="border-primary/25 bg-accent/60">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="size-4 text-primary" /> {c.memoryTitle}
              </CardTitle>
              <CardDescription>{c.memoryHint}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="rounded-lg border bg-background px-4 py-3 font-mono text-sm leading-relaxed">{d.memory}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{c.sections.calls}</CardTitle>
            </CardHeader>
            <CardContent>
              {d.calls.length === 0 ? (
                <p className="text-sm text-muted-foreground">{c.noCalls}</p>
              ) : (
                <ul className="divide-y">
                  {d.calls.map((call) => (
                    <li key={call.id}>
                      <Link href={`/app/calls/${call.id}`} className="flex items-center gap-3 py-3 hover:bg-muted/40">
                        <PhoneCall className="size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium">{format(parseISO(call.startedAt ?? call.scheduledAt), "EEE d MMM, h:mm a")}</span>
                          <span className="block truncate text-xs text-muted-foreground">{call.extraction?.summary ?? t.common.callStatus[call.status]}</span>
                        </span>
                        {call.extraction && call.status === "completed" ? <OutcomeBadge outcome={call.extraction.outcome} /> : <CallStatusPill status={call.status} />}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Ledger d={d} />
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{c.sections.promises}</CardTitle>
            </CardHeader>
            <CardContent>
              {d.promises.length === 0 ? (
                <p className="text-sm text-muted-foreground">{c.noPromises}</p>
              ) : (
                <ul className="space-y-3">
                  {d.promises.map((p) => (
                    <PromiseRow key={p.id} p={p} />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Disputes d={d} />

          <Card>
            <CardHeader>
              <CardTitle>{c.sections.notes}</CardTitle>
            </CardHeader>
            <CardContent>
              {d.notes.length === 0 ? (
                <p className="text-sm text-muted-foreground">{c.noNotes}</p>
              ) : (
                <ul className="space-y-3">
                  {d.notes.map((n) => (
                    <li key={n.id} className="space-y-1">
                      <span className="text-xs font-semibold text-muted-foreground">{t.common.noteKind[n.kind]}</span>
                      <p className="text-sm">{n.text}</p>
                      <TimeAgo iso={n.createdAt} className="text-xs text-muted-foreground" />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function CustomerActions({ d }: { d: CustomerDetail }) {
  const t = useT();
  const c = t.customers.detail;
  const router = useRouter();
  const shop = useShop();
  const candidates = useReminderCandidates();
  const schedule = useApiMutation(api.scheduleReminders);
  const update = useApiMutation((patch: Parameters<typeof api.updateCustomer>[1]) => api.updateCustomer(d.customer.id, patch));
  const [payOpen, setPayOpen] = useState(false);
  const [entryOpen, setEntryOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [nameOpen, setNameOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);
  // The dashboard's "Update number" links here with #phone. This component only renders in the
  // browser (after the customer has loaded), so reading the hash while creating state is safe.
  const [phoneOpen, setPhoneOpen] = useState(() => typeof window !== "undefined" && window.location.hash === "#phone");

  const me = candidates.data?.find((x) => x.customer.id === d.customer.id);
  const blocked = me && !me.eligible ? me.reason : undefined;
  const scheduledCall = d.calls.find((k) => k.status === "scheduled" || k.status === "queued");

  const callAt = async (at: string) => {
    const done = await attempt(schedule.mutateAsync({ customerIds: [d.customer.id], at, language: "auto", bypassHours: shop.data?.demoBypassHours ?? false }));
    if (!done) return false;
    const r = done.value;
    if (r.outsideHours) {
      const message = at === "now" ? c.outsideHours : t.batches.outsideHours;
      toast.error(message(hourLabel(r.outsideHours.start), hourLabel(r.outsideHours.end)));
      return false;
    }
    if (!r.batch) {
      toast.error(r.skipped[0]?.reason ?? "Couldn't schedule the call");
      return false;
    }
    if (at === "now") toast.success(c.callScheduled(d.customer.name));
    else toast.success(c.callScheduledAt(d.customer.name, format(parseISO(at), "EEE h:mm a")));
    router.push(`/app/calls/${r.batch.callIds[0]}`);
    return true;
  };
  const callNow = () => callAt("now");

  // Asha may call a few days after a WhatsApp reminder, so sending one is noted.
  const logWhatsapp = useApiMutation(api.logWhatsappReminder, { quiet: true });
  const shopName = shop.data?.name ?? "";
  const upiId = shop.data?.upiId ?? "";
  const upi = upiLink({ upiId, payeeName: shopName });
  // The message goes in the customer's language. WhatsApp doesn't open upi:// links, so it carries
  // the UPI ID and a link to the pay page, whose button opens the customer's UPI app.
  const words = dictionaryFor(d.customer.language).customers.detail;
  const qrFile = useQrFile(upiId ? upi : "");

  /**
   * A WhatsApp link can only carry text, so the QR code goes as a picture another way: on a phone
   * the share sheet sends it with the message (the shopkeeper picks WhatsApp, then the customer);
   * elsewhere it is copied, and WhatsApp opens on the customer's chat for it to be pasted.
   */
  const sendWhatsapp = async () => {
    logWhatsapp.mutate(d.customer.id);
    const message = (withQr: boolean) =>
      [
        words.reminderMessage(shopName, formatINR(d.balance)),
        upiId && words.payBy(upiId),
        upiId && words.payLink(payPageLink(window.location.origin, { upiId, payeeName: shopName, due: d.balance, language: d.customer.language })),
        withQr && words.qrAttached,
      ]
        .filter(Boolean)
        .join("\n\n");
    if (qrFile && window.matchMedia("(pointer: coarse)").matches && navigator.canShare?.({ files: [qrFile] })) {
      try {
        await navigator.share({ files: [qrFile], text: message(true) });
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
    }
    let copied = false;
    if (qrFile && typeof ClipboardItem !== "undefined") {
      try {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": qrFile })]);
        copied = true;
      } catch {
        // No clipboard access: the pay page has the QR code too.
      }
    }
    window.open(whatsappShareLink(d.customer.phone, message(copied)), "_blank", "noopener,noreferrer");
    if (copied) toast.success(c.qrCopied);
  };

  return (
    <div className="flex flex-col gap-2 md:items-end">
      {scheduledCall ? (
        <Link
          href={`/app/calls/${scheduledCall.id}`}
          aria-label={c.openNextCall}
          className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-accent px-3 py-1 text-xs font-medium text-primary hover:bg-accent/80"
        >
          <CalendarClock className="size-3.5" />
          {c.nextCall(format(parseISO(scheduledCall.scheduledAt), "EEE h:mm a"))}
        </Link>
      ) : null}
      <div className="flex flex-wrap gap-2 md:justify-end">
      <div className="inline-flex gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={blocked ? 0 : -1}>
              <Button size="lg" onClick={callNow} disabled={!!blocked || schedule.isPending || !me}>
                <PhoneCall /> {c.actions.callNow}
              </Button>
            </span>
          </TooltipTrigger>
          {blocked ? <TooltipContent>{blocked}</TooltipContent> : null}
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={blocked ? 0 : -1}>
              <Button size="lg" variant="outline" onClick={() => setScheduleOpen(true)} disabled={!!blocked || schedule.isPending || !me}>
                <CalendarClock /> {c.actions.scheduleCall}
              </Button>
            </span>
          </TooltipTrigger>
          {blocked ? <TooltipContent>{blocked}</TooltipContent> : null}
        </Tooltip>
      </div>
      {d.balance > 0 ? (
        <Button size="lg" variant="outline" onClick={() => void sendWhatsapp()}>
          <MessageCircle /> {c.actions.shareUpi}
        </Button>
      ) : null}
      {shop.data?.upiId && d.balance > 0 ? (
        <>
          <Button size="lg" variant="outline" onClick={() => setQrOpen(true)}>
            <QrCode /> {c.actions.showQr}
          </Button>
          <UpiQrDialog open={qrOpen} onOpenChange={setQrOpen} link={upi} amount={formatINR(d.balance)} />
        </>
      ) : null}
      <Button size="lg" variant="outline" onClick={() => setPayOpen(true)} disabled={d.balance <= 0}>
        <BadgeIndianRupee /> {c.actions.recordPayment}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon-lg" variant="outline" aria-label={c.actions.more}>
            <Ellipsis />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setEntryOpen(true)}>
            <Plus /> {c.actions.addEntry}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setNameOpen(true)}>
            <UserPen /> {c.actions.editName}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setPhoneOpen(true)}>
            <Phone /> {c.actions.editPhone}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setLanguageOpen(true)}>
            <Languages /> {c.actions.editLanguage}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={async () => {
              if (await attempt(update.mutateAsync({ optedOut: !d.customer.optedOut }))) toast.success(d.customer.optedOut ? c.optedIn : c.optedOut);
            }}
          >
            <PhoneOff /> {d.customer.optedOut ? c.actions.optIn : c.actions.optOut}
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={() => setRemoveOpen(true)}>
            <Trash2 /> {c.actions.remove}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {nameOpen ? <NameDialog customer={d.customer} onClose={() => setNameOpen(false)} /> : null}
      {removeOpen ? <RemoveDialog customer={d.customer} onClose={() => setRemoveOpen(false)} /> : null}

      <PaymentDialog open={payOpen} onOpenChange={setPayOpen} customerId={d.customer.id} suggested={d.nextPromise?.amount ?? d.balance} />
      <EntryDialog open={entryOpen} onOpenChange={setEntryOpen} customerId={d.customer.id} />
      <LanguageDialog open={languageOpen} onOpenChange={setLanguageOpen} current={d.customer.language} onSave={(language) => update.mutateAsync({ language })} />
      <PhoneDialog open={phoneOpen} onOpenChange={setPhoneOpen} current={d.customer.phone} onSave={(phone) => update.mutateAsync({ phone })} />
      <ScheduleDialog
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        pending={schedule.isPending}
        onSubmit={async (iso) => {
          if (await callAt(iso)) setScheduleOpen(false);
        }}
      />
      </div>
    </div>
  );
}

function PromiseRow({ p }: { p: PaymentPromise }) {
  const s = useT().customers.detail.promiseStatus;
  const overdue = isPromiseBroken(p, new Date()) && p.status === "open";
  const label = overdue ? s.overdue : s[p.status];
  const tone = overdue || p.status === "broken" ? "bg-overdue-soft text-overdue" : p.status === "kept" ? "bg-paid-soft text-paid" : "bg-promised-soft text-promised";
  return (
    <li className="flex items-center justify-between gap-3">
      <span className="flex flex-col">
        <Money amount={p.amount} className="font-semibold" />
        <span className="text-xs text-muted-foreground">by {format(parseISO(p.dueDate), "EEE d MMM")}</span>
      </span>
      <span className={cn("inline-flex h-6 items-center rounded-full px-2.5 text-xs font-semibold", tone)}>{label}</span>
    </li>
  );
}

function Disputes({ d }: { d: CustomerDetail }) {
  const c = useT().customers.detail;
  const resolve = useApiMutation(api.resolveDispute);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{c.sections.disputes}</CardTitle>
      </CardHeader>
      <CardContent>
        {d.disputes.length === 0 ? (
          <p className="text-sm text-muted-foreground">{c.noDisputes}</p>
        ) : (
          <ul className="space-y-3">
            {d.disputes.map((x) => (
              <li key={x.id} className={cn("space-y-2 rounded-lg border p-3", x.status === "open" && "border-disputed/40 bg-disputed-soft/40")}>
                <p className="text-sm">{x.reason}</p>
                <div className="flex items-center justify-between gap-2">
                  <TimeAgo iso={x.createdAt} className="text-xs text-muted-foreground" />
                  {x.status === "open" ? (
                    <Button size="sm" variant="outline" disabled={resolve.isPending} onClick={() => resolve.mutate(x.id)}>
                      {c.resolve}
                    </Button>
                  ) : (
                    <span className="text-xs font-medium text-paid">{c.resolved}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

type LedgerLine =
  | { id: string; date: string; kind: "entry"; amount: number; text: string; photo: boolean; items: string }
  | { id: string; date: string; kind: "payment"; amount: number; text: string; photo: false; method: "cash" | "upi" };

function Ledger({ d }: { d: CustomerDetail }) {
  const c = useT().customers.detail;
  const [editing, setEditing] = useState<LedgerLine | null>(null);
  const rows: LedgerLine[] = [
    ...d.entries.map((e) => ({ id: e.id, date: e.date, kind: "entry" as const, amount: e.amount, text: e.items, photo: e.source === "photo", items: e.items })),
    ...d.payments.map((p) => ({ id: p.id, date: p.date, kind: "payment" as const, amount: p.amount, text: p.method.toUpperCase(), photo: false as const, method: p.method })),
  ].sort((a, b) => b.date.localeCompare(a.date));
  return (
    <Card>
      <CardHeader>
        <CardTitle>{c.sections.ledger}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y rounded-lg border ledger-paper">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-2 pr-3 pl-14">
              <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground">{format(parseISO(r.date), "d MMM")}</span>
              <span className="min-w-0 flex-1 truncate text-sm">
                <span className="font-medium">{r.kind === "entry" ? c.entry : c.payment}</span> · {r.text}
                {r.photo ? <span className="ml-1.5 text-xs text-muted-foreground">({c.fromPhoto})</span> : null}
              </span>
              <Money amount={r.amount} className={cn("text-sm font-semibold", r.kind === "entry" ? "text-due" : "text-paid")} />
              <Button variant="ghost" size="icon" className="-mr-2 size-8 text-muted-foreground" aria-label={c.ledgerEdit.rowActions} onClick={() => setEditing(r)}>
                <Pencil className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
        {editing ? <LedgerEditDialog key={editing.id} line={editing} onClose={() => setEditing(null)} /> : null}
      </CardContent>
    </Card>
  );
}

/** Corrects or deletes one ledger line. Deleting needs a second tap. */
function LedgerEditDialog({ line, onClose }: { line: LedgerLine; onClose: () => void }) {
  const t = useT().customers.detail;
  const e = t.ledgerEdit;
  const [amount, setAmount] = useState(String(line.amount));
  const [items, setItems] = useState(line.kind === "entry" ? line.items : "");
  const [method, setMethod] = useState<"cash" | "upi">(line.kind === "payment" ? line.method : "cash");
  const [date, setDate] = useState(line.date);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const updateEntry = useApiMutation((p: { amount: number; items: string; date: string }) => api.updateEntry(line.id, p));
  const updatePayment = useApiMutation((p: { amount: number; method: "cash" | "upi"; date: string }) => api.updatePayment(line.id, p));
  const remove = useApiMutation(() => (line.kind === "entry" ? api.deleteEntry(line.id) : api.deletePayment(line.id)));
  const busy = updateEntry.isPending || updatePayment.isPending || remove.isPending;

  const save = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const value = Math.round(Number(amount));
    if (!Number.isFinite(value) || value <= 0 || !date || (line.kind === "entry" && !items.trim())) return setError(t.entryDialog.invalid);
    const done = line.kind === "entry" ? await attempt(updateEntry.mutateAsync({ amount: value, items: items.trim(), date })) : await attempt(updatePayment.mutateAsync({ amount: value, method, date }));
    if (!done) return;
    toast.success(e.saved);
    onClose();
  };

  const del = async () => {
    if (!confirming) return setConfirming(true);
    if (!(await attempt(remove.mutateAsync(undefined)))) return;
    toast.success(e.deleted);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={save} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{line.kind === "entry" ? e.entryTitle : e.paymentTitle}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="edit-amount">{t.entryDialog.amount}</Label>
              <Input id="edit-amount" inputMode="numeric" value={amount} onChange={(x) => { setAmount(x.target.value); setError(null); }} aria-invalid={!!error} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-date">{e.date}</Label>
              <DateInput id="edit-date" value={date} max={toDateKey(new Date())} onChange={(x) => setDate(x.target.value)} />
            </div>
          </div>
          {line.kind === "entry" ? (
            <div className="space-y-2">
              <Label htmlFor="edit-items">{t.entryDialog.items}</Label>
              <Input id="edit-items" value={items} onChange={(x) => { setItems(x.target.value); setError(null); }} />
            </div>
          ) : (
            <div className="space-y-2">
              <Label>{t.paymentDialog.method}</Label>
              <ToggleGroup type="single" variant="outline" value={method} onValueChange={(v) => v && setMethod(v as "cash" | "upi")}>
                <ToggleGroupItem value="cash">{t.paymentDialog.cash}</ToggleGroupItem>
                <ToggleGroupItem value="upi">{t.paymentDialog.upi}</ToggleGroupItem>
              </ToggleGroup>
            </div>
          )}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter className="gap-2 sm:justify-between">
            <Button type="button" variant={confirming ? "destructive" : "ghost"} disabled={busy} onClick={del} onBlur={() => setConfirming(false)}>
              {confirming ? e.confirmDelete : e.delete}
            </Button>
            <Button type="submit" size="lg" disabled={busy}>
              {e.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PaymentDialog({ open, onOpenChange, customerId, suggested }: { open: boolean; onOpenChange: (v: boolean) => void; customerId: string; suggested: number }) {
  const p = useT().customers.detail.paymentDialog;
  const [amount, setAmount] = useState(String(suggested));
  const [method, setMethod] = useState<"cash" | "upi">("cash");
  const [error, setError] = useState<string | null>(null);
  const pay = useApiMutation(api.recordPayment);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = Math.round(Number(amount));
    if (!Number.isFinite(value) || value <= 0) return setError(p.invalid);
    if (!(await attempt(pay.mutateAsync({ customerId, amount: value, method, date: toDateKey(new Date()) })))) return;
    toast.success(p.saved(formatINR(value)));
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{p.title}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="payment-amount">{p.amount}</Label>
            <Input id="payment-amount" inputMode="numeric" value={amount} onChange={(e) => { setAmount(e.target.value); setError(null); }} aria-invalid={!!error} />
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
          <div className="space-y-2">
            <Label>{p.method}</Label>
            <ToggleGroup type="single" variant="outline" value={method} onValueChange={(v) => v && setMethod(v as "cash" | "upi")}>
              <ToggleGroupItem value="cash">{p.cash}</ToggleGroupItem>
              <ToggleGroupItem value="upi">{p.upi}</ToggleGroupItem>
            </ToggleGroup>
          </div>
          <DialogFooter>
            <Button type="submit" size="lg" disabled={pay.isPending}>
              {p.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EntryDialog({ open, onOpenChange, customerId }: { open: boolean; onOpenChange: (v: boolean) => void; customerId: string }) {
  const e = useT().customers.detail.entryDialog;
  const [amount, setAmount] = useState("");
  const [items, setItems] = useState("");
  const [error, setError] = useState<string | null>(null);
  const add = useApiMutation(api.addEntry);

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const value = Math.round(Number(amount));
    if (!Number.isFinite(value) || value <= 0 || !items.trim()) return setError(e.invalid);
    if (!(await attempt(add.mutateAsync({ customerId, amount: value, items: items.trim(), date: toDateKey(new Date()), source: "manual" })))) return;
    toast.success(e.saved(formatINR(value)));
    setAmount("");
    setItems("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{e.title}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="entry-amount">{e.amount}</Label>
            <Input id="entry-amount" inputMode="numeric" value={amount} onChange={(x) => { setAmount(x.target.value); setError(null); }} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="entry-items">{e.items}</Label>
            <Input id="entry-items" value={items} placeholder={e.itemsPlaceholder} onChange={(x) => { setItems(x.target.value); setError(null); }} />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="submit" size="lg" disabled={add.isPending}>
              {e.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The language Asha calls this customer in, and WhatsApp reminders go in. Saved as soon as one is picked. */
function LanguageDialog({ open, onOpenChange, current, onSave }: { open: boolean; onOpenChange: (v: boolean) => void; current: Language; onSave: (language: Language) => Promise<unknown> }) {
  const t = useT();
  const l = t.customers.detail.languageDialog;
  const choose = async (language: Language) => {
    if (language === current) return onOpenChange(false);
    if (!(await attempt(onSave(language)))) return;
    toast.success(l.saved);
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{l.title}</DialogTitle>
          <DialogDescription>{l.description}</DialogDescription>
        </DialogHeader>
        <ToggleGroup type="single" variant="outline" className="flex-wrap" value={current} onValueChange={(v) => v && void choose(v as Language)}>
          {LANGUAGES.map((x) => (
            <ToggleGroupItem key={x} value={x}>
              {t.common.language[x]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </DialogContent>
    </Dialog>
  );
}

function PhoneDialog({ open, onOpenChange, current, onSave }: { open: boolean; onOpenChange: (v: boolean) => void; current: string; onSave: (phone: string) => Promise<unknown> }) {
  const p = useT().customers.detail.phoneDialog;
  const [value, setValue] = useState(current.replace(/^\+91/, ""));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const phone = normalizeIndianMobile(value);
    if (!phone) return setError(p.invalid);
    setSaving(true);
    const saved = await attempt(onSave(phone));
    setSaving(false);
    if (!saved) return;
    toast.success(p.saved);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{p.title}</DialogTitle>
            <DialogDescription>{p.description}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="customer-phone">{p.label}</Label>
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm text-muted-foreground">+91</span>
              <Input id="customer-phone" inputMode="tel" autoComplete="off" value={value} onChange={(e) => { setValue(e.target.value); setError(null); }} aria-invalid={!!error} />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button type="submit" size="lg" disabled={saving}>
              {p.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function NameDialog({ customer, onClose }: { customer: CustomerDetail["customer"]; onClose: () => void }) {
  const n = useT().customers.detail.nameDialog;
  const [name, setName] = useState(customer.name);
  const [nameNative, setNameNative] = useState(customer.nameNative ?? "");
  const [error, setError] = useState<string | null>(null);
  const update = useApiMutation((patch: { name: string; nameNative: string }) => api.updateCustomer(customer.id, patch));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError(n.invalid);
    if (!(await attempt(update.mutateAsync({ name, nameNative })))) return;
    toast.success(n.saved);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{n.title}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="edit-name">{n.name}</Label>
            <Input id="edit-name" value={name} onChange={(e) => { setName(e.target.value); setError(null); }} aria-invalid={!!error} />
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-name-native">{n.nameNative}</Label>
            <Input id="edit-name-native" value={nameNative} onChange={(e) => setNameNative(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="submit" size="lg" disabled={update.isPending}>
              {n.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Removing archives the customer: out of lists and calls, history kept. Asks before doing it. */
function RemoveDialog({ customer, onClose }: { customer: CustomerDetail["customer"]; onClose: () => void }) {
  const t = useT();
  const c = t.customers.detail;
  const router = useRouter();
  const remove = useApiMutation(() => api.archiveCustomer(customer.id));

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {c.actions.remove}: {customer.name}
          </DialogTitle>
          <DialogDescription>{c.actions.removeConfirm}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t.common.actions.cancel}
          </Button>
          <Button
            variant="destructive"
            disabled={remove.isPending}
            onClick={async () => {
              if (!(await attempt(remove.mutateAsync(undefined)))) return;
              toast.success(c.removed(customer.name));
              router.replace("/app/customers");
            }}
          >
            {c.actions.remove}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The UPI QR code as a PNG file, made ahead so sharing starts straight from the tap. */
function useQrFile(link: string): File | null {
  const [file, setFile] = useState<{ link: string; file: File } | null>(null);
  useEffect(() => {
    if (!link) return;
    let cancelled = false;
    QRCode.toDataURL(link, { width: 512, margin: 2, errorCorrectionLevel: "M" })
      .then((url) => fetch(url))
      .then((r) => r.blob())
      .then((blob) => {
        if (!cancelled) setFile({ link, file: new File([blob], "upi-qr.png", { type: "image/png" }) });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [link]);
  return file?.link === link ? file.file : null;
}
