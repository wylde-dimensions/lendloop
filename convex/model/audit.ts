import type { Infer } from "convex/values";
import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { vAuditAction } from "./validators";

export type AuditAction = Infer<typeof vAuditAction>;

/** prevHash of the first entry. */
export const GENESIS_HASH = "0".repeat(64);

type Chained = {
  seq: number;
  prevHash: string;
  at: number;
  actorId?: Id<"users">;
  action: AuditAction;
  targetId: string;
  details?: string;
};

/** SHA-256 over every field of an entry, including the previous entry's hash. */
export async function auditHash(entry: Chained): Promise<string> {
  const canonical = JSON.stringify([
    entry.seq,
    entry.prevHash,
    entry.at,
    entry.actorId ?? null,
    entry.action,
    entry.targetId,
    entry.details ?? null,
  ]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Append an audit entry in the same transaction as the change it describes.
 * `details` is a short machine-readable note (ids, statuses), never personal data.
 *
 * Entries form a hash chain: each one stores the hash of the one before it, and
 * its own hash covers that link. Editing, deleting or reordering any entry breaks
 * every hash after it (see verifyChain). Convex transactions are serializable, so
 * two concurrent appends can't both claim the same `seq`: one retries.
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
  const last = await ctx.db
    .query("auditLog")
    .withIndex("by_seq", (q) => q.gte("seq", 1))
    .order("desc")
    .first();
  const chained: Chained = {
    seq: (last?.seq ?? 0) + 1,
    prevHash: last?.hash ?? GENESIS_HASH,
    at: Date.now(),
    actorId: entry.actorId,
    action: entry.action,
    targetId: entry.targetId,
    details: entry.details,
  };
  await ctx.db.insert("auditLog", { ...chained, hash: await auditHash(chained) });
}

export type ChainReport = {
  checked: number;
  intact: boolean;
  /** The first entry whose hash, link or sequence number doesn't check out. */
  brokenAtSeq?: number;
  lastSeq?: number;
};

/**
 * Check consecutive chained entries (ascending seq). `before` is the entry just
 * before the first one, or null when the list starts at seq 1.
 */
export async function verifyChain(
  entries: Doc<"auditLog">[],
  before: Doc<"auditLog"> | null,
): Promise<ChainReport> {
  let previous = before;
  for (const entry of entries) {
    const expectedSeq = previous?.seq !== undefined ? previous.seq + 1 : 1;
    const expectedPrev = previous?.hash ?? GENESIS_HASH;
    const ok =
      entry.seq === expectedSeq &&
      entry.prevHash === expectedPrev &&
      entry.at !== undefined &&
      entry.hash === (await auditHash(entry as Doc<"auditLog"> & Chained));
    if (!ok)
      return { checked: entries.indexOf(entry) + 1, intact: false, brokenAtSeq: entry.seq ?? expectedSeq };
    previous = entry;
  }
  return { checked: entries.length, intact: true, lastSeq: previous?.seq };
}
