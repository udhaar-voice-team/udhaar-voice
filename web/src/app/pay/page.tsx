import type { Metadata } from "next";
import { Suspense } from "react";
import { PayScreen } from "@/components/screens/pay";

export const metadata: Metadata = { title: "Pay by UPI", robots: { index: false } };

/** Linked from a shop's WhatsApp reminder, for the customer. */
export default function PayPage() {
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <Suspense>
        <PayScreen />
      </Suspense>
    </main>
  );
}
