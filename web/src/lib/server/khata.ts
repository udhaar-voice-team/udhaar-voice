import { addDays } from "date-fns";
import { matchSavedEntry, toDateKey } from "@/lib/domain/rules";
import type { KhataExtraction, KhataLineInput, KhataRow } from "@/lib/api/contract";
import { SAMPLE_KHATA } from "@/lib/demo/khata-sample";
import type { ShopData } from "./data";
import type { ReadLine } from "./ai";
import { findKhataCustomer } from "./queries";

/** Rows read from a khata page, matched against the shop's customers and saved entries. */

/** One line as read, before matching. */
export type Line = {
  name: string;
  nameNative: string;
  amount: number;
  struckAmount?: number;
  date: string;
  items: string;
  confidence: { name: number; amount: number; date: number; items: number };
  /** For new customers, when the line came with a number (typed or spreadsheet). */
  phone?: string;
};

export function toRows(db: ShopData, lines: Line[]): KhataRow[] {
  return lines.map((line, i): KhataRow => {
    const match = findKhataCustomer(db, line);
    const saved = match
      ? matchSavedEntry(
          { date: line.date, amount: line.amount, items: line.items, struckAmount: line.struckAmount },
          db.entries.filter((e) => e.customerId === match.id),
        )
      : undefined;
    return {
      id: `row${i + 1}`,
      name: { value: line.name, confidence: line.confidence.name },
      nameNative: line.nameNative || undefined,
      amount: { value: line.amount, confidence: line.confidence.amount, struck: line.struckAmount },
      date: { value: line.date, confidence: line.confidence.date },
      items: { value: line.items, confidence: line.confidence.items },
      matchCustomerId: match?.id,
      phone: match ? undefined : (line.phone ?? ""),
      language: match?.language ?? db.shop.defaultCustomerLanguage,
      saved: saved && { kind: saved.kind, entryId: saved.entry.id, amount: saved.entry.amount, items: saved.entry.items },
      action: saved?.kind === "duplicate" ? "skip" : saved ? "update" : "add",
    };
  });
}

/** The drawn sample page on the khata screen, as a vision model reads it. */
export function readSamplePage(db: ShopData, now: Date): KhataExtraction {
  const lines = SAMPLE_KHATA.map((l) => ({ ...l, date: toDateKey(addDays(now, -l.daysAgo)) }));
  return { scanId: crypto.randomUUID(), source: "sample", rows: toRows(db, lines) };
}

/** A photo's lines as Gemini read them. A line without a date gets today's, marked unsure. */
export function fromReadLines(lines: ReadLine[], now: Date): Line[] {
  const today = toDateKey(now);
  return lines.map((r) => {
    const date = r.date && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && r.date <= today ? r.date : today;
    return {
      name: r.name.trim(),
      nameNative: r.name_native?.trim() ?? "",
      amount: Math.round(r.amount),
      struckAmount: r.struck_amount && r.struck_amount !== r.amount ? Math.round(r.struck_amount) : undefined,
      date,
      items: r.items?.trim() ?? "",
      confidence: { ...r.confidence, date: date === r.date ? r.confidence.date : Math.min(r.confidence.date, 0.4) },
    };
  });
}

/** Typed or spreadsheet lines: what was given is certain, so every field is fully confident. */
export function fromInputLines(lines: KhataLineInput[], now: Date): Line[] {
  const today = toDateKey(now);
  return lines
    .map((l) => ({
      name: String(l.name ?? "").trim(),
      nameNative: String(l.nameNative ?? "").trim(),
      amount: Math.round(Number(l.amount)),
      date: /^\d{4}-\d{2}-\d{2}$/.test(l.date ?? "") && l.date <= today ? l.date : today,
      items: String(l.items ?? "").trim(),
      phone: l.phone?.trim() || undefined,
      confidence: { name: 1, amount: 1, date: 1, items: 1 },
    }))
    .filter((l) => l.name && Number.isFinite(l.amount) && l.amount > 0);
}

/** Where a photo is kept: its shop's folder in the private khata-photos bucket. */
export const photoPath = (shopId: string, scanId: string) => `${shopId}/${scanId}.jpg`;
