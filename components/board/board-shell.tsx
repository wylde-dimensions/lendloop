"use client";

import { createContext, use, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { Logo } from "@/components/brand";
import { ListSkeleton } from "@/components/ui/states";
import { errorMessage } from "@/lib/use-run";
import { cn } from "@/lib/cn";

type Me = NonNullable<FunctionReturnType<typeof api.users.me>>;
const MeContext = createContext<Me | null>(null);

/** The signed-in person, available to every page inside the board. */
export function useMe(): Me {
  const me = use(MeContext);
  if (!me) throw new Error("useMe must be used inside <BoardShell>");
  return me;
}

/**
 * Waits for Convex to accept the Clerk token, provisions the user row once per
 * session, then renders the board. If Convex never accepts the token, the
 * Clerk ↔ Convex wiring is wrong, so say that instead of spinning forever.
 */
export function BoardShell({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const ensure = useMutation(api.users.ensure);
  const me = useQuery(api.users.me, isAuthenticated ? {} : "skip");
  const [setupError, setSetupError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    ensure({}).catch((error: unknown) => setSetupError(errorMessage(error)));
  }, [isAuthenticated, ensure]);

  if (!isLoading && !isAuthenticated) {
    return (
      <Frame>
        <div className="rounded-2xl border border-danger/30 bg-danger-soft p-6 text-danger">
          <p className="font-semibold">Signed in, but the data service didn&apos;t accept your session.</p>
          <p className="mt-1 text-sm">
            Clerk&apos;s Convex integration (or a JWT template named &quot;convex&quot;) and the Convex env
            var CLERK_FRONTEND_API_URL must point at the same Clerk instance. See README → Clerk.
          </p>
        </div>
      </Frame>
    );
  }
  if (setupError) {
    return (
      <Frame>
        <p className="rounded-2xl border border-danger/30 bg-danger-soft p-6 text-danger">{setupError}</p>
      </Frame>
    );
  }
  if (!me) return <BoardShellSkeleton />;

  return (
    <MeContext value={me}>
      <Frame me={me}>{children}</Frame>
    </MeContext>
  );
}

export function BoardShellSkeleton() {
  return (
    <Frame>
      <ListSkeleton rows={4} label="Loading your board" />
    </Frame>
  );
}

function Frame({ me, children }: { me?: Me; children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
          <Logo href="/tools" />
          <div className="flex items-center gap-3">
            {me?.role === "admin" ? (
              <span className="hidden text-xs font-medium text-muted sm:inline">Admin</span>
            ) : null}
            <UserButton />
          </div>
        </div>
        {me ? <BoardNav isAdmin={me.role === "admin"} /> : <div className="h-11" />}
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
    </div>
  );
}

function BoardNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const summary = useQuery(api.loans.summary);
  const links = [
    { href: "/tools", label: "Tools" },
    { href: "/listings", label: "My listings" },
    { href: "/borrowing", label: "My requests", alert: summary?.overdueBorrowing },
    {
      href: "/lending",
      label: "Incoming requests",
      count: summary?.incomingRequests,
      alert: summary?.overdueLending,
    },
    ...(isAdmin ? [{ href: "/admin", label: "Admin" }] : []),
  ];
  return (
    <nav aria-label="Board" className="mx-auto max-w-6xl overflow-x-auto px-4">
      <ul className="flex gap-1">
        {links.map((link) => {
          const active = pathname === link.href;
          return (
            <li key={link.href}>
              <Link
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-11 items-center gap-2 border-b-2 px-3 text-sm whitespace-nowrap",
                  active
                    ? "border-brand font-medium text-ink"
                    : "border-transparent text-muted hover:text-ink",
                )}
              >
                {link.label}
                {link.count ? (
                  <span className="rounded-full bg-brand px-1.5 text-xs text-white">
                    {link.count}
                    <span className="sr-only"> waiting</span>
                  </span>
                ) : null}
                {link.alert ? (
                  <span className="rounded-full bg-danger px-1.5 text-xs text-white">
                    {link.alert}
                    <span className="sr-only"> overdue</span>
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
