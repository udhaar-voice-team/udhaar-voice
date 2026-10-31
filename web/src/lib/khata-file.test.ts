import { describe, expect, it } from "vitest";
import { parseCsv, rowsToLines, toDate } from "./khata-file";

const TODAY = "2026-10-29";

describe("CSV", () => {
  it("reads quoted fields with commas, quotes and new lines", () => {
    expect(parseCsv('name,items\r\n"Ramesh, Jr","rice ""5kg""\nand dal"\n\n')).toEqual([
      ["name", "items"],
      ["Ramesh, Jr", 'rice "5kg"\nand dal'],
    ]);
  });
});

describe("spreadsheet dates", () => {
  it("reads the common Indian forms", () => {
    expect(toDate("2026-10-5", TODAY)).toBe("2026-10-05");
    expect(toDate("28/10/2026", TODAY)).toBe("2026-10-28");
    expect(toDate("28-10-26", TODAY)).toBe("2026-10-28");
    expect(toDate("3.9", TODAY)).toBe("2026-09-03");
    expect(toDate(new Date(2026, 9, 1), TODAY)).toBe("2026-10-01");
  });
  it("gives up on anything else", () => {
    expect(toDate("yesterday", TODAY)).toBeUndefined();
    expect(toDate("10/13/2026", TODAY)).toBeUndefined();
  });
});

describe("spreadsheet rows", () => {
  it("finds columns by their header, in any order and language", () => {
    const { lines, skipped } = rowsToLines(
      [
        ["फोन", "तारीख", "नाम", "बाकी"],
        ["9876543210", "27/10/2026", "Ramesh", "₹1,250"],
        ["", "", "No amount", ""],
      ],
      TODAY,
    );
    expect(lines).toEqual([{ name: "Ramesh", amount: 1250, items: "", date: "2026-10-27", phone: "9876543210" }]);
    expect(skipped).toBe(1);
  });
  it("without a header, reads name, amount, items, date, phone", () => {
    expect(rowsToLines([["Haru Kaka", 300, "oil"]], TODAY).lines).toEqual([{ name: "Haru Kaka", amount: 300, items: "oil", date: TODAY, phone: undefined }]);
  });
});

describe("any column names", () => {
  it("knows many common names, with units and in Indian languages", () => {
    const { lines } = rowsToLines(
      [
        ["Party Name", "Balance (Rs)", "Particulars", "Dt", "Mob."],
        ["Sunita", "2,400", "rice", "1/10/26", "9876543210"],
      ],
      TODAY,
    );
    expect(lines).toEqual([{ name: "Sunita", amount: 2400, items: "rice", date: "2026-10-01", phone: "9876543210" }]);
    expect(rowsToLines([["ग्राहक", "उधार"], ["Bapi", "500"]], TODAY).lines[0]).toMatchObject({ name: "Bapi", amount: 500 });
  });

  it("follows a model's column map: title rows, a paid column taken off, month-first dates", () => {
    const rows = [
      ["Shop khata Oct"],
      ["Cust", "Udhaar", "Jama", "When"],
      ["Rina", "1000", "400", "10/28/2026"],
      ["Paid up", "300", "300", "10/27/2026"],
    ];
    const columns = { headerRows: 2, name: 0, nameNative: -1, amount: 1, paid: 2, items: -1, date: 3, phone: -1, dateOrder: "mdy" as const };
    const { lines, skipped } = rowsToLines(rows, TODAY, columns);
    expect(lines).toEqual([{ name: "Rina", amount: 600, items: "", date: "2026-10-28", phone: undefined }]);
    expect(skipped).toBe(1);
  });

  it("reads month-first dates only when told to", () => {
    expect(toDate("10/13/2026", TODAY, "mdy")).toBe("2026-10-13");
    expect(toDate("2026/10/13", TODAY)).toBe("2026-10-13");
  });
});
