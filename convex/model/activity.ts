import type { Infer } from "convex/values";
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { vActivity } from "./validators";

export type Activity = Infer<typeof vActivity>;

const NOTICE: Record<Doc<"loans">["status"], string> = {
  requested: "New request",
  approved: "Approval",
  declined: "Decline",
  cancelled: "Cancellation",
  returned: "Return receipt",
};

function fromOutbox(row: Doc<"outbox">): Activity {
  const label = `${NOTICE[row.loanStatus]} sent to the ${row.recipientRole}`;
  switch (row.status) {
    case "delivered":
      return { kind: "notification", status: "sent", label, at: row.deliveredAt ?? row._creationTime };
    case "failed":
      return {
        kind: "notification",
        status: "failed",
        label: `${NOTICE[row.loanStatus]} to the ${row.recipientRole} failed`,
        at: row.lastAttemptAt ?? row._creationTime,
      };
    case "skipped":
      return {
        kind: "notification",
        status: "skipped",
        label: `${NOTICE[row.loanStatus]} not sent (automation off)`,
        at: row.lastAttemptAt ?? row._creationTime,
      };
    case "pending":
      return {
        kind: "notification",
        status: row.attempts > 0 ? "retrying" : "queued",
        label:
          row.attempts > 0
            ? `${NOTICE[row.loanStatus]} to the ${row.recipientRole}: retrying (attempt ${row.attempts + 1})`
            : `${NOTICE[row.loanStatus]} to the ${row.recipientRole} queued`,
        at: row.lastAttemptAt ?? row._creationTime,
      };
  }
}

function fromReminder(row: Doc<"reminders">): Activity {
  switch (row.status) {
    case "sent":
      return {
        kind: "reminder",
        status: "sent",
        label: "Overdue reminder sent",
        at: row.sentAt ?? row.claimedAt,
      };
    case "failed":
      return { kind: "reminder", status: "failed", label: "Overdue reminder failed", at: row.claimedAt };
    case "sending":
      return { kind: "reminder", status: "sending", label: "Overdue reminder sending", at: row.claimedAt };
  }
}

/** Newest first. Callers must already have checked the viewer may see this loan. */
export async function loanActivity(ctx: QueryCtx, loanId: Id<"loans">): Promise<Activity[]> {
  const [outbox, reminders] = await Promise.all([
    ctx.db
      .query("outbox")
      .withIndex("by_loanId", (q) => q.eq("loanId", loanId))
      .take(20),
    ctx.db
      .query("reminders")
      .withIndex("by_loanId", (q) => q.eq("loanId", loanId))
      .take(20),
  ]);
  return [...outbox.map(fromOutbox), ...reminders.map(fromReminder)].sort((a, b) => b.at - a.at).slice(0, 10);
}
