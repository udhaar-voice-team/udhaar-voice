/**
 * A sample khata page and what a vision model reads from it. Used for the "try the sample page"
 * option, and for every photo until the vision model is connected.
 */

export type SampleLine = {
  /** As written in the ledger (what the photo shows). `struck` is an amount crossed out and written over. */
  written: { name: string; items: string; amount: string; date: string; struck?: string };
  /** What the model read, in Latin script for the app. */
  name: string;
  nameNative: string;
  items: string;
  amount: number;
  /** The crossed-out amount, as the model read it. */
  struckAmount?: number;
  daysAgo: number;
  confidence: { name: number; amount: number; date: number; items: number };
};

export const SAMPLE_KHATA: SampleLine[] = [
  {
    written: { name: "রমেশ", items: "চাল ২ কেজি", amount: "১৫০/-", date: "২০/১০", struck: "১২০" },
    name: "Ramesh", nameNative: "রমেশ", items: "Rice 2 kg", amount: 150, struckAmount: 120, daysAgo: 1,
    confidence: { name: 0.95, amount: 0.84, date: 0.9, items: 0.88 },
  },
  {
    written: { name: "সুনীতা", items: "দুধ", amount: "৪০/-", date: "২১/১০" },
    name: "Sunita", nameNative: "সুনীতা", items: "Milk", amount: 40, daysAgo: 0,
    confidence: { name: 0.93, amount: 0.96, date: 0.92, items: 0.9 },
  },
  {
    written: { name: "বাবলু", items: "বিস্কুট, চানাচুর", amount: "২৬০/-", date: "২১/১০" },
    name: "Bablu", nameNative: "বাবলু", items: "Biscuits, chanachur", amount: 260, daysAgo: 0,
    confidence: { name: 0.58, amount: 0.91, date: 0.9, items: 0.8 },
  },
  {
    written: { name: "মিতালি", items: "মাসকাবারি", amount: "১১২০/-", date: "১৯/১০" },
    name: "Mitali", nameNative: "মিতালি", items: "Monthly groceries", amount: 1120, daysAgo: 2,
    confidence: { name: 0.86, amount: 0.62, date: 0.88, items: 0.84 },
  },
  {
    written: { name: "Imran", items: "Maggi ×3", amount: "85/-", date: "21/10" },
    name: "Imran", nameNative: "ইমরান", items: "Maggi ×3", amount: 85, daysAgo: 0,
    confidence: { name: 0.94, amount: 0.9, date: 0.93, items: 0.95 },
  },
  {
    written: { name: "হারু কাকা", items: "তেল ১ লি.", amount: "৩০০/-", date: "২০/১০", struck: "২৫০" },
    name: "Haru Kaka", nameNative: "হারু কাকা", items: "Mustard oil 1 L", amount: 300, struckAmount: 250, daysAgo: 1,
    confidence: { name: 0.81, amount: 0.93, date: 0.7, items: 0.86 },
  },
];
