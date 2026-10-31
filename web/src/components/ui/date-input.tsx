import * as React from "react"
import { CalendarIcon } from "lucide-react"
import { cn } from "cn"

/**
 * A date field that always shows DD/MM/YYYY. The browser's own date input follows the phone's
 * locale, which shows MM/DD/YYYY on many phones in India. The native input still sits on top,
 * invisible, so tapping it opens the phone's own date picker; the value stays YYYY-MM-DD.
 */
function DateInput({ className, value, onClick, ...props }: Omit<React.ComponentProps<"input">, "type">) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ""))
  return (
    <div className={cn("relative h-8 w-full min-w-0", className)}>
      <input
        type="date"
        value={value}
        {...props}
        onClick={(e) => {
          try {
            e.currentTarget.showPicker()
          } catch {
            // Older browsers open their picker on their own.
          }
          onClick?.(e)
        }}
        className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
      />
      <div
        aria-hidden
        className="flex h-full w-full items-center justify-between gap-2 rounded-lg border border-input bg-transparent px-2.5 text-base transition-colors peer-focus-visible:border-ring peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50 peer-disabled:opacity-50 peer-aria-invalid:border-destructive peer-aria-invalid:ring-3 peer-aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30"
      >
        <span className={cn("tabular-nums", !m && "text-muted-foreground")}>{m ? `${m[3]}/${m[2]}/${m[1]}` : "DD/MM/YYYY"}</span>
        <CalendarIcon className="size-4 shrink-0 opacity-60" />
      </div>
    </div>
  )
}

export { DateInput }
