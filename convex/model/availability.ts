import type { Infer } from "convex/values";
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { vAvailability } from "./validators";
import { rangesOverlap, type DateRange } from "./dates";

export type Availability = Infer<typeof vAvailability>;

/** Approved loans for a tool. Bounded: a tool has few future bookings at once. */
export async function approvedLoansFor(ctx: QueryCtx, toolId: Id<"tools">): Promise<Doc<"loans">[]> {
  return await ctx.db
    .query("loans")
    .withIndex("by_toolId_and_status", (q) => q.eq("toolId", toolId).eq("status", "approved"))
    .take(100);
}

/**
 * A tool is "on loan" from the first day of an approved loan until the lender
 * marks it returned, so an overdue loan keeps the tool unavailable.
 */
export function availabilityFrom(approved: Doc<"loans">[], today: string): Availability {
  const current = approved
    .filter((loan) => loan.startDate <= today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
  if (current) {
    return { state: "on_loan", until: current.endDate, overdue: current.endDate < today };
  }
  const next = approved
    .filter((loan) => loan.startDate > today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
  return next ? { state: "available", nextBookedFrom: next.startDate } : { state: "available" };
}

export function overlapsAny(range: DateRange, loans: Doc<"loans">[]): boolean {
  return loans.some((loan) => rangesOverlap(range, loan));
}
