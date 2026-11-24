import type { Infer } from "convex/values";
import { internal } from "../_generated/api";
import type { MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import type { vRecipientRole } from "./validators";

export type RecipientRole = Infer<typeof vRecipientRole>;

/**
 * Queue a "loan status changed" notification for n8n. Called inside the same
 * mutation that changed the loan: the outbox row and the scheduled delivery
 * commit together with the change, or not at all.
 */
export async function enqueueLoanNotification(
  ctx: MutationCtx,
  loan: Doc<"loans">,
  recipientRole: RecipientRole,
): Promise<void> {
  const outboxId = await ctx.db.insert("outbox", {
    loanId: loan._id,
    loanStatus: loan.status,
    recipientRole,
    status: "pending",
    attempts: 0,
  });
  await ctx.scheduler.runAfter(0, internal.automation.deliverNotification, { outboxId });
}

export function eventIdFor(outboxId: string): string {
  return `evt_${outboxId}`;
}

export const MAX_DELIVERY_ATTEMPTS = 6;

/** Exponential backoff with jitter: ~2s, 8s, 30s, 2m, 8m between attempts. */
export function retryDelayMs(attempt: number, random: number = Math.random()): number {
  const base = 2_000 * 4 ** (attempt - 1);
  const capped = Math.min(base, 10 * 60_000);
  return Math.round(capped * (0.8 + random * 0.4));
}
