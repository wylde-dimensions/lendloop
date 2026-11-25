import type { Metadata } from "next";
import { ToolsBoard } from "@/components/tools/tools-board";

export const metadata: Metadata = { title: "Tools" };

// Behind sign-in (app/(board)/layout.tsx), so there is no static version of this page
// for Next.js to validate instant navigation against. Opting out is the documented fix.
export const instant = false;

export default function ToolsPage() {
  return <ToolsBoard />;
}
