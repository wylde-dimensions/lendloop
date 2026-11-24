import { Suspense } from "react";
import { SignIn } from "@clerk/nextjs";
import { Logo } from "@/components/brand";

export const metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 px-6 py-16">
      <Logo />
      {/* Clerk reads the URL for its sub-routes, so it streams in behind Suspense. */}
      <Suspense fallback={<div className="h-96 w-full max-w-sm animate-pulse rounded-2xl bg-ink/5" />}>
        <SignIn fallbackRedirectUrl="/tools" signUpFallbackRedirectUrl="/tools" />
      </Suspense>
    </main>
  );
}
