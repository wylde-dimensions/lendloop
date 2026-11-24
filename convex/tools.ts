import { v } from "convex/values";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { appError } from "./model/errors";
import { audit } from "./model/audit";
import { publicQuery, userMutation, userQuery } from "./model/functions";
import { today as appToday } from "./model/config";
import { approvedLoansFor, availabilityFrom } from "./model/availability";
import { closeLoansForRemovedTool } from "./model/loans";
import { LIMITS, type Category, type Condition } from "./model/constants";
import { vAvailability, vCategory, vCondition } from "./model/validators";
import { rateLimiter } from "./rateLimits";

const toolInput = {
  name: v.string(),
  category: vCategory,
  condition: vCondition,
  description: v.string(),
};

type ToolInput = { name: string; category: Category; condition: Condition; description: string };

/** Trim, collapse whitespace, strip control characters and enforce length limits. */
function cleanToolInput(input: ToolInput): ToolInput {
  const name = input.name
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const description = input.description
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!name) throw appError("INVALID", "Give the tool a name.");
  if (name.length > LIMITS.toolNameMax) {
    throw appError("INVALID", `Keep the name under ${LIMITS.toolNameMax} characters.`);
  }
  if (description.length > LIMITS.descriptionMax) {
    throw appError("INVALID", `Keep the description under ${LIMITS.descriptionMax} characters.`);
  }
  return { name, category: input.category, condition: input.condition, description };
}

async function ownListedTool(
  ctx: QueryCtx,
  toolId: Id<"tools">,
  viewer: Doc<"users">,
): Promise<Doc<"tools">> {
  const tool = await ctx.db.get("tools", toolId);
  if (!tool || tool.status !== "listed") throw appError("NOT_FOUND", "That listing no longer exists.");
  if (tool.ownerId !== viewer._id) throw appError("FORBIDDEN", "You can only change your own listings.");
  return tool;
}

async function listedTools(ctx: QueryCtx, category: Category | undefined) {
  return await ctx.db
    .query("tools")
    .withIndex("by_status_and_category", (q) =>
      category ? q.eq("status", "listed").eq("category", category) : q.eq("status", "listed"),
    )
    .take(LIMITS.listMax);
}

/**
 * The signed-out landing page. Returns only name and category of tools that are
 * available today: no ids, owners, descriptions or dates leave the server.
 */
export const listPublic = publicQuery({
  args: {},
  returns: v.array(v.object({ name: v.string(), category: vCategory })),
  handler: async (ctx) => {
    const today = appToday();
    const tools = await listedTools(ctx, undefined);
    const withAvailability = await Promise.all(
      tools.map(async (tool) => ({
        tool,
        availability: availabilityFrom(await approvedLoansFor(ctx, tool._id), today),
      })),
    );
    return withAvailability
      .filter(({ availability }) => availability.state === "available")
      .map(({ tool }) => ({ name: tool.name, category: tool.category }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

const vToolCard = v.object({
  id: v.id("tools"),
  name: v.string(),
  category: vCategory,
  condition: vCondition,
  description: v.string(),
  owner: v.object({ firstName: v.string(), isTrustedLender: v.boolean() }),
  isMine: v.boolean(),
  availability: vAvailability,
  /** Approved date ranges from today on, so borrowers can pick free dates. No borrower details. */
  booked: v.array(v.object({ startDate: v.string(), endDate: v.string() })),
  myRequest: v.union(
    v.null(),
    v.object({
      status: v.union(v.literal("requested"), v.literal("approved")),
      startDate: v.string(),
      endDate: v.string(),
    }),
  ),
  pendingRequests: v.number(),
});

/** All listed tools for signed-in neighbors, optionally filtered by category. */
export const list = userQuery({
  args: { category: v.optional(vCategory), mineOnly: v.optional(v.boolean()) },
  returns: v.array(vToolCard),
  handler: async (ctx, { category, mineOnly }) => {
    const { viewer } = ctx;
    const today = appToday();

    const tools = mineOnly
      ? await ctx.db
          .query("tools")
          .withIndex("by_ownerId_and_status", (q) => q.eq("ownerId", viewer._id).eq("status", "listed"))
          .take(LIMITS.listMax)
      : await listedTools(ctx, category);

    const myOpenLoans = (
      await Promise.all(
        (["requested", "approved"] as const).map((status) =>
          ctx.db
            .query("loans")
            .withIndex("by_borrowerId_and_status", (q) => q.eq("borrowerId", viewer._id).eq("status", status))
            .take(LIMITS.listMax),
        ),
      )
    ).flat();

    const owners = new Map<Id<"users">, Doc<"users"> | null>();
    const ownerOf = async (id: Id<"users">) => {
      if (!owners.has(id)) owners.set(id, await ctx.db.get("users", id));
      return owners.get(id) ?? null;
    };

    const cards = await Promise.all(
      tools.map(async (tool) => {
        const [owner, approved] = await Promise.all([ownerOf(tool.ownerId), approvedLoansFor(ctx, tool._id)]);
        const isMine = tool.ownerId === viewer._id;
        const pendingRequests = isMine
          ? (
              await ctx.db
                .query("loans")
                .withIndex("by_toolId_and_status", (q) => q.eq("toolId", tool._id).eq("status", "requested"))
                .take(100)
            ).length
          : 0;
        const mine = myOpenLoans
          .filter((loan) => loan.toolId === tool._id && loan.endDate >= today)
          .sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
        return {
          id: tool._id,
          name: tool.name,
          category: tool.category,
          condition: tool.condition,
          description: tool.description,
          owner: {
            firstName: owner?.firstName ?? "Neighbor",
            isTrustedLender: owner?.trustedLenderSince !== undefined,
          },
          isMine,
          availability: availabilityFrom(approved, today),
          booked: approved
            .filter((loan) => loan.endDate >= today)
            .sort((a, b) => a.startDate.localeCompare(b.startDate))
            .map(({ startDate, endDate }) => ({ startDate, endDate })),
          myRequest:
            mine && (mine.status === "requested" || mine.status === "approved")
              ? { status: mine.status, startDate: mine.startDate, endDate: mine.endDate }
              : null,
          pendingRequests,
        };
      }),
    );
    return cards.sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const create = userMutation({
  args: toolInput,
  returns: v.id("tools"),
  handler: async (ctx, args) => {
    const { viewer } = ctx;
    await rateLimiter.limit(ctx, "createListing", { key: viewer._id, throws: true });
    const input = cleanToolInput(args);
    const toolId = await ctx.db.insert("tools", { ...input, ownerId: viewer._id, status: "listed" });
    await audit(ctx, { actorId: viewer._id, action: "tool.created", targetId: toolId });
    return toolId;
  },
});

export const update = userMutation({
  args: { toolId: v.id("tools"), ...toolInput },
  returns: v.null(),
  handler: async (ctx, { toolId, ...args }) => {
    const { viewer } = ctx;
    const tool = await ownListedTool(ctx, toolId, viewer);
    const input = cleanToolInput(args);
    const changed = (Object.keys(input) as (keyof ToolInput)[]).filter((key) => input[key] !== tool[key]);
    if (changed.length === 0) return null;
    await ctx.db.patch("tools", toolId, input);
    await audit(ctx, {
      actorId: viewer._id,
      action: "tool.updated",
      targetId: toolId,
      details: `changed: ${changed.join(", ")}`,
    });
    return null;
  },
});

/**
 * Delete your own listing. Refused while the tool is out on loan; pending
 * requests and future bookings are cancelled and those borrowers notified.
 */
export const remove = userMutation({
  args: { toolId: v.id("tools") },
  returns: v.null(),
  handler: async (ctx, { toolId }) => {
    const { viewer } = ctx;
    const tool = await ownListedTool(ctx, toolId, viewer);
    const today = appToday();
    const availability = availabilityFrom(await approvedLoansFor(ctx, toolId), today);
    if (availability.state === "on_loan") {
      throw appError("CONFLICT", "This tool is out on loan. Mark it returned before deleting it.");
    }
    await closeLoansForRemovedTool(ctx, tool, today, viewer._id);
    await ctx.db.patch("tools", toolId, { status: "removed", removedAt: Date.now() });
    await audit(ctx, { actorId: viewer._id, action: "tool.deleted", targetId: toolId });
    return null;
  },
});
