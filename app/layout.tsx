import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { connection } from "next/server";
import { Suspense } from "react";
import { ClerkProvider } from "@clerk/nextjs";
import { Toaster } from "sonner";
import { ConvexClientProvider } from "@/components/providers/convex-client-provider";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "LendLoop", template: "%s · LendLoop" },
  description: "Borrow what you need. Lend what you don't. A tool-lending board for your neighborhood.",
};

// The CSP (proxy.ts) lets a script run only with this request's nonce. HTML
// prerendered at build time can't carry one, so every page renders per request:
// connection() opts the whole document out of the static shell, and
// <ClerkProvider dynamic> passes the nonce to the scripts Clerk loads.
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <Suspense>
      <Document>{children}</Document>
    </Suspense>
  );
}

async function Document({ children }: { children: React.ReactNode }) {
  await connection();
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <ClerkProvider dynamic>
          <ConvexClientProvider>{children}</ConvexClientProvider>
        </ClerkProvider>
        <Toaster position="bottom-right" richColors closeButton />
      </body>
    </html>
  );
}
