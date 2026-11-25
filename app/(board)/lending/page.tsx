import type { Metadata } from "next";
import { LendingList } from "@/components/loans/lending-list";

export const metadata: Metadata = { title: "Incoming requests" };

// Behind sign-in (app/(board)/layout.tsx), so there is no static version of this page
// for Next.js to validate instant navigation against. Opting out is the documented fix.
export const instant = false;

export default function LendingPage() {
  return <LendingList />;
}
