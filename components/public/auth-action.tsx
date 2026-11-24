"use client";

import Link from "next/link";
import { SignInButton, useAuth } from "@clerk/nextjs";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

/** The landing page's one call to action, which follows the visitor's sign-in state. */
export function AuthAction({ size = "md" }: { size?: "sm" | "md" }) {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <div className={size === "sm" ? "h-8 w-28" : "h-10 w-52"} aria-hidden />;
  if (isSignedIn) {
    return (
      <Link
        href="/tools"
        className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand px-4 text-sm font-medium text-white hover:bg-brand-strong"
      >
        Open your board <ArrowRight className="size-4" aria-hidden />
      </Link>
    );
  }
  return (
    <SignInButton mode="modal" forceRedirectUrl="/tools" signUpForceRedirectUrl="/tools">
      <Button size={size}>{size === "sm" ? "Sign in" : "Sign in to lend or borrow"}</Button>
    </SignInButton>
  );
}
