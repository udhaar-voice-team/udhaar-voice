import { Galada, Kalam } from "next/font/google";
import { SAMPLE_KHATA } from "@/lib/demo/khata-sample";
import { cn } from "@/lib/utils";

// Handwriting faces, loaded only where the sample page is shown.
const bengaliHand = Galada({ subsets: ["bengali", "latin"], weight: "400" });
const latinHand = Kalam({ subsets: ["latin"], weight: ["400", "700"] });

const isBengali = (s: string) => /[ঀ-৿]/.test(s);

/** PROTOTYPE ONLY. A drawn khata page that stands in for a real photo. */
export function SampleKhataPage({ className, scanning = false }: { className?: string; scanning?: boolean }) {
  return (
    <div className={cn("relative overflow-hidden rounded-lg border shadow-sm ledger-paper", className)} role="img" aria-label="Sample khata page with six handwritten credit entries">
      <div className={cn("flex items-baseline justify-between border-b border-ledger-rule px-14 pt-4 pb-2 text-lg", latinHand.className)}>
        <span className={bengaliHand.className}>খাতা — অক্টোবর</span>
        <span className="text-sm text-muted-foreground">p. 14</span>
      </div>
      <ul className="pb-6">
        {SAMPLE_KHATA.map((line, i) => (
          <li key={i} className="grid h-9 grid-cols-[2.75rem_minmax(0,1fr)_auto] items-end gap-2 pr-4 text-[1.05rem] leading-9">
            <span className={cn("text-right text-xs text-muted-foreground", isBengali(line.written.date) ? bengaliHand.className : latinHand.className)}>{line.written.date}</span>
            <span className="truncate pl-2">
              <span className={cn("font-bold", isBengali(line.written.name) ? bengaliHand.className : latinHand.className)}>{line.written.name}</span>{" "}
              <span className={cn("text-muted-foreground", isBengali(line.written.items) ? bengaliHand.className : latinHand.className)}>{line.written.items}</span>
            </span>
            <span className={cn("text-due", isBengali(line.written.amount) ? bengaliHand.className : latinHand.className)}>
              {line.written.struck ? <s className="mr-1 text-muted-foreground decoration-2">{line.written.struck}</s> : null}
              {line.written.amount}
            </span>
          </li>
        ))}
      </ul>
      {scanning ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 h-16 animate-[scan_1.6s_ease-in-out_infinite] bg-gradient-to-b from-transparent via-primary/25 to-transparent" />
      ) : null}
    </div>
  );
}
