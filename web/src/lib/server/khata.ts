import { addDays } from "date-fns";
import { matchSavedEntry, toDateKey } from "@/lib/domain/rules";
import type { KhataExtraction, KhataRow } from "@/lib/api/contract";
import { SAMPLE_KHATA } from "@/lib/demo/khata-sample";
import type { ShopData } from "./data";
import { findCustomerByName } from "./queries";

/**
 * Rows read from a khata page, matched against the shop's customers and saved entries.
 * Until the vision model is connected, every page reads as the sample page.
 */
export function readSamplePage(db: ShopData, source: KhataExtraction["source"], now: Date): KhataExtraction {
  return {
    scanId: crypto.randomUUID(),
    source,
    rows: SAMPLE_KHATA.map((line, i): KhataRow => {
      const match = findCustomerByName(db, ` ${line.name.toLowerCase()} ${line.nameNative} `);
      const date = toDateKey(addDays(now, -line.daysAgo));
      const saved = match
        ? matchSavedEntry(
            { date, amount: line.amount, items: line.items, struckAmount: line.struckAmount },
            db.entries.filter((e) => e.customerId === match.id),
          )
        : undefined;
      return {
        id: `row${i + 1}`,
        name: { value: line.name, confidence: line.confidence.name },
        nameNative: line.nameNative,
        amount: { value: line.amount, confidence: line.confidence.amount, struck: line.struckAmount },
        date: { value: date, confidence: line.confidence.date },
        items: { value: line.items, confidence: line.confidence.items },
        matchCustomerId: match?.id,
        phone: match ? undefined : "",
        language: match?.language ?? db.shop.defaultCustomerLanguage,
        saved: saved && { kind: saved.kind, entryId: saved.entry.id, amount: saved.entry.amount, items: saved.entry.items },
        action: saved?.kind === "duplicate" ? "skip" : saved ? "update" : "add",
      };
    }),
  };
}
