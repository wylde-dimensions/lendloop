import type { Metadata } from "next";
import { AdminConsole } from "@/components/admin/admin-console";

export const metadata: Metadata = { title: "Admin" };

// Behind sign-in (app/(board)/layout.tsx), so there is no static version of this page
// for Next.js to validate instant navigation against. Opting out is the documented fix.
export const instant = false;

export default function AdminPage() {
  return <AdminConsole />;
}
