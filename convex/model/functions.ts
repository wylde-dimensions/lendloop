import { customCtx, customMutation, customQuery } from "convex-helpers/server/customFunctions";
import { mutation, query, type QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { appError } from "./errors";

/**
 * Every public function goes through one of these builders, so authentication
 * and role checks live in one place and cannot be forgotten in a handler.
 *
 *   publicQuery  - anyone, including signed-out visitors (only the public tool list)
 *   userQuery / userMutation   - any signed-in, provisioned user; handlers get ctx.viewer
 *   adminQuery / adminMutation - role "admin" only
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

async function requireViewer(ctx: QueryCtx): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw appError("UNAUTHENTICATED", "Sign in to continue.");
  const viewer = await ctx.db
    .query("users")
    .withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
  if (!viewer) {
    throw appError("NOT_PROVISIONED", "Your account is still being set up. Try again in a moment.");
  }
  return viewer;
}

async function requireAdmin(ctx: QueryCtx): Promise<Doc<"users">> {
  const viewer = await requireViewer(ctx);
  if (viewer.role !== "admin") throw appError("FORBIDDEN", "Only admins can do that.");
  return viewer;
}

export const publicQuery = query;

export const userQuery = customQuery(
  query,
  customCtx(async (ctx) => ({ viewer: await requireViewer(ctx) })),
);

export const userMutation = customMutation(
  mutation,
  customCtx(async (ctx) => ({ viewer: await requireViewer(ctx) })),
);

export const adminQuery = customQuery(
  query,
  customCtx(async (ctx) => ({ viewer: await requireAdmin(ctx) })),
);

export const adminMutation = customMutation(
  mutation,
  customCtx(async (ctx) => ({ viewer: await requireAdmin(ctx) })),
);
