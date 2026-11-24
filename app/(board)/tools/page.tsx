import type { Metadata } from "next";
import { ToolsBoard } from "@/components/tools/tools-board";

export const metadata: Metadata = { title: "Tools" };

export default function ToolsPage() {
  return <ToolsBoard />;
}
