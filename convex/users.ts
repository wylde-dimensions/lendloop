import { v } from "convex/values";
import type { UserIdentity } from "convex/server";
import { mutation } from "./_generated/server";
import { appError } from "./model/errors";
import { findViewer, publicQuery } from "./model/functions";
import { vRole } from "./model/validators";

const FIRST_NAME_MAX = 40;

function firstNameOf(identity: UserIdentity): string {
  const raw = identity.givenName ?? identity.name?.split(/\s+/)[0] ?? identity.nickname ?? "";
  const clean = raw
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, FIRST_NAME_MAX);
  return clean || "Neighbor";
}

/**
 * Create or refresh the signed-in person's row from their Clerk token.
 * Called by the client once per session, before any other authenticated call.
 * New users always start as "user"; nothing the client sends can set a role.
 * An unverified email is not stored, so notifications only go to proven inboxes.
 */
export const ensure = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw appError("UNAUTHENTICATED", "Sign in to continue.");

    const firstName = firstNameOf(identity);
    const email = identity.email && identity.emailVerified !== false ? identity.email : undefined;

    const existing = await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();

    if (!existing) {
      await ctx.db.insert("users", {
        tokenIdentifier: identity.tokenIdentifier,
        firstName,
        email,
        role: "user",
      });
    } else if (existing.firstName !== firstName || existing.email !== email) {
      await ctx.db.patch("users", existing._id, { firstName, email });
    }
    return null;
  },
});

/** The signed-in person as the UI needs them, or null before `ensure` has run. */
export const me = publicQuery({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      firstName: v.string(),
      role: vRole,
      isTrustedLender: v.boolean(),
    }),
  ),
  handler: async (ctx) => {
    const viewer = await findViewer(ctx);
    if (!viewer) return null;
    return {
      firstName: viewer.firstName,
      role: viewer.role,
      isTrustedLender: viewer.trustedLenderSince !== undefined,
    };
  },
});
