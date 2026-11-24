import { v } from "convex/values";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { appError } from "./model/errors";
import { audit } from "./model/audit";
import { adminMutation, adminQuery } from "./model/functions";
import { today as appToday } from "./model/config";
import { closeLoansForRemovedTool } from "./model/loans";
import { loanActivity } from "./model/activity";
import { eventIdFor } from "./model/outbox";
import { LIMITS } from "./model/constants";
import { vActivity, vAuditAction, vCategory, vLoanStatus, vRole } from "./model/validators";

/**
 * Admin capabilities: remove any listing, view all loans, mark Trusted Lenders,
 * and watch automation health. Every function here is wrapped in adminQuery /
 * adminMutation, which re-checks the role on the server for each call.
 */

export const listings = adminQuery({
  args: {},
  returns: v.array(
    v.object({
      id: v.id("tools"),
      name: v.string(),
      category: vCategory,
      owner: v.object({ id: v.id("users"), firstName: v.string() }),
      listedAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const tools = await ctx.db
      .query("tools")
      .withIndex("by_status_and_category", (q) => q.eq("status", "listed"))
      .take(LIMITS.listMax);
    return await Promise.all(
      tools.map(async (tool) => {
        const owner = await ctx.db.get("users", tool.ownerId);
        return {
          id: tool._id,
          name: tool.name,
          category: tool.category,
          owner: { id: tool.ownerId, firstName: owner?.firstName ?? "Unknown" },
          listedAt: tool._creationTime,
        };
      }),
    );
  },
});

export const removeListing = adminMutation({
  args: { toolId: v.id("tools"), reason: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { toolId, reason }) => {
    const { viewer } = ctx;
    const tool = await ctx.db.get("tools", toolId);
    if (!tool || tool.status !== "listed") throw appError("NOT_FOUND", "That listing is already gone.");
    await closeLoansForRemovedTool(ctx, tool, appToday(), viewer._id);
    await ctx.db.patch("tools", toolId, { status: "removed", removedAt: Date.now() });
    await audit(ctx, {
      actorId: viewer._id,
      action: "tool.removed_by_admin",
      targetId: toolId,
      details: reason?.trim().slice(0, LIMITS.reasonMax) || undefined,
    });
    return null;
  },
});

const vAdminLoan = v.object({
  id: v.id("loans"),
  status: vLoanStatus,
  startDate: v.string(),
  endDate: v.string(),
  overdue: v.boolean(),
  requestedAt: v.number(),
  toolName: v.string(),
  lenderFirstName: v.string(),
  borrowerFirstName: v.string(),
  activity: v.array(vActivity),
});

export const loans = adminQuery({
  args: { status: v.optional(vLoanStatus), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(vAdminLoan),
  handler: async (ctx, { status, paginationOpts }) => {
    const page = status
      ? await ctx.db
          .query("loans")
          .withIndex("by_status_and_endDate", (q) => q.eq("status", status))
          .order("desc")
          .paginate(paginationOpts)
      : await ctx.db.query("loans").order("desc").paginate(paginationOpts);
    const today = appToday();
    const firstName = async (id: Id<"users">) => (await ctx.db.get("users", id))?.firstName ?? "Unknown";
    return {
      ...page,
      page: await Promise.all(
        page.page.map(async (loan: Doc<"loans">) => ({
          id: loan._id,
          status: loan.status,
          startDate: loan.startDate,
          endDate: loan.endDate,
          overdue: loan.status === "approved" && loan.endDate < today,
          requestedAt: loan._creationTime,
          toolName: (await ctx.db.get("tools", loan.toolId))?.name ?? "Removed tool",
          lenderFirstName: await firstName(loan.lenderId),
          borrowerFirstName: await firstName(loan.borrowerId),
          activity: await loanActivity(ctx, loan._id),
        })),
      ),
    };
  },
});

/** Admins see email here (and only here) so they can tell two people with the same first name apart. */
export const users = adminQuery({
  args: {},
  returns: v.array(
    v.object({
      id: v.id("users"),
      firstName: v.string(),
      email: v.optional(v.string()),
      role: vRole,
      isTrustedLender: v.boolean(),
      listings: v.number(),
      isMe: v.boolean(),
    }),
  ),
  handler: async (ctx) => {
    const users = await ctx.db.query("users").take(LIMITS.listMax);
    return await Promise.all(
      users.map(async (user) => ({
        id: user._id,
        firstName: user.firstName,
        email: user.email,
        role: user.role,
        isTrustedLender: user.trustedLenderSince !== undefined,
        listings: (
          await ctx.db
            .query("tools")
            .withIndex("by_ownerId_and_status", (q) => q.eq("ownerId", user._id).eq("status", "listed"))
            .take(LIMITS.listMax)
        ).length,
        isMe: user._id === ctx.viewer._id,
      })),
    );
  },
});

export const setTrustedLender = adminMutation({
  args: { userId: v.id("users"), trusted: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { userId, trusted }) => {
    const user = await ctx.db.get("users", userId);
    if (!user) throw appError("NOT_FOUND", "That user doesn't exist.");
    if (trusted === (user.trustedLenderSince !== undefined)) return null;
    await ctx.db.patch("users", userId, { trustedLenderSince: trusted ? Date.now() : undefined });
    await audit(ctx, {
      actorId: ctx.viewer._id,
      action: trusted ? "user.trusted_lender_granted" : "user.trusted_lender_revoked",
      targetId: userId,
    });
    return null;
  },
});

export const automationHealth = adminQuery({
  args: {},
  returns: v.object({
    failedDeliveries: v.array(
      v.object({
        id: v.id("outbox"),
        eventId: v.string(),
        loanId: v.id("loans"),
        loanStatus: vLoanStatus,
        attempts: v.number(),
        lastError: v.optional(v.string()),
        lastStatusCode: v.optional(v.number()),
        at: v.number(),
      }),
    ),
    pendingDeliveries: v.number(),
    skippedDeliveries: v.number(),
    failedReminders: v.array(
      v.object({ reminderKey: v.string(), error: v.optional(v.string()), at: v.number() }),
    ),
    openIncidents: v.array(
      v.object({
        id: v.id("automationIncidents"),
        workflow: v.string(),
        node: v.optional(v.string()),
        message: v.string(),
        executionId: v.optional(v.string()),
        occurredAt: v.number(),
      }),
    ),
  }),
  handler: async (ctx) => {
    const byStatus = (status: Doc<"outbox">["status"]) =>
      ctx.db
        .query("outbox")
        .withIndex("by_status", (q) => q.eq("status", status))
        .order("desc")
        .take(50);
    const [failed, pending, skipped, failedReminders, incidents] = await Promise.all([
      byStatus("failed"),
      byStatus("pending"),
      byStatus("skipped"),
      ctx.db
        .query("reminders")
        .withIndex("by_status", (q) => q.eq("status", "failed"))
        .order("desc")
        .take(20),
      ctx.db
        .query("automationIncidents")
        .withIndex("by_resolvedAt", (q) => q.eq("resolvedAt", undefined))
        .order("desc")
        .take(20),
    ]);
    return {
      failedDeliveries: failed.map((row) => ({
        id: row._id,
        eventId: eventIdFor(row._id),
        loanId: row.loanId,
        loanStatus: row.loanStatus,
        attempts: row.attempts,
        lastError: row.lastError,
        lastStatusCode: row.lastStatusCode,
        at: row.lastAttemptAt ?? row._creationTime,
      })),
      pendingDeliveries: pending.length,
      skippedDeliveries: skipped.length,
      failedReminders: failedReminders.map((row) => ({
        reminderKey: row.reminderKey,
        error: row.error,
        at: row.claimedAt,
      })),
      openIncidents: incidents.map((row) => ({
        id: row._id,
        workflow: row.workflow,
        node: row.node,
        message: row.message,
        executionId: row.executionId,
        occurredAt: row.occurredAt,
      })),
    };
  },
});

/** Re-queue a dead-lettered notification, e.g. after fixing n8n. Keeps the same event id. */
export const retryDelivery = adminMutation({
  args: { outboxId: v.id("outbox") },
  returns: v.null(),
  handler: async (ctx, { outboxId }) => {
    const row = await ctx.db.get("outbox", outboxId);
    if (!row) throw appError("NOT_FOUND", "That delivery doesn't exist.");
    if (row.status !== "failed" && row.status !== "skipped") {
      throw appError("CONFLICT", `That delivery is ${row.status}, not failed.`);
    }
    await ctx.db.patch("outbox", outboxId, { status: "pending", attempts: 0, nextAttemptAt: undefined });
    await ctx.scheduler.runAfter(0, internal.automation.deliverNotification, { outboxId });
    await audit(ctx, { actorId: ctx.viewer._id, action: "automation.delivery_retried", targetId: outboxId });
    return null;
  },
});

export const resolveIncident = adminMutation({
  args: { incidentId: v.id("automationIncidents") },
  returns: v.null(),
  handler: async (ctx, { incidentId }) => {
    const incident = await ctx.db.get("automationIncidents", incidentId);
    if (!incident) throw appError("NOT_FOUND", "That incident doesn't exist.");
    if (incident.resolvedAt !== undefined) return null;
    await ctx.db.patch("automationIncidents", incidentId, { resolvedAt: Date.now() });
    await audit(ctx, {
      actorId: ctx.viewer._id,
      action: "automation.incident_resolved",
      targetId: incidentId,
    });
    return null;
  },
});

export const auditLog = adminQuery({
  args: {},
  returns: v.array(
    v.object({
      id: v.id("auditLog"),
      at: v.number(),
      actor: v.string(),
      action: vAuditAction,
      targetId: v.string(),
      details: v.optional(v.string()),
    }),
  ),
  handler: async (ctx) => {
    const entries = await ctx.db.query("auditLog").order("desc").take(100);
    const names = new Map<string, string>();
    return await Promise.all(
      entries.map(async (entry) => {
        let actor = "system";
        if (entry.actorId) {
          if (!names.has(entry.actorId)) {
            names.set(entry.actorId, (await ctx.db.get("users", entry.actorId))?.firstName ?? "Unknown");
          }
          actor = names.get(entry.actorId) ?? "Unknown";
        }
        return {
          id: entry._id,
          at: entry._creationTime,
          actor,
          action: entry.action,
          targetId: entry.targetId,
          details: entry.details,
        };
      }),
    );
  },
});

/**
 * Grant or revoke admin. Internal: not callable from any client, only by an
 * operator with deploy access, e.g.
 *   npx convex run admin:setRole '{"email":"you@example.com","role":"admin"}'
 */
export const setRole = internalMutation({
  args: { email: v.string(), role: vRole },
  returns: v.string(),
  handler: async (ctx, { email, role }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email.trim()))
      .unique();
    if (!user) {
      throw new Error(`No user with email ${email}. Sign in once with that account first.`);
    }
    if (user.role !== role) {
      await ctx.db.patch("users", user._id, { role });
      await audit(ctx, {
        actorId: undefined,
        action: "user.role_changed",
        targetId: user._id,
        details: `â†’ ${role}`,
      });
    }
    return `${user.firstName} is now ${role}.`;
  },
});
