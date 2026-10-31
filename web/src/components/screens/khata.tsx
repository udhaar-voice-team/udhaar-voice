"use client";

import { formatDistanceToNowStrict, parseISO } from "date-fns";
import { Camera, CheckCircle2, FileImage, FileSpreadsheet, ImageUp, Keyboard, PhoneCall, RotateCcw, Undo2 } from "lucide-react";
import { readSheet } from "read-excel-file/browser";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AiProgress } from "@/components/app/ai-progress";
import { Money, PageHeader } from "@/components/app/bits";
import { SampleKhataPage } from "@/components/app/sample-khata";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { shrinkPhoto } from "@/lib/image";
import type { AiProvider, KhataExtraction, KhataLineInput, KhataRow, KhataRowAction, KhataSaveResult, KhataSource } from "@/lib/api/contract";
import { untilAnswered } from "@/lib/api/steps";
import { useLeaveWarning } from "@/hooks/use-leave-warning";
import { parseCsv, rowsToLines, sampleRows } from "@/lib/khata-file";
import { CameraDialog } from "@/components/app/camera-dialog";
import { ManualEntryDialog } from "@/components/app/manual-entry-dialog";
import { attempt, useApiMutation, useCustomers, useKhataImports } from "@/lib/api/hooks";
import { formatINR, normalizeIndianMobile, toDateKey } from "@/lib/domain/rules";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type Stage =
  | { kind: "start" }
  | { kind: "reading"; source: KhataSource; imageUrl?: string; since: number; backup: boolean }
  | { kind: "review"; source: KhataSource; imageUrl?: string; scan: KhataExtraction }
  | ({ kind: "saved"; withoutPhone: number } & KhataSaveResult);

const LOW = 0.8;

/**
 * A photo being read, kept in this tab so a reload carries on with the same photo (the server
 * keeps it under `scanId`) instead of starting over. Forgotten after 10 minutes.
 */
type Pending = { scanId: string; since: number; provider?: AiProvider };
const PENDING_KEY = "udhaar-khata-reading";
const PENDING_MAX_MS = 10 * 60_000;

function remember(pending: Pending | null) {
  try {
    if (pending) sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
    else sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // Blocked storage: a reload starts over.
  }
}

function recall(): Pending | null {
  try {
    const pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? "null") as Pending | null;
    return pending && Date.now() - pending.since < PENDING_MAX_MS ? pending : null;
  } catch {
    return null;
  }
}

export function KhataScreen() {
  const { khata: t, common } = useT();
  const [stage, setStage] = useState<Stage>({ kind: "start" });
  const cameraInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const sheetInput = useRef<HTMLInputElement>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  // Read when the shopkeeper starts typing entries: the clock can't be read during prerender.
  const [today, setToday] = useState("");
  const imageUrl = stage.kind === "reading" || stage.kind === "review" ? stage.imageUrl : undefined;

  // Free the photo preview when it is no longer shown.
  useEffect(() => () => { if (imageUrl) URL.revokeObjectURL(imageUrl); }, [imageUrl]);

  // Each read gets a number; Cancel moves it on, so a cancelled read's answer is dropped when it arrives.
  const run = useRef(0);
  useLeaveWarning(stage.kind === "reading");

  const read = async (source: KhataSource, file?: File, lines?: KhataLineInput[], resume?: Pending) => {
    const id = ++run.current;
    const url = file ? URL.createObjectURL(file) : undefined;
    const since = resume?.since ?? Date.now();
    const scanId = source === "upload" ? (resume?.scanId ?? crypto.randomUUID()) : undefined;
    // Typed lines and spreadsheet rows need no model here, so they go straight to the review.
    if (source === "upload" || source === "sample") setStage({ kind: "reading", source, imageUrl: url, since, backup: !!resume?.provider });
    try {
      // A resumed read sends no photo: the server reads the one it kept.
      const photo = file ? await shrinkPhoto(file).catch(() => file) : undefined;
      if (scanId) remember({ scanId, since, provider: resume?.provider });
      const scan = await untilAnswered(
        (provider) => api.extractKhata({ source, photo, scanId, lines, provider }),
        (provider) => {
          if (scanId) remember({ scanId, since, provider });
          if (run.current === id) setStage((s) => (s.kind === "reading" ? { ...s, backup: true } : s));
        },
        resume?.provider,
      );
      if (run.current !== id) return;
      remember(null);
      setStage({ kind: "review", source, imageUrl: url, scan });
    } catch (err) {
      // A reload cancels the request too, before the page goes. Waiting a moment means a page that is
      // going never gets here, so the read stays remembered for the reloaded one.
      await new Promise((resolve) => window.setTimeout(resolve, 1000));
      if (run.current !== id) return;
      remember(null);
      toast.error(err instanceof Error ? err.message : String(err));
      setStage({ kind: "start" });
    }
  };

  const cancel = () => {
    run.current++;
    remember(null);
    setStage({ kind: "start" });
  };

  // After a reload in the middle of reading a photo, carry on with it.
  useEffect(() => {
    const pending = recall();
    if (!pending) return;
    const id = window.setTimeout(() => void read("upload", undefined, undefined, pending), 0);
    return () => window.clearTimeout(id);
    // Once, on opening the screen.
  }, []);

  // Phones open their camera from the file picker; laptops and tablets get the camera in a dialog.
  const takePhoto = () => {
    if (window.matchMedia("(pointer: coarse)").matches) cameraInput.current?.click();
    else setCameraOpen(true);
  };

  /**
   * A model works out which column is which from the first rows, whatever the shopkeeper named
   * them; the rows are then turned into lines here. Without a model, the column names decide.
   */
  const importSheet = async (file: File) => {
    let rows: unknown[][];
    try {
      rows = /\.csv$/i.test(file.name) || file.type === "text/csv" ? parseCsv(await file.text()) : await readSheet(file);
    } catch {
      return void toast.error(t.start.fileError);
    }
    if (rows.length === 0) return void toast.error(t.start.fileEmpty);
    const id = ++run.current;
    setStage({ kind: "reading", source: "file", since: Date.now(), backup: false });
    const columns = await untilAnswered(
      (provider) => api.readKhataColumns({ rows: sampleRows(rows), provider }),
      () => {
        if (run.current === id) setStage((s) => (s.kind === "reading" ? { ...s, backup: true } : s));
      },
    ).catch(() => undefined);
    if (run.current !== id) return;
    const today = toDateKey(new Date());
    let result = rowsToLines(rows, today, columns);
    if (result.lines.length === 0 && columns) result = rowsToLines(rows, today);
    if (result.lines.length === 0) {
      setStage({ kind: "start" });
      return void toast.error(t.start.fileEmpty);
    }
    if (result.skipped) toast.message(t.start.fileSkipped(result.skipped));
    void read("file", undefined, result.lines);
  };

  const onPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void read("upload", file);
    e.target.value = "";
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t.title} description={t.description} />
      <CameraDialog open={cameraOpen} onOpenChange={setCameraOpen} onPhoto={(file) => void read("upload", file)} />
      {today ? <ManualEntryDialog open={manualOpen} onOpenChange={setManualOpen} today={today} onLines={(lines) => void read("manual", undefined, lines)} /> : null}

      {stage.kind === "start" ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardContent className="space-y-5">
              <div className="grid gap-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Button size="lg" className="h-14 text-base" onClick={takePhoto}>
                    <Camera className="size-5" /> {t.start.takePhoto}
                  </Button>
                  <Button size="lg" variant="outline" className="h-14 text-base" onClick={() => photoInput.current?.click()}>
                    <ImageUp className="size-5" /> {t.start.uploadPhoto}
                  </Button>
                  <Button size="lg" variant="outline" className="h-14 text-base" onClick={() => {
                    setToday(toDateKey(new Date()));
                    setManualOpen(true);
                  }}>
                    <Keyboard className="size-5" /> {t.start.typeEntries}
                  </Button>
                  <Button size="lg" variant="outline" className="h-14 text-base" onClick={() => sheetInput.current?.click()}>
                    <FileSpreadsheet className="size-5" /> {t.start.importFile}
                  </Button>
                </div>
                <input ref={cameraInput} id="khata-camera" type="file" accept="image/*" capture="environment" className="sr-only" onChange={onPhoto} />
                <input ref={photoInput} id="khata-photo" type="file" accept="image/*" className="sr-only" onChange={onPhoto} />
                <input
                  ref={sheetInput}
                  id="khata-sheet"
                  type="file"
                  accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void importSheet(file);
                    e.target.value = "";
                  }}
                />
                <p className="text-xs text-muted-foreground">{t.start.fileHint}</p>
                <Button size="lg" variant="ghost" className="h-12 text-base" onClick={() => void read("sample")}>
                  <FileImage className="size-5" /> {t.start.sample}
                </Button>
              </div>
              <ul className="space-y-1.5 text-sm text-muted-foreground">
                {t.start.tips.map((tip) => (
                  <li key={tip} className="flex gap-2">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" /> {tip}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <RecentImports />
          <figure className="space-y-2 lg:col-start-2 lg:row-span-2 lg:row-start-1">
            <SampleKhataPage />
            <figcaption className="text-center text-xs text-muted-foreground">{t.sampleCaption}</figcaption>
          </figure>
        </div>
      ) : null}

      {stage.kind === "reading" && stage.source === "file" ? (
        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle className="text-lg">
              <AiProgress label={t.reading.columns} since={stage.since} backup={stage.backup} slowAfter={15} />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={cancel}>
              {common.actions.cancel}
            </Button>
          </CardContent>
        </Card>
      ) : stage.kind === "reading" ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <PagePreview imageUrl={stage.imageUrl} sample={stage.source === "sample"} scanning />
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                <AiProgress label={t.reading.title} since={stage.since} backup={stage.backup} slowAfter={30} usual={stage.source === "upload"} />
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <ol className="space-y-3">
                {t.reading.steps.map((s, i) => (
                  <li key={s} className="flex items-center gap-3 text-sm animate-in fade-in-0 fill-mode-both" style={{ animationDelay: `${i * 600}ms` }}>
                    <span className="grid size-6 place-items-center rounded-full bg-accent font-mono text-xs">{i + 1}</span> {s}
                  </li>
                ))}
              </ol>
              <Button variant="outline" onClick={cancel}>
                {common.actions.cancel}
              </Button>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {stage.kind === "review" ? (
        <Review
          scan={stage.scan}
          imageUrl={stage.imageUrl}
          onCancel={() => setStage({ kind: "start" })}
          onSaved={(r) => setStage({ kind: "saved", ...r })}
        />
      ) : null}

      {stage.kind === "saved" ? (
        <Card className="mx-auto max-w-lg text-center">
          <CardContent className="flex flex-col items-center gap-4 py-6">
            <CheckCircle2 className="size-12 text-paid" />
            <div className="space-y-1">
              <h2 className="text-xl font-bold">{t.saved.title}</h2>
              <p className="text-muted-foreground">{t.saved.body(stage.added, stage.updated, stage.newCustomers)}</p>
              {stage.withoutPhone ? <p className="text-sm text-promised">{t.saved.noPhone}</p> : null}
            </div>
            <UndoImport importId={stage.importId} onUndone={() => setStage({ kind: "start" })} />
            <div className="flex flex-wrap justify-center gap-2">
              <Button size="lg" variant="outline" onClick={() => setStage({ kind: "start" })}>
                <RotateCcw /> {t.saved.another}
              </Button>
              <Button asChild size="lg">
                <Link href="/app/calls?new=1">
                  <PhoneCall /> {t.saved.remind}
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

/** The page being read: the shopkeeper's photo, the sample page, or (after a reload, when the photo is only on the server) a placeholder. */
function PagePreview({ imageUrl, sample = false, scanning = false }: { imageUrl?: string; sample?: boolean; scanning?: boolean }) {
  if (sample) return <SampleKhataPage scanning={scanning} />;
  if (!imageUrl) {
    return (
      <div className="relative grid min-h-64 place-items-center overflow-hidden rounded-lg border bg-muted/40">
        <FileImage className="size-12 text-muted-foreground" aria-hidden />
        {scanning ? <div className="pointer-events-none absolute inset-x-0 top-0 h-16 animate-[scan_1.6s_ease-in-out_infinite] bg-gradient-to-b from-transparent via-primary/25 to-transparent" /> : null}
      </div>
    );
  }
  return (
    <div className="relative overflow-hidden rounded-lg border">
      {/* A local object URL from the user's own photo; next/image can't optimise it. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={imageUrl} alt="Your khata photo" className="max-h-[32rem] w-full object-contain" />
      {scanning ? <div className="pointer-events-none absolute inset-x-0 top-0 h-16 animate-[scan_1.6s_ease-in-out_infinite] bg-gradient-to-b from-transparent via-primary/25 to-transparent" /> : null}
    </div>
  );
}

function Review({
  scan,
  imageUrl,
  onCancel,
  onSaved,
}: {
  scan: KhataExtraction;
  imageUrl?: string;
  onCancel: () => void;
  onSaved: (r: KhataSaveResult & { withoutPhone: number }) => void;
}) {
  const t = useT().khata.review;
  // Typed and spreadsheet lines have no page to show beside them, nor does a photo read after a reload.
  const typed = scan.source === "manual" || scan.source === "file" || (scan.source === "upload" && !imageUrl);
  const customers = useCustomers();
  const save = useApiMutation(api.saveKhata);
  const [rows, setRows] = useState<KhataRow[]>(scan.rows);
  const [phoneErrors, setPhoneErrors] = useState<Record<string, boolean>>({});

  const nameOf = (id?: string) => customers.data?.find((s) => s.customer.id === id)?.customer.name;
  const update = (id: string, patch: Partial<KhataRow>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const included = rows.filter((r) => r.action !== "skip");
  const added = included.filter((r) => r.action === "add");
  const fresh = added.filter((r) => !r.matchCustomerId);
  const total = included.reduce((s, r) => s + r.amount.value, 0);

  const submit = async () => {
    const errors: Record<string, boolean> = {};
    for (const r of fresh) if (r.phone && !normalizeIndianMobile(r.phone)) errors[r.id] = true;
    setPhoneErrors(errors);
    if (Object.keys(errors).length) return toast.error(t.invalidPhone);
    const saved = await attempt(save.mutateAsync({ scanId: scan.scanId, source: scan.source, rows, model: scan.model }));
    if (!saved) return;
    onSaved({ ...saved.value, withoutPhone: fresh.filter((r) => !r.phone).length });
  };

  return (
    <div className={cn("grid gap-6", typed ? "" : "xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]")}>
      {typed ? null : <PagePreview imageUrl={imageUrl} sample={scan.source === "sample"} />}
      <Card>
        <CardHeader>
          <CardTitle>{t.title}</CardTitle>
          <CardDescription>{t.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="space-y-3">
            {rows.map((r) => (
              <li key={r.id} className={cn("space-y-3 rounded-lg border p-3", r.action === "skip" && "opacity-60")}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    {r.saved ? null : (
                      <Checkbox id={`include-${r.id}`} checked={r.action === "add"} onCheckedChange={(v) => update(r.id, { action: v === true ? "add" : "skip" })} />
                    )}
                    {r.nameNative ? <span lang="bn">{r.nameNative}</span> : null}
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    {r.matchCustomerId ? (
                      <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => update(r.id, { matchCustomerId: undefined, saved: undefined, action: "add", phone: "" })}>
                        {t.notThem}
                      </Button>
                    ) : null}
                    <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", r.matchCustomerId ? "bg-paid-soft text-paid" : "bg-callback-soft text-callback")}>
                      {r.matchCustomerId ? t.matches(nameOf(r.matchCustomerId) ?? r.name.value) : t.newCustomer}
                    </span>
                  </div>
                </div>
                {r.saved ? <SavedChoice row={r} onChange={(action) => update(r.id, { action })} /> : null}
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1.4fr_0.8fr_1fr]">
                  <Field label={t.columns.name} confidence={r.name.confidence} className="col-span-2 sm:col-span-1">
                    <Input id={`name-${r.id}`} value={r.name.value} disabled={!!r.matchCustomerId} onChange={(e) => update(r.id, { name: { value: e.target.value, confidence: 1 } })} />
                  </Field>
                  <Field label={t.columns.amount} confidence={r.amount.confidence} struck={r.amount.struck}>
                    <Input
                      id={`amount-${r.id}`}
                      inputMode="numeric"
                      value={String(r.amount.value)}
                      onChange={(e) => update(r.id, { amount: { value: Math.max(0, Math.round(Number(e.target.value) || 0)), confidence: 1 } })}
                    />
                  </Field>
                  <Field label={t.columns.date} confidence={r.date.confidence}>
                    <DateInput id={`date-${r.id}`} value={r.date.value} onChange={(e) => update(r.id, { date: { value: e.target.value, confidence: 1 } })} />
                  </Field>
                  <Field label={t.columns.items} confidence={r.items.confidence} className="col-span-2 sm:col-span-3">
                    <Input id={`items-${r.id}`} value={r.items.value} onChange={(e) => update(r.id, { items: { value: e.target.value, confidence: 1 } })} />
                  </Field>
                  {!r.matchCustomerId && r.action === "add" ? (
                    <div className="col-span-2 space-y-1 sm:col-span-3">
                      <Input
                        id={`phone-${r.id}`}
                        inputMode="tel"
                        placeholder={t.phonePlaceholder}
                        value={r.phone ?? ""}
                        aria-invalid={phoneErrors[r.id] || undefined}
                        onChange={(e) => update(r.id, { phone: e.target.value })}
                      />
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-medium">{t.summary(added.length, included.length - added.length, formatINR(total), fresh.length)}</p>
            <div className="flex gap-2">
              <Button variant="ghost" size="lg" onClick={onCancel}>
                {t.startOver}
              </Button>
              <Button size="lg" onClick={submit} disabled={included.length === 0 || save.isPending}>
                {t.save} · <Money amount={total} />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/** For a row that repeats or changes a saved entry: what saving should do with it. */
function SavedChoice({ row, onChange }: { row: KhataRow; onChange: (action: KhataRowAction) => void }) {
  const t = useT().khata.review;
  const saved = row.saved!;
  const options: KhataRowAction[] = saved.kind === "changed" ? ["update", "add", "skip"] : ["skip", "add"];
  return (
    <div className="flex flex-col gap-2 rounded-md bg-muted/50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-xs font-medium">
        {saved.kind === "changed" ? t.savedChanged(formatINR(saved.amount), formatINR(row.amount.value)) : t.savedDuplicate}
      </p>
      <ToggleGroup type="single" variant="outline" size="sm" value={row.action} onValueChange={(v) => v && onChange(v as KhataRowAction)}>
        {options.map((a) => (
          <ToggleGroupItem key={a} value={a} id={`action-${row.id}-${a}`}>
            {a === "add" ? (saved.kind === "changed" ? t.actions.addNew : t.actions.addAgain) : t.actions[a]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

function UndoImport({ importId, onUndone, compact = false }: { importId: string; onUndone?: () => void; compact?: boolean }) {
  const t = useT().khata.undo;
  const undo = useApiMutation(api.undoKhataImport);
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <Button variant={compact ? "ghost" : "outline"} size={compact ? "sm" : "lg"} onClick={() => setConfirming(true)}>
        <Undo2 /> {compact ? t.short : t.button}
      </Button>
    );
  }
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm sm:flex-row">
      <span>{t.confirm}</span>
      <div className="flex gap-2">
        <Button
          variant="destructive"
          size="sm"
          disabled={undo.isPending}
          onClick={async () => {
            const undone = await attempt(undo.mutateAsync(importId));
            if (!undone) return;
            toast.success(t.done(undone.value.removed, undone.value.restored));
            setConfirming(false);
            onUndone?.();
          }}
        >
          {t.yes}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
          {t.no}
        </Button>
      </div>
    </div>
  );
}

function RecentImports() {
  const t = useT().khata.recent;
  const q = useKhataImports();
  if (!q.data?.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t.title}</CardTitle>
        <CardDescription>{t.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {q.data.map((i) => (
            <li key={i.import.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="text-sm">
                <span className="font-medium">{formatDistanceToNowStrict(parseISO(i.import.createdAt), { addSuffix: true })}</span>
                <span className="block text-xs text-muted-foreground">{t.item(i.added, i.updated, formatINR(i.amount))}</span>
              </span>
              <UndoImport importId={i.import.id} compact />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  confidence,
  struck,
  className,
  children,
}: {
  label: string;
  confidence: number;
  /** A crossed-out amount on the page; always worth a second look. */
  struck?: number;
  className?: string;
  children: React.ReactNode;
}) {
  const t = useT().khata.review;
  const low = confidence < LOW || struck !== undefined;
  const box = (
    <div className={cn("space-y-1", className)}>
      <span className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
        {label}
        {low ? <span className="size-1.5 rounded-full bg-promised" aria-hidden /> : null}
      </span>
      <div className={cn(low && "rounded-md ring-2 ring-promised/70")}>{children}</div>
      {struck !== undefined ? (
        <span className="block text-[11px] text-promised">
          <s>{formatINR(struck)}</s> {t.struckShort}
        </span>
      ) : null}
    </div>
  );
  if (!low) return box;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{box}</TooltipTrigger>
      <TooltipContent>{struck !== undefined ? t.struck(formatINR(struck)) : t.lowConfidence(Math.round(confidence * 100))}</TooltipContent>
    </Tooltip>
  );
}
