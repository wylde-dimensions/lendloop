"use client";

import type { ReactNode } from "react";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { useAuth } from "@clerk/nextjs";

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not set. Run `npm run setup` (see README).");

const convex = new ConvexReactClient(url);

/**
 * Convex authenticates every request with the signed-in user's Clerk token.
 * Clerk's Convex integration marks session tokens with aud "convex"; without it
 * the provider falls back to a JWT template named "convex" (see README).
 */
export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return (
    <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
      {children}
    </ConvexProviderWithClerk>
  );
}
