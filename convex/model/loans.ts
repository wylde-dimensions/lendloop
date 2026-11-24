import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { appError } from "./errors";
import { audit } from "./audit";
import { enqueueLoanNotification } from "./outbox";
import { addDays, daysBetween, isIsoDate, type DateRange } from "./dates";
import { LIMITS } from "./constants";

/** Reject impossible or abusive date ranges before touching the database. */
export function assertValidRange(range: DateRange, today: string): void {
  if (!isIsoDate(range.startDate) || !isIsoDate(range.endDate)) {
    throw appError("INVALID", "Pick a start and end date.");
  }
  if (range.startDate < today) throw appError("INVALID", "The loan can't start in the past.");
  if (range.endDate < range.startDate) {
    throw appError("INVALID", "The return date must be on or after the start date.");
  }
  if (daysBetween(range.startDate, range.endDate) + 1 > LIMITS.maxLoanDays) {
    throw appError("INVALID", `Loans can be at most ${LIMITS.maxLoanDays} days.`);
  }
  if (range.startDate > addDays(today, LIMITS.maxAdvanceDays)) {
    throw appError("INVALID", `Requests can start at most ${LIMITS.maxAdvanceDays} days ahead.`);
  }
}

/**
 * Load a loan the viewer takes part in. Someone outside the loan gets NOT_FOUND,
 * not FORBIDDEN, so loan ids cannot be probed for existence.
 */
export async function loanForParticipant(
  ctx: QueryCtx,
  loanId: Id<"loans">,
  viewer: Doc<"users">,
  as: "lender" | "borrower",
): Promise<Doc<"loans">> {
  const loan = await ctx.db.get("loans", loanId);
  const participantId = as === "lender" ? loan?.lenderId : loan?.borrowerId;
  if (!loan || participantId !== viewer._id) {
    throw appError("NOT_FOUND", "That request doesn't exist or isn't yours.");
  }
  return loan;
}

/**
 * When a listing goes away, close the loans that can no longer happen and tell
 * each borrower. A loan already in progress is left open so it can be returned.
 */
export async function closeLoansForRemovedTool(
  ctx: MutationCtx,
  tool: Doc<"tools">,
  today: string,
  actorId: Id<"users">,
): Promise<void> {
  const open = await Promise.all(
    (["requested", "approved"] as const).map((status) =>
      ctx.db
        .query("loans")
        .withIndex("by_toolId_and_status", (q) => q.eq("toolId", tool._id).eq("status", status))
        .take(100),
    ),
  );
  for (const loan of open.flat()) {
    const inProgress = loan.status === "approved" && loan.startDate <= today;
    if (inProgress) continue;
    await ctx.db.patch("loans", loan._id, {
      status: "cancelled",
      closedReason: "listing_removed",
      decidedAt: Date.now(),
    });
    await audit(ctx, {
      actorId,
      action: "loan.auto_closed",
      targetId: loan._id,
      details: `listing_removed from ${loan.status}`,
    });
    const updated = await ctx.db.get("loans", loan._id);
    if (updated) await enqueueLoanNotification(ctx, updated, "borrower");
  }
}
