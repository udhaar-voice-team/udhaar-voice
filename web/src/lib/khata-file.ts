import type { KhataColumns, KhataLineInput } from "@/lib/api/contract";

/**
 * Turns a spreadsheet (CSV or Excel rows) into khata lines. Which column holds what comes from an
 * AI model reading the first rows (`readKhataColumns`), so any column names work; when no model
 * answers, columns are found by common names in English and Indian languages, and without a
 * header row the order is name, amount, items, date, phone.
 */

type Field = "name" | "amount" | "paid" | "items" | "date" | "phone";

/** Common column names, compared as lowercase words without punctuation. */
const HEADERS: Record<Field, string[]> = {
  name: ["name", "customer", "customer name", "party", "party name", "grahak", "naam", "नाम", "ग्राहक", "नाव", "নাম", "খদ্দের", "গ্রাহক", "ନାମ", "ଗ୍ରାହକ"],
  amount: [
    "amount", "amt", "rupees", "rs", "₹", "inr", "due", "dues", "credit", "balance", "bal", "total", "outstanding", "pending", "baki", "baaki",
    "udhaar", "udhar", "bakaya", "बाकी", "रकम", "उधार", "बकाया", "थकबाकी", "उधारी", "टाका", "টাকা", "বাকি", "বকেয়া", "ধার", "ବାକି", "ଉଧାର", "ଟଙ୍କା",
  ],
  paid: ["paid", "jama", "received", "payment", "payments", "जमा", "भुगतान", "जमा रक्कम", "জমা", "ଜମା"],
  items: ["item", "items", "detail", "details", "goods", "product", "products", "particulars", "description", "saman", "सामान", "माल", "विवरण", "वस्तू", "জিনিস", "মাল", "ଜିନିଷ", "ବିବରଣୀ"],
  date: ["date", "day", "dt", "tarikh", "तारीख", "दिनांक", "তারিখ", "ତାରିଖ"],
  phone: ["phone", "mobile", "mob", "number", "phone number", "mobile number", "contact", "फ़ोन", "फोन", "मोबाइल", "ফোন", "মোবাইল", "ଫୋନ", "ମୋବାଇଲ"],
};

const DEFAULT_ORDER: Field[] = ["name", "amount", "items", "date", "phone"];

const words = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{M}\p{N}₹]+/gu, " ").trim();

/** The field a header names: the whole header, or one of its words ("Balance (Rs)" is amount). */
function fieldOf(header: string): Field | undefined {
  const h = words(header);
  if (!h) return undefined;
  const fields = Object.keys(HEADERS) as Field[];
  return fields.find((f) => HEADERS[f].includes(h)) ?? fields.find((f) => HEADERS[f].some((name) => ` ${h} `.includes(` ${name} `)));
}

/** Parses CSV text: quoted fields, commas and new lines inside quotes, and "" for a quote. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * A cell as a YYYY-MM-DD date: Excel dates, 2026-10-28, or 28/10/2026, 28-10-26 and 28/10 (this
 * year) read in `order` (day first unless the sheet writes the month first).
 */
export function toDate(cell: unknown, today: string, order: KhataColumns["dateOrder"] = "dmy"): string | undefined {
  if (cell instanceof Date && !Number.isNaN(cell.getTime())) return `${cell.getFullYear()}-${pad(cell.getMonth() + 1)}-${pad(cell.getDate())}`;
  const s = String(cell ?? "").trim();
  if (!s) return undefined;
  let m = /^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/.exec(s);
  if (m) {
    const year = m[3] ? (m[3].length === 2 ? `20${m[3]}` : m[3]) : today.slice(0, 4);
    const [day, month] = order === "mdy" ? [+m[2], +m[1]] : [+m[1], +m[2]];
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return `${year}-${pad(month)}-${pad(day)}`;
  }
  return undefined;
}

const toAmount = (cell: unknown) => {
  const n = typeof cell === "number" ? cell : Number(String(cell ?? "").replace(/[₹,\s/-]+$/g, "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
};

export type FileResult = { lines: KhataLineInput[]; skipped: number };

/**
 * Rows as khata lines, using `columns` when a model worked them out, else the header names. Rows
 * without a name or a positive amount (after subtracting a paid column) are skipped.
 */
export function rowsToLines(rows: unknown[][], today: string, columns?: KhataColumns): FileResult {
  if (rows.length === 0) return { lines: [], skipped: 0 };
  const map = columns ?? columnsFromHeaders(rows[0]);
  const lines: KhataLineInput[] = [];
  let skipped = 0;
  for (const row of rows.slice(map.headerRows)) {
    const cell = (i: number) => (i >= 0 ? row[i] : undefined);
    const name = String(cell(map.name) ?? "").trim();
    const owed = toAmount(cell(map.amount)) ?? 0;
    const amount = owed - (map.paid >= 0 ? (toAmount(cell(map.paid)) ?? 0) : 0);
    if (!name || amount <= 0) {
      skipped++;
      continue;
    }
    const phone = String(cell(map.phone) ?? "").trim();
    const nameNative = String(cell(map.nameNative) ?? "").trim();
    lines.push({
      name,
      ...(nameNative ? { nameNative } : {}),
      amount,
      items: String(cell(map.items) ?? "").trim(),
      date: toDate(cell(map.date), today, map.dateOrder) ?? today,
      phone: phone || undefined,
    });
  }
  return { lines, skipped };
}

/** Columns by their header names; without a name and an amount header, the default order and no header row. */
export function columnsFromHeaders(header: unknown[]): KhataColumns {
  const found = new Map<Field, number>();
  header.forEach((h, i) => {
    const field = fieldOf(String(h ?? ""));
    if (field && !found.has(field)) found.set(field, i);
  });
  if (!found.has("name") || !found.has("amount")) {
    found.clear();
    DEFAULT_ORDER.forEach((f, i) => found.set(f, i));
    return { headerRows: 0, nameNative: -1, paid: -1, dateOrder: "dmy", ...toColumns(found) };
  }
  return { headerRows: 1, nameNative: -1, dateOrder: "dmy", ...toColumns(found), paid: found.get("paid") ?? -1 };
}

const toColumns = (found: Map<Field, number>) => ({
  name: found.get("name") ?? -1,
  amount: found.get("amount") ?? -1,
  items: found.get("items") ?? -1,
  date: found.get("date") ?? -1,
  phone: found.get("phone") ?? -1,
});

/** Cells as short text, to show a model the first rows. */
export const sampleRows = (rows: unknown[][]): string[][] =>
  rows.slice(0, 8).map((r) => r.slice(0, 12).map((c) => (c instanceof Date ? c.toISOString().slice(0, 10) : String(c ?? "").trim().slice(0, 40))));
