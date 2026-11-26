import { customCtx, customMutation, customQuery } from "convex-helpers/server/customFunctions";
import type { UserIdentity } from "convex/server";
import { mutation, query, type QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { adminMfaRequired } from "./config";
import { appError } from "./errors";

/**
 * Every public function goes through one of these builders, so authentication
 * and role checks live in one place and cannot be forgotten in a handler.
 *
 *   publicQuery  - anyone, including signed-out visitors (only the public tool list)
 *   userQuery / userMutation   - any signed-in, provisioned user; handlers get ctx.viewer
 *   adminQuery / adminMutation - role "admin" only, plus a second factor where
 *                                LENDLOOP_ADMIN_REQUIRE_MFA is on
 *
 * The role comes from our own users table, not from a client-supplied value or
 * a JWT claim, and can only be changed by an internal function (see admin.ts).
 */

export async function findViewer(ctx: QueryCtx): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return await ctx.db
    .query("users")
    .withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
}

/**
 * Whether this session passed a second factor. Clerk's session token carries
 * `fva`: [minutes since the first factor, minutes since the second factor], with
 * -1 for a factor never verified. A missing or malformed claim counts as no.
 */
export function passedSecondFactor(identity: UserIdentity): boolean {
  const fva = identity.fva;
  return Array.isArray(fva) && typeof fva[1] === "number" && fva[1] >= 0;
}

/** True when the viewer is an admin who must add a second factor before admin functions work. */
export function adminNeedsSecondFactor(identity: UserIdentity, viewer: Doc<"users">): boolean {
  return viewer.role === "admin" && adminMfaRequired() && !passedSecondFactor(identity);
}

async function requireViewer(ctx: QueryCtx): Promise<{ identity: UserIdentity; viewer: Doc<"users"> }> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw appError("UNAUTHENTICATED", "Sign in to continue.");
  const viewer = await ctx.db
    .query("users")
    .withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
  if (!viewer) {
    throw appError("NOT_PROVISIONED", "Your account is still being set up. Try again in a moment.");
  }
  return { identity, viewer };
}

async function requireAdmin(ctx: QueryCtx): Promise<Doc<"users">> {
  const { identity, viewer } = await requireViewer(ctx);
  if (viewer.role !== "admin") throw appError("FORBIDDEN", "Only admins can do that.");
  if (adminNeedsSecondFactor(identity, viewer)) {
    throw appError(
      "MFA_REQUIRED",
      "Admin actions need two-step verification. Turn it on in your account, then sign in again.",
    );
  }
  return viewer;
}

export const publicQuery = query;

export const userQuery = customQuery(
  query,
  customCtx(async (ctx) => ({ viewer: (await requireViewer(ctx)).viewer })),
);

export const userMutation = customMutation(
  mutation,
  customCtx(async (ctx) => ({ viewer: (await requireViewer(ctx)).viewer })),
);

export const adminQuery = customQuery(
  query,
  customCtx(async (ctx) => ({ viewer: await requireAdmin(ctx) })),
);

export const adminMutation = customMutation(
  mutation,
  customCtx(async (ctx) => ({ viewer: await requireAdmin(ctx) })),
);
