import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  vAuditAction,
  vCategory,
  vClosedReason,
  vCondition,
  vDeliveryStatus,
  vLoanStatus,
  vRecipientRole,
  vReminderStatus,
  vRole,
} from "./model/validators";

export default defineSchema({
  /**
   * One row per Clerk user, created on first sign-in. Data minimisation: we keep
   * a first name (shown to the other person in a loan) and an email (used only
   * to address notifications, never returned to other users). No last name,
   * phone, avatar or address.
   */
  users: defineTable({
    tokenIdentifier: v.string(),
    firstName: v.string(),
    email: v.optional(v.string()),
    role: vRole,
    trustedLenderSince: v.optional(v.number()),
  })
    .index("by_tokenIdentifier", ["tokenIdentifier"])
    .index("by_email", ["email"]),

  /** Listings are soft-deleted so loan history and the audit trail stay intact. */
  tools: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    category: vCategory,
    condition: vCondition,
    description: v.string(),
    status: v.union(v.literal("listed"), v.literal("removed")),
    removedAt: v.optional(v.number()),
  })
    .index("by_status_and_category", ["status", "category"])
    .index("by_ownerId_and_status", ["ownerId", "status"]),

  /**
   * A borrow request and, once approved, the loan itself.
   * requested → approved → returned, or requested → declined | cancelled.
   * lenderId is copied from the tool so "incoming requests" is one index read.
   */
  loans: defineTable({
    toolId: v.id("tools"),
    lenderId: v.id("users"),
    borrowerId: v.id("users"),
    startDate: v.string(),
    endDate: v.string(),
    status: vLoanStatus,
    closedReason: v.optional(vClosedReason),
    decidedAt: v.optional(v.number()),
    returnedAt: v.optional(v.number()),
  })
    .index("by_toolId_and_status", ["toolId", "status"])
    .index("by_lenderId_and_status", ["lenderId", "status"])
    .index("by_borrowerId_and_status", ["borrowerId", "status"])
    .index("by_status_and_endDate", ["status", "endDate"]),

  /**
   * Transactional outbox for Convex → n8n notifications. A row is written in
   * the same transaction as the loan change, so a notification can never be
   * lost or sent for a change that rolled back. Personal data is not copied in
   * here: the payload is built from current records at delivery time.
   * The row id doubles as the event id (`evt_<id>`) n8n uses to deduplicate.
   */
  outbox: defineTable({
    loanId: v.id("loans"),
    loanStatus: vLoanStatus,
    recipientRole: vRecipientRole,
    status: vDeliveryStatus,
    attempts: v.number(),
    lastAttemptAt: v.optional(v.number()),
    nextAttemptAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    lastStatusCode: v.optional(v.number()),
    deliveredAt: v.optional(v.number()),
  })
    .index("by_loanId", ["loanId"])
    .index("by_status", ["status"]),

  /**
   * Overdue reminders written back by n8n. reminderKey = `<loanId>:<asOf>` is
   * unique per loan per day, so retries and re-runs update one row instead of
   * creating duplicates, and a claimed or sent key is never sent twice.
   */
  reminders: defineTable({
    loanId: v.id("loans"),
    reminderKey: v.string(),
    asOf: v.string(),
    status: vReminderStatus,
    attempts: v.number(),
    claimedAt: v.number(),
    sentAt: v.optional(v.number()),
    error: v.optional(v.string()),
    executionId: v.optional(v.string()),
  })
    .index("by_reminderKey", ["reminderKey"])
    .index("by_loanId", ["loanId"])
    .index("by_status", ["status"]),

  /** Failed n8n runs reported by its error workflow, so failures show up in the app. */
  automationIncidents: defineTable({
    incidentKey: v.string(),
    workflow: v.string(),
    node: v.optional(v.string()),
    message: v.string(),
    executionId: v.optional(v.string()),
    occurredAt: v.number(),
    resolvedAt: v.optional(v.number()),
  })
    .index("by_incidentKey", ["incidentKey"])
    .index("by_resolvedAt", ["resolvedAt"]),

  /** Append-only record of who changed what. Never holds personal data, only ids. */
  auditLog: defineTable({
    actorId: v.optional(v.id("users")),
    action: vAuditAction,
    targetId: v.string(),
    details: v.optional(v.string()),
  }).index("by_targetId", ["targetId"]),
});
