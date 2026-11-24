import type { Metadata } from "next";
import { LendingList } from "@/components/loans/lending-list";

export const metadata: Metadata = { title: "Incoming requests" };

export default function LendingPage() {
  return <LendingList />;
}
