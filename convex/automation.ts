import { v } from "convex/values";
import { literals } from "convex-helpers/validators";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { appUrl, outgoingWebhook, today as appToday } from "./model/config";
import { addDays, daysBetween, isIsoDate } from "./model/dates";
import { eventIdFor, MAX_DELIVERY_ATTEMPTS, retryDelayMs } from "./model/outbox";
import { signedHeaders } from "./model/signing";
import { redactError } from "./model/redact";
import { vClosedReason, vLoanStatus, vRecipientRole } from "./model/validators";

/**
 * Convex side of the n8n integration. Everything here is internal: reachable
 * only from the scheduler or from the signed HTTP routes in http.ts.
 *
 *   Convex → n8n   deliverNotification posts each outbox row to the n8n webhook,
 *                  retrying with backoff, then dead-letters it for an admin.
 *   n8n → Convex   overdueLoans / claimReminder / recordReminderResult / reportIncident
 *                  back the HTTP endpoints n8n calls.
 */

const DELIVERY_TIMEOUT_MS = 10_000;
/** A claimed reminder with no result after this long is treated as abandoned and may be retried. */
export const REMINDER_LEASE_MS = 15 * 60_000;
const OVERDUE_BATCH = 100;

// ───────────────────────── Convex → n8n: loan notifications ─────────────────────────

const vNotificationPayload = v.object({
  type: v.literal("loan.status_changed"),
  eventId: v.string(),
  occurredAt: v.string(),
  loan: v.object({
    id: v.string(),
    status: vLoanStatus,
    closedReason: v.union(vClosedReason, v.null()),
    startDate: v.string(),
    endDate: v.string(),
  }),
  tool: v.object({ name: v.string() }),
  recipient: v.object({ role: vRecipientRole, firstName: v.string(), email: v.string() }),
  counterpart: v.object({ firstName: v.string() }),
  link: v.string(),
});

/**
 * Build the payload from current records. Only what the message needs leaves
 * Convex: the recipient's first name and email, the other person's first name,
 * the tool name and dates. No last names, descriptions, user ids or other emails.
 */
export const deliveryJob = internalQuery({
  args: { outboxId: v.id("outbox") },
  returns: v.union(
    v.object({ kind: v.literal("done") }),
    v.object({ kind: v.literal("skip"), reason: v.string() }),
    v.object({ kind: v.literal("send"), eventId: v.string(), payload: vNotificationPayload }),
  ),
  handler: async (ctx, { outboxId }) => {
    const row = await ctx.db.get("outbox", outboxId);
    if (!row || row.status !== "pending") return { kind: "done" as const };
    const loan = await ctx.db.get("loans", row.loanId);
    if (!loan) return { kind: "skip" as const, reason: "loan_missing" };
    const [tool, lender, borrower] = await Promise.all([
      ctx.db.get("tools", loan.toolId),
      ctx.db.get("users", loan.lenderId),
      ctx.db.get("users", loan.borrowerId),
    ]);
    const [recipient, counterpart] = row.recipientRole === "lender" ? [lender, borrower] : [borrower, lender];
    if (!recipient?.email) return { kind: "skip" as const, reason: "recipient_has_no_verified_email" };

    const eventId = eventIdFor(row._id);
    return {
      kind: "send" as const,
      eventId,
      payload: {
        type: "loan.status_changed" as const,
        eventId,
        occurredAt: new Date(row._creationTime).toISOString(),
        loan: {
          id: loan._id,
          status: row.loanStatus,
          closedReason: loan.closedReason ?? null,
          startDate: loan.startDate,
          endDate: loan.endDate,
        },
        tool: { name: tool?.name ?? "a tool" },
        recipient: { role: row.recipientRole, firstName: recipient.firstName, email: recipient.email },
        counterpart: { firstName: counterpart?.firstName ?? "a neighbor" },
        link: `${appUrl()}/${row.recipientRole === "lender" ? "lending" : "borrowing"}`,
      },
    };
  },
});

const vAttemptOutcome = v.union(
  v.object({ kind: v.literal("delivered"), statusCode: v.number() }),
  v.object({ kind: v.literal("http_error"), statusCode: v.number() }),
  v.object({ kind: v.literal("network_error"), error: v.string() }),
  v.object({ kind: v.literal("skipped"), reason: v.string() }),
);

export const deliverNotification = internalAction({
  args: { outboxId: v.id("outbox") },
  returns: v.null(),
  handler: async (ctx, { outboxId }) => {
    const job = await ctx.runQuery(internal.automation.deliveryJob, { outboxId });
    if (job.kind === "done") return null;

    const target = outgoingWebhook();
    if (job.kind === "skip" || !target) {
      const reason = job.kind === "skip" ? job.reason : "automation_not_configured";
      await ctx.runMutation(internal.automation.recordDeliveryAttempt, {
        outboxId,
        outcome: { kind: "skipped", reason },
      });
      return null;
    }

    const body = JSON.stringify(job.payload);
    const headers = {
      "content-type": "application/json",
      "user-agent": "LendLoop-Convex/1.0",
      ...(await signedHeaders(target.secret, job.eventId, body)),
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
    let outcome: typeof vAttemptOutcome.type;
    try {
      const response = await fetch(target.url, { method: "POST", headers, body, signal: controller.signal });
      outcome = response.ok
        ? { kind: "delivered", statusCode: response.status }
        : { kind: "http_error", statusCode: response.status };
    } catch (error) {
      outcome = {
        kind: "network_error",
        error: controller.signal.aborted
          ? `timed out after ${DELIVERY_TIMEOUT_MS}ms`
          : error instanceof Error
            ? error.message
            : String(error),
      };
    } finally {
      clearTimeout(timer);
    }
    await ctx.runMutation(internal.automation.recordDeliveryAttempt, { outboxId, outcome });
    return null;
  },
});

/** Retry server errors, timeouts and rate limits; a 4xx means a bug or misconfiguration, so stop. */
function isRetryable(outcome: typeof vAttemptOutcome.type): boolean {
  if (outcome.kind === "network_error") return true;
  if (outcome.kind === "http_error") {
    return outcome.statusCode >= 500 || outcome.statusCode === 408 || outcome.statusCode === 429;
  }
  return false;
}

export const recordDeliveryAttempt = internalMutation({
  args: { outboxId: v.id("outbox"), outcome: vAttemptOutcome },
  returns: v.null(),
  handler: async (ctx, { outboxId, outcome }) => {
    const row = await ctx.db.get("outbox", outboxId);
    if (!row || row.status !== "pending") return null;
    const now = Date.now();
    const attempts = row.attempts + (outcome.kind === "skipped" ? 0 : 1);
    const eventId = eventIdFor(outboxId);

    if (outcome.kind === "delivered") {
      await ctx.db.patch("outbox", outboxId, {
        status: "delivered",
        attempts,
        deliveredAt: now,
        lastAttemptAt: now,
        lastStatusCode: outcome.statusCode,
        lastError: undefined,
        nextAttemptAt: undefined,
      });
      console.log(JSON.stringify({ event: "notification.delivered", eventId, attempts }));
      return null;
    }

    if (outcome.kind === "skipped") {
      await ctx.db.patch("outbox", outboxId, {
        status: "skipped",
        lastAttemptAt: now,
        lastError: outcome.reason,
      });
      console.warn(JSON.stringify({ event: "notification.skipped", eventId, reason: outcome.reason }));
      return null;
    }

    const lastError =
      outcome.kind === "http_error" ? `n8n responded ${outcome.statusCode}` : redactError(outcome.error);
    const lastStatusCode = outcome.kind === "http_error" ? outcome.statusCode : undefined;

    if (isRetryable(outcome) && attempts < MAX_DELIVERY_ATTEMPTS) {
      const delay = retryDelayMs(attempts);
      await ctx.db.patch("outbox", outboxId, {
        attempts,
        lastAttemptAt: now,
        nextAttemptAt: now + delay,
        lastError,
        lastStatusCode,
      });
      await ctx.scheduler.runAfter(delay, internal.automation.deliverNotification, { outboxId });
      console.warn(
        JSON.stringify({
          event: "notification.retry_scheduled",
          eventId,
          attempts,
          delayMs: delay,
          lastError,
        }),
      );
      return null;
    }

    await ctx.db.patch("outbox", outboxId, {
      status: "failed",
      attempts,
      lastAttemptAt: now,
      nextAttemptAt: undefined,
      lastError,
      lastStatusCode,
    });
    // Dead letter: shown on the admin Automation page with a Retry button.
    console.error(JSON.stringify({ event: "notification.dead_lettered", eventId, attempts, lastError }));
    return null;
  },
});

// ───────────────────────── n8n → Convex: overdue reminders ─────────────────────────

/** asOf comes from n8n; accept today and yesterday so a run that crosses midnight still lands. */
export function isAcceptableAsOf(asOf: string, today: string): boolean {
  return isIsoDate(asOf) && (asOf === today || asOf === addDays(today, -1));
}

export function reminderKeyFor(loanId: string, asOf: string): string {
  return `${loanId}:${asOf}`;
}

function reminderBlocks(reminder: Doc<"reminders"> | null, now: number): boolean {
  if (!reminder) return false;
  if (reminder.status === "sent") return true;
  return reminder.status === "sending" && now - reminder.claimedAt < REMINDER_LEASE_MS;
}

const vOverdueLoan = v.object({
  loanId: v.string(),
  reminderKey: v.string(),
  dueDate: v.string(),
  daysOverdue: v.number(),
  toolName: v.string(),
  borrower: v.object({ firstName: v.string(), email: v.string() }),
  link: v.string(),
});

/**
 * Approved loans whose end date has passed, minus any already reminded today.
 * Borrowers without a verified email are left out (nothing to send to).
 */
export const overdueLoans = internalQuery({
  args: { asOf: v.string(), now: v.number() },
  returns: v.object({
    asOf: v.string(),
    loans: v.array(vOverdueLoan),
    hasMore: v.boolean(),
  }),
  handler: async (ctx, { asOf, now }) => {
    const candidates = await ctx.db
      .query("loans")
      .withIndex("by_status_and_endDate", (q) => q.eq("status", "approved").lt("endDate", asOf))
      .take(OVERDUE_BATCH + 1);
    const hasMore = candidates.length > OVERDUE_BATCH;

    const loans: (typeof vOverdueLoan.type)[] = [];
    for (const loan of candidates.slice(0, OVERDUE_BATCH)) {
      const reminderKey = reminderKeyFor(loan._id, asOf);
      const reminder = await ctx.db
        .query("reminders")
        .withIndex("by_reminderKey", (q) => q.eq("reminderKey", reminderKey))
        .unique();
      if (reminderBlocks(reminder, now)) continue;
      const [borrower, tool] = await Promise.all([
        ctx.db.get("users", loan.borrowerId),
        ctx.db.get("tools", loan.toolId),
      ]);
      if (!borrower?.email) continue;
      loans.push({
        loanId: loan._id,
        reminderKey,
        dueDate: loan.endDate,
        daysOverdue: daysBetween(loan.endDate, asOf),
        toolName: tool?.name ?? "the tool you borrowed",
        borrower: { firstName: borrower.firstName, email: borrower.email },
        link: `${appUrl()}/borrowing`,
      });
    }
    return { asOf, loans, hasMore };
  },
});

/**
 * Claim one reminder before sending it. Idempotent and race-safe: a key that
 * was sent, or is being sent by another run within the lease, is refused, so
 * retries and overlapping runs never email the same borrower twice in a day.
 */
export const claimReminder = internalMutation({
  args: { loanId: v.string(), asOf: v.string(), executionId: v.optional(v.string()) },
  returns: v.union(
    v.object({ proceed: v.literal(true), reminderKey: v.string() }),
    v.object({
      proceed: v.literal(false),
      reason: literals("bad_date", "not_found", "not_overdue", "already_sent", "in_progress"),
    }),
  ),
  handler: async (ctx, { loanId, asOf, executionId }) => {
    if (!isAcceptableAsOf(asOf, appToday())) return { proceed: false as const, reason: "bad_date" as const };
    const id = ctx.db.normalizeId("loans", loanId);
    const loan = id ? await ctx.db.get("loans", id) : null;
    if (!loan) return { proceed: false as const, reason: "not_found" as const };
    if (loan.status !== "approved" || loan.endDate >= asOf) {
      return { proceed: false as const, reason: "not_overdue" as const };
    }

    const reminderKey = reminderKeyFor(loan._id, asOf);
    const now = Date.now();
    const existing = await ctx.db
      .query("reminders")
      .withIndex("by_reminderKey", (q) => q.eq("reminderKey", reminderKey))
      .unique();
    if (existing?.status === "sent") return { proceed: false as const, reason: "already_sent" as const };
    if (reminderBlocks(existing, now)) return { proceed: false as const, reason: "in_progress" as const };

    if (existing) {
      await ctx.db.patch("reminders", existing._id, {
        status: "sending",
        attempts: existing.attempts + 1,
        claimedAt: now,
        error: undefined,
        executionId,
      });
    } else {
      await ctx.db.insert("reminders", {
        loanId: loan._id,
        reminderKey,
        asOf,
        status: "sending",
        attempts: 1,
        claimedAt: now,
        executionId,
      });
    }
    return { proceed: true as const, reminderKey };
  },
});

/** Record the outcome of a claimed reminder. Replaying the same result is a no-op. */
export const recordReminderResult = internalMutation({
  args: {
    reminderKey: v.string(),
    status: literals("sent", "failed"),
    error: v.optional(v.string()),
    executionId: v.optional(v.string()),
  },
  returns: v.object({ outcome: literals("recorded", "duplicate", "not_claimed") }),
  handler: async (ctx, { reminderKey, status, error, executionId }) => {
    const reminder = await ctx.db
      .query("reminders")
      .withIndex("by_reminderKey", (q) => q.eq("reminderKey", reminderKey))
      .unique();
    if (!reminder) return { outcome: "not_claimed" as const };
    // "sent" is terminal: a late "failed" from a retried branch must not undo it.
    if (reminder.status === "sent") return { outcome: "duplicate" as const };
    if (reminder.status === status && status === "failed" && reminder.error === redactError(error)) {
      return { outcome: "duplicate" as const };
    }

    if (status === "sent") {
      await ctx.db.patch("reminders", reminder._id, {
        status: "sent",
        sentAt: Date.now(),
        error: undefined,
        executionId,
      });
      console.log(JSON.stringify({ event: "reminder.sent", reminderKey }));
    } else {
      await ctx.db.patch("reminders", reminder._id, {
        status: "failed",
        error: redactError(error),
        executionId,
      });
      console.error(JSON.stringify({ event: "reminder.failed", reminderKey, error: redactError(error) }));
    }
    return { outcome: "recorded" as const };
  },
});

/** n8n's error workflow reports failed executions here, once per execution. */
export const reportIncident = internalMutation({
  args: {
    incidentKey: v.string(),
    workflow: v.string(),
    node: v.optional(v.string()),
    message: v.string(),
    executionId: v.optional(v.string()),
  },
  returns: v.object({ outcome: literals("recorded", "duplicate") }),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("automationIncidents")
      .withIndex("by_incidentKey", (q) => q.eq("incidentKey", args.incidentKey))
      .unique();
    if (existing) return { outcome: "duplicate" as const };
    const message = redactError(args.message, 500) ?? "Unknown error";
    await ctx.db.insert("automationIncidents", {
      incidentKey: args.incidentKey.slice(0, 200),
      workflow: args.workflow.slice(0, 200),
      node: args.node?.slice(0, 200),
      message,
      executionId: args.executionId?.slice(0, 100),
      occurredAt: Date.now(),
    });
    console.error(
      JSON.stringify({ event: "automation.incident", workflow: args.workflow, node: args.node, message }),
    );
    return { outcome: "recorded" as const };
  },
});
