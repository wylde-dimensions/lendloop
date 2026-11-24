import type { Metadata } from "next";
import { BorrowingList } from "@/components/loans/borrowing-list";

export const metadata: Metadata = { title: "My requests" };

export default function BorrowingPage() {
  return <BorrowingList />;
}
