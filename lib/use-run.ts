"use client";

import { useCallback, useState } from "react";
import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";
import { toast } from "sonner";

/** Turn any error from a Convex call into a sentence a person can act on. */
export function errorMessage(error: unknown): string {
  if (error instanceof ConvexError) {
    const data = error.data as { message?: unknown; kind?: unknown; retryAfter?: unknown } | undefined;
    if (data?.kind === "RateLimited") {
      const minutes =
        typeof data.retryAfter === "number" ? Math.max(1, Math.ceil(data.retryAfter / 60_000)) : 1;
      return `You're doing that a lot. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
    }
    if (typeof data?.message === "string") return data.message;
  }
  return "Something went wrong. Please try again.";
}

/**
 * Run a Convex mutation with a pending flag and a toast on success or failure.
 * Returns undefined when the mutation failed (the toast already explained why).
 */
export function useRun<M extends FunctionReference<"mutation">>(mutation: M) {
  const mutate = useMutation(mutation);
  const [pending, setPending] = useState(false);
  const run = useCallback(
    async (args: FunctionArgs<M>, success?: string): Promise<FunctionReturnType<M> | undefined> => {
      setPending(true);
      try {
        const result = await mutate(args);
        if (success) toast.success(success);
        return result;
      } catch (error) {
        toast.error(errorMessage(error));
        return undefined;
      } finally {
        setPending(false);
      }
    },
    [mutate],
  );
  return [run, pending] as const;
}
