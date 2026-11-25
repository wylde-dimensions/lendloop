import type { Metadata } from "next";
import { BorrowingList } from "@/components/loans/borrowing-list";

export const metadata: Metadata = { title: "My requests" };

// Behind sign-in (app/(board)/layout.tsx), so there is no static version of this page
// for Next.js to validate instant navigation against. Opting out is the documented fix.
export const instant = false;

export default function BorrowingPage() {
  return <BorrowingList />;
}
