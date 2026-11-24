import { v } from "convex/values";
import { literals } from "convex-helpers/validators";
import { CATEGORY_VALUES, CONDITION_VALUES, LOAN_STATUS_VALUES, ROLE_VALUES } from "./constants";

export const vCategory = literals(...CATEGORY_VALUES);
export const vCondition = literals(...CONDITION_VALUES);
export const vLoanStatus = literals(...LOAN_STATUS_VALUES);
export const vRole = literals(...ROLE_VALUES);

/** Why a loan was closed by the system rather than by a person. */
export const vClosedReason = literals("dates_taken", "listing_removed");

export const vDeliveryStatus = literals("pending", "delivered", "failed", "skipped");
export const vReminderStatus = literals("sending", "sent", "failed");
export const vRecipientRole = literals("lender", "borrower");

export const vAuditAction = literals(
  "tool.created",
  "tool.updated",
  "tool.deleted",
  "tool.removed_by_admin",
  "loan.requested",
  "loan.approved",
  "loan.declined",
  "loan.cancelled",
  "loan.auto_closed",
  "loan.returned",
  "user.trusted_lender_granted",
  "user.trusted_lender_revoked",
  "user.role_changed",
  "automation.delivery_retried",
  "automation.incident_resolved",
);

/** A loan's automation timeline entry, shown to the two people involved and to admins. */
export const vActivity = v.object({
  kind: literals("notification", "reminder"),
  status: literals("queued", "retrying", "sent", "failed", "skipped", "sending"),
  label: v.string(),
  at: v.number(),
});

export const vAvailability = v.union(
  v.object({ state: v.literal("available"), nextBookedFrom: v.optional(v.string()) }),
  v.object({ state: v.literal("on_loan"), until: v.string(), overdue: v.boolean() }),
);
