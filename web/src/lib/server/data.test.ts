import { describe, expect, it } from "vitest";
import { toPromises, toShop } from "./data";

const NOW = new Date("2026-10-21T11:00:00");
const promise = (id: string, due: string, created: string, kept: string | null = null) => ({
  id,
  customer_id: "c1",
  call_id: null,
  amount: 500,
  due_date: due,
  kept_at: kept,
  created_at: created,
});

describe("promise status", () => {
  it("is kept once a payment covers it", () => {
    expect(toPromises([promise("p1", "2026-10-25", "2026-10-18T10:00:00Z", "2026-10-20T10:00:00Z")], NOW)[0].status).toBe("kept");
  });

  it("stays open, and shows as overdue, after its date until a newer promise replaces it", () => {
    const old = promise("p1", "2026-10-18", "2026-10-10T10:00:00Z");
    expect(toPromises([old], NOW)[0].status).toBe("open");
    const [replaced, current] = toPromises([old, promise("p2", "2026-10-25", "2026-10-19T10:00:00Z")], NOW);
    expect(replaced.status).toBe("broken");
    expect(current.status).toBe("open");
  });
});

describe("shop", () => {
  it("joins the shop, its settings and its owner", () => {
    const shop = toShop(
      { id: "s1", owner_id: "u1", name: "Maa Tara", upi_id: null },
      {
        shop_id: "s1",
        calling_start: 8,
        calling_end: 19,
        reminder_gap_days: 3,
        max_call_minutes: 3,
        default_customer_language: "bn",
        report_enabled: true,
        report_time: "20:00:00",
        report_language: "hi",
        demo_bypass_hours: false,
      },
      { id: "u1", name: "Gopal Saha", phone: "+919000000001", created_at: "2026-10-01T00:00:00Z" },
    );
    expect(shop).toMatchObject({ ownerName: "Gopal Saha", ownerPhone: "+919000000001", upiId: "", reportTime: "20:00", callingHours: { start: 8, end: 19 } });
  });
});
