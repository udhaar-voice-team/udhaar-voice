import type { Metadata } from "next";
import { PlansScreen } from "@/components/screens/plans";

export const metadata: Metadata = { title: "Plans" };

export default function Page() {
  return <PlansScreen />;
}
