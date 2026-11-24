import type { Infer } from "convex/values";
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import type { vAuditAction } from "./validators";

export type AuditAction = Infer<typeof vAuditAction>;

/**
 * Append an audit entry in the same transaction as the change it describes.
 * `details` is a short machine-readable note (ids, statuses), never personal data.
 */
export async function audit(
  ctx: MutationCtx,
  entry: {
    actorId: Id<"users"> | undefined;
    action: AuditAction;
    targetId: string;
    details?: string;
  },
): Promise<void> {
  await ctx.db.insert("auditLog", entry);
}
