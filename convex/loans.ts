import { v } from "convex/values";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { appError } from "./model/errors";
import { audit } from "./model/audit";
import { userMutation, userQuery } from "./model/functions";
import { rangesOverlap } from "./model/dates";
import { today as appToday } from "./model/config";
import { approvedLoansFor, overlapsAny } from "./model/availability";
import { assertValidRange, loanForParticipant } from "./model/loans";
import { enqueueLoanNotification } from "./model/outbox";
import { loanActivity } from "./model/activity";
import { LIMITS } from "./model/constants";
import { vActivity, vCategory, vClosedReason, vLoanStatus } from "./model/validators";
import { rateLimiter } from "./rateLimits";

/**
 * Loan state machine. Every transition checks, inside Convex, that the viewer is
 * the right party for it:
 *
 *   request       borrower (anyone but the owner)   â†’  requested
 *   approve       lender (tool owner)               requested â†’ approved
 *   decline       lender                            requested â†’ declined
 *   cancel        borrower                          requested â†’ cancelled
 *   markReturned  lender                            approved  â†’ returned
 *
 * Each transition writes an audit entry and queues a notification in the same
 * transaction.
 */

export const request = userMutation({
  args: { toolId: v.id("tools"), startDate: v.string(), endDate: v.string() },
  returns: v.id("loans"),
  handler: async (ctx, { toolId, startDate, endDate }) => {
    const { viewer } = ctx;
    const range = { startDate, endDate };
    const today = appToday();
    assertValidRange(range, today);

    const tool = await ctx.db.get("tools", toolId);
    if (!tool || tool.status !== "listed") throw appError("NOT_FOUND", "That tool is no longer listed.");
    if (tool.ownerId === viewer._id) throw appError("INVALID", "You can't borrow your own tool.");

    if (overlapsAny(range, await approvedLoansFor(ctx, toolId))) {
      throw appError("CONFLICT", "The tool is already booked for some of those dates.");
    }
    const myPending = await ctx.db
      .query("loans")
      .withIndex("by_borrowerId_and_status", (q) => q.eq("borrowerId", viewer._id).eq("status", "requested"))
      .take(LIMITS.listMax);
    if (myPending.some((loan) => loan.toolId === toolId)) {
      throw appError("CONFLICT", "You already have a pending request for this tool.");
    }

    await rateLimiter.limit(ctx, "requestLoan", { key: viewer._id, throws: true });

    const loanId = await ctx.db.insert("loans", {
      toolId,
      lenderId: tool.ownerId,
      borrowerId: viewer._id,
      startDate,
      endDate,
      status: "requested",
    });
    await audit(ctx, { actorId: viewer._id, action: "loan.requested", targetId: loanId });
    const loan = await ctx.db.get("loans", loanId);
    if (loan) await enqueueLoanNotification(ctx, loan, "lender");
    return loanId;
  },
});

export const approve = userMutation({
  args: { loanId: v.id("loans") },
  returns: v.null(),
  handler: async (ctx, { loanId }) => {
    const { viewer } = ctx;
    const loan = await loanForParticipant(ctx, loanId, viewer, "lender");
    if (loan.status !== "requested") throw appError("CONFLICT", `This request is already ${loan.status}.`);
    const tool = await ctx.db.get("tools", loan.toolId);
    if (!tool || tool.status !== "listed") throw appError("CONFLICT", "This listing has been removed.");
    const today = appToday();
    if (loan.endDate < today)
      throw appError("CONFLICT", "These dates have passed. Decline the request instead.");

    if (overlapsAny(loan, await approvedLoansFor(ctx, loan.toolId))) {
      throw appError("CONFLICT", "You've already approved a loan for some of these dates.");
    }

    const now = Date.now();
    await ctx.db.patch("loans", loanId, { status: "approved", decidedAt: now });
    await audit(ctx, { actorId: viewer._id, action: "loan.approved", targetId: loanId });
    const approved = await ctx.db.get("loans", loanId);
    if (approved) await enqueueLoanNotification(ctx, approved, "borrower");

    // Other requests for the same dates can no longer be met: close them now
    // rather than leave borrowers waiting on a request that can't be approved.
    const competing = await ctx.db
      .query("loans")
      .withIndex("by_toolId_and_status", (q) => q.eq("toolId", loan.toolId).eq("status", "requested"))
      .take(100);
    for (const other of competing) {
      if (other._id === loanId || !rangesOverlap(other, loan)) continue;
      await ctx.db.patch("loans", other._id, {
        status: "declined",
        closedReason: "dates_taken",
        decidedAt: now,
      });
      await audit(ctx, {
        actorId: viewer._id,
        action: "loan.auto_closed",
        targetId: other._id,
        details: "dates_taken",
      });
      const declined = await ctx.db.get("loans", other._id);
      if (declined) await enqueueLoanNotification(ctx, declined, "borrower");
    }
    return null;
  },
});

export const decline = userMutation({
  args: { loanId: v.id("loans") },
  returns: v.null(),
  handler: async (ctx, { loanId }) => {
    const { viewer } = ctx;
    const loan = await loanForParticipant(ctx, loanId, viewer, "lender");
    if (loan.status !== "requested") throw appError("CONFLICT", `This request is already ${loan.status}.`);
    await ctx.db.patch("loans", loanId, { status: "declined", decidedAt: Date.now() });
    await audit(ctx, { actorId: viewer._id, action: "loan.declined", targetId: loanId });
    const updated = await ctx.db.get("loans", loanId);
    if (updated) await enqueueLoanNotification(ctx, updated, "borrower");
    return null;
  },
});

export const cancel = userMutation({
  args: { loanId: v.id("loans") },
  returns: v.null(),
  handler: async (ctx, { loanId }) => {
    const { viewer } = ctx;
    const loan = await loanForParticipant(ctx, loanId, viewer, "borrower");
    if (loan.status !== "requested") {
      throw appError("CONFLICT", `This request is already ${loan.status} and can't be cancelled.`);
    }
    await ctx.db.patch("loans", loanId, { status: "cancelled", decidedAt: Date.now() });
    await audit(ctx, { actorId: viewer._id, action: "loan.cancelled", targetId: loanId });
    const updated = await ctx.db.get("loans", loanId);
    if (updated) await enqueueLoanNotification(ctx, updated, "lender");
    return null;
  },
});

export const markReturned = userMutation({
  args: { loanId: v.id("loans") },
  returns: v.null(),
  handler: async (ctx, { loanId }) => {
    const { viewer } = ctx;
    const loan = await loanForParticipant(ctx, loanId, viewer, "lender");
    if (loan.status !== "approved")
      throw appError("CONFLICT", "Only an approved loan can be marked returned.");
    await ctx.db.patch("loans", loanId, { status: "returned", returnedAt: Date.now() });
    await audit(ctx, { actorId: viewer._id, action: "loan.returned", targetId: loanId });
    const updated = await ctx.db.get("loans", loanId);
    if (updated) await enqueueLoanNotification(ctx, updated, "borrower");
    return null;
  },
});

const vLoanView = v.object({
  id: v.id("loans"),
  status: vLoanStatus,
  closedReason: v.optional(vClosedReason),
  startDate: v.string(),
  endDate: v.string(),
  requestedAt: v.number(),
  overdue: v.boolean(),
  tool: v.object({ name: v.string(), category: vCategory, removed: v.boolean() }),
  /** The other person in the loan: first name only. */
  counterpart: v.object({ firstName: v.string(), isTrustedLender: v.boolean() }),
  activity: v.array(vActivity),
});

async function loansWhere(
  ctx: QueryCtx,
  index: "by_borrowerId_and_status" | "by_lenderId_and_status",
  field: "borrowerId" | "lenderId",
  userId: Id<"users">,
): Promise<Doc<"loans">[]> {
  return await ctx.db
    .query("loans")
    .withIndex(index, (q) => q.eq(field, userId))
    .order("desc")
    .take(LIMITS.listMax);
}

async function presentLoans(
  ctx: QueryCtx,
  loans: Doc<"loans">[],
  counterpartField: "lenderId" | "borrowerId",
) {
  const today = appToday();
  const views = await Promise.all(
    loans.map(async (loan) => {
      const [tool, counterpart, activity] = await Promise.all([
        ctx.db.get("tools", loan.toolId),
        ctx.db.get("users", loan[counterpartField]),
        loanActivity(ctx, loan._id),
      ]);
      return {
        id: loan._id,
        status: loan.status,
        closedReason: loan.closedReason,
        startDate: loan.startDate,
        endDate: loan.endDate,
        requestedAt: loan._creationTime,
        overdue: loan.status === "approved" && loan.endDate < today,
        tool: {
          name: tool?.name ?? "Removed tool",
          category: tool?.category ?? "other",
          removed: tool?.status !== "listed",
        },
        counterpart: {
          firstName: counterpart?.firstName ?? "Neighbor",
          isTrustedLender: counterpart?.trustedLenderSince !== undefined,
        },
        activity,
      };
    }),
  );
  return views.sort((a, b) => b.requestedAt - a.requestedAt);
}

/** "My requests": everything the viewer asked to borrow. */
export const borrowing = userQuery({
  args: {},
  returns: v.array(vLoanView),
  handler: async (ctx) => {
    const loans = await loansWhere(ctx, "by_borrowerId_and_status", "borrowerId", ctx.viewer._id);
    return await presentLoans(ctx, loans, "lenderId");
  },
});

/** Counts for the navigation badges. */
export const summary = userQuery({
  args: {},
  returns: v.object({
    incomingRequests: v.number(),
    overdueLending: v.number(),
    overdueBorrowing: v.number(),
  }),
  handler: async (ctx) => {
    const today = appToday();
    const byLender = (status: "requested" | "approved") =>
      ctx.db
        .query("loans")
        .withIndex("by_lenderId_and_status", (q) => q.eq("lenderId", ctx.viewer._id).eq("status", status))
        .take(LIMITS.listMax);
    const [incoming, lent, borrowed] = await Promise.all([
      byLender("requested"),
      byLender("approved"),
      ctx.db
        .query("loans")
        .withIndex("by_borrowerId_and_status", (q) =>
          q.eq("borrowerId", ctx.viewer._id).eq("status", "approved"),
        )
        .take(LIMITS.listMax),
    ]);
    return {
      incomingRequests: incoming.filter((loan) => loan.endDate >= today).length,
      overdueLending: lent.filter((loan) => loan.endDate < today).length,
      overdueBorrowing: borrowed.filter((loan) => loan.endDate < today).length,
    };
  },
});

/** "Incoming requests": everything asked of the viewer's tools. */
export const lending = userQuery({
  args: {},
  returns: v.array(vLoanView),
  handler: async (ctx) => {
    const loans = await loansWhere(ctx, "by_lenderId_and_status", "lenderId", ctx.viewer._id);
    return await presentLoans(ctx, loans, "borrowerId");
  },
});
