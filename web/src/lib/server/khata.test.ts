import { describe, expect, it } from "vitest";
import { createSeed } from "@/lib/demo/seed";
import type { ShopData } from "./data";
import { readSamplePage } from "./khata";

const NOW = new Date("2026-10-21T11:00:00");
const fresh = (): ShopData => ({ ...createSeed(NOW), imports: [], lines: { lines: 2, onLine: [], waiting: [] } });
const rowFor = (name: string, db = fresh()) => readSamplePage(db, "sample", NOW).rows.find((r) => r.name.value === name)!;

describe("snap khata", () => {
  it("keeps what was crossed out next to the new value", () => {
    const haru = rowFor("Haru Kaka");
    expect(haru.amount).toMatchObject({ value: 300, struck: 250 });
    expect(haru.action).toBe("add");
  });

  it("offers to update an entry the shopkeeper wrote over", () => {
    const ramesh = rowFor("Ramesh");
    expect(ramesh.saved).toMatchObject({ kind: "changed", amount: 120 });
    expect(ramesh.action).toBe("update");
  });

  it("skips rows saved before when the same page is photographed again", () => {
    const db = fresh();
    for (const row of readSamplePage(db, "sample", NOW).rows) {
      if (!row.matchCustomerId) continue;
      const entry = { customerId: row.matchCustomerId, amount: row.amount.value, items: row.items.value, date: row.date.value, source: "photo" as const, createdAt: NOW.toISOString() };
      if (row.saved && row.action === "update") Object.assign(db.entries.find((e) => e.id === row.saved!.entryId)!, entry);
      else db.entries.push({ id: `saved-${row.id}`, ...entry });
    }
    const again = readSamplePage(db, "sample", NOW).rows.filter((r) => r.matchCustomerId);
    expect(again.every((r) => r.saved?.kind === "duplicate" && r.action === "skip")).toBe(true);
  });

  it("gives new customers the shop's default language", () => {
    const db = fresh();
    db.shop.defaultCustomerLanguage = "hi";
    expect(rowFor("Haru Kaka", db).language).toBe("hi");
  });
});
