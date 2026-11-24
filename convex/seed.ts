import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { today as appToday } from "./model/config";
import { addDays } from "./model/dates";
import { enqueueLoanNotification } from "./model/outbox";
import type { Category, Condition } from "./model/constants";

/**
 * Demo neighborhood for local review: `npm run seed`. Internal, so only someone
 * with the deployment's admin key can run it, and idempotent (does nothing if
 * the demo neighbors exist). Demo people use @lendloop.example addresses, which
 * land in Mailpit locally, and cannot sign in.
 *
 * It also exercises both automations straight away: Jordan's pending request
 * queues a notification to Priya, and Sam's overdue pressure washer is what
 * the daily reminder workflow picks up.
 */
export const demo = internalMutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", "priya@lendloop.example"))
      .unique();
    if (existing) return "Demo data already present; nothing to do.";

    const today = appToday();
    const person = async (firstName: string, trusted = false) =>
      await ctx.db.insert("users", {
        tokenIdentifier: `seed|${firstName.toLowerCase()}`,
        firstName,
        email: `${firstName.toLowerCase()}@lendloop.example`,
        role: "user",
        trustedLenderSince: trusted ? Date.now() : undefined,
      });
    const priya = await person("Priya", true);
    const sam = await person("Sam");
    const jordan = await person("Jordan");
    const mei = await person("Mei");

    const tool = async (
      ownerId: Id<"users">,
      name: string,
      category: Category,
      condition: Condition,
      description: string,
    ) => await ctx.db.insert("tools", { ownerId, name, category, condition, description, status: "listed" });
    const drill = await tool(
      priya,
      "Cordless drill",
      "power_tools",
      "good",
      "18V with two batteries and a bit set.",
    );
    await tool(
      priya,
      "6 ft step ladder",
      "ladders_moving",
      "fair",
      "Aluminium. A bit wobbly on the top step.",
    );
    const washer = await tool(
      priya,
      "Pressure washer",
      "power_tools",
      "like_new",
      "Electric, 2000 PSI. Hose included.",
    );
    const tent = await tool(
      sam,
      "Four-person tent",
      "camping",
      "good",
      "Takes ten minutes to pitch. Footprint included.",
    );
    await tool(sam, "Stand mixer", "kitchen", "like_new", "With dough hook and whisk.");
    await tool(jordan, "Hedge trimmer", "garden", "good", "Cordless. Battery lasts about 40 minutes.");
    await tool(jordan, "Carpet cleaner", "cleaning", "well_used", "Works well; bring your own solution.");
    await tool(mei, "Socket set", "hand_tools", "good", "Metric and imperial, 40 pieces.");

    await ctx.db.insert("loans", {
      toolId: washer,
      lenderId: priya,
      borrowerId: sam,
      startDate: addDays(today, -6),
      endDate: addDays(today, -3),
      status: "approved",
      decidedAt: Date.now(),
    });
    await ctx.db.insert("loans", {
      toolId: tent,
      lenderId: sam,
      borrowerId: mei,
      startDate: addDays(today, -14),
      endDate: addDays(today, -10),
      status: "returned",
      decidedAt: Date.now(),
      returnedAt: Date.now(),
    });
    const requestId = await ctx.db.insert("loans", {
      toolId: drill,
      lenderId: priya,
      borrowerId: jordan,
      startDate: addDays(today, 5),
      endDate: addDays(today, 7),
      status: "requested",
    });
    const request = await ctx.db.get("loans", requestId);
    if (request) await enqueueLoanNotification(ctx, request, "lender");

    return "Seeded 4 neighbors, 8 tools, 3 loans (1 overdue, 1 pending with a queued notification).";
  },
});
