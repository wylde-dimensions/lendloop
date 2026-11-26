import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { ADMIN, ALICE, BOB, expectAppError, freezeTime, listTool, makeAdmin, setup, signIn } from "./setup";

beforeEach(() => freezeTime());
afterEach(() => vi.useRealTimers());

const adaId = (t: ReturnType<typeof setup>) =>
  t.run(
    async (ctx) =>
      (await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", ADMIN.email))
        .unique())!._id,
  );

describe("signed-out visitors", () => {
  test("see only the name and category of available tools", async () => {
    const t = setup();
    const alice = await signIn(t, ALICE);
    await listTool(alice, { name: "Hedge trimmer", category: "garden", description: "Call before noon" });

    const tools = await t.query(api.tools.listPublic, {});
    expect(tools).toEqual([{ name: "Hedge trimmer", category: "garden" }]);
    // No ids, owners, descriptions or conditions leave the server.
    expect(Object.keys(tools[0]).sort()).toEqual(["category", "name"]);
  });

  test("cannot call anything that needs an account", async () => {
    const t = setup();
    await expectAppError(t.query(api.tools.list, {}), "UNAUTHENTICATED");
    await expectAppError(t.query(api.loans.borrowing, {}), "UNAUTHENTICATED");
    await expectAppError(
      t.mutation(api.tools.create, { name: "x", category: "garden", condition: "good", description: "" }),
      "UNAUTHENTICATED",
    );
    await expect(t.query(api.users.me, {})).resolves.toBeNull();
  });
});

describe("account provisioning", () => {
  test("a token without a users row is refused until ensure() runs", async () => {
    const t = setup();
    const stranger = t.withIdentity(BOB);
    await expectAppError(stranger.query(api.tools.list, {}), "NOT_PROVISIONED");
    await stranger.mutation(api.users.ensure, {});
    await expect(stranger.query(api.tools.list, {})).resolves.toEqual([]);
  });

  test("new users are never admins, and unverified emails are not stored", async () => {
    const t = setup();
    const as = await signIn(t, { ...BOB, emailVerified: false });
    expect(await as.query(api.users.me, {})).toEqual({
      firstName: "Bob",
      role: "user",
      isTrustedLender: false,
      adminNeedsMfa: false,
    });
    const stored = await t.run(async (ctx) => await ctx.db.query("users").first());
    expect(stored?.email).toBeUndefined();
  });
});

describe("listing ownership", () => {
  test("only the owner can edit or delete a listing", async () => {
    const t = setup();
    const alice = await signIn(t, ALICE);
    const bob = await signIn(t, BOB);
    const toolId = await listTool(alice);

    const edit = {
      toolId,
      name: "Drill",
      category: "power_tools" as const,
      condition: "fair" as const,
      description: "",
    };
    await expectAppError(bob.mutation(api.tools.update, edit), "FORBIDDEN");
    await expectAppError(bob.mutation(api.tools.remove, { toolId }), "FORBIDDEN");

    await alice.mutation(api.tools.update, edit);
    await alice.mutation(api.tools.remove, { toolId });
    expect(await t.query(api.tools.listPublic, {})).toEqual([]);
  });

  test("input is cleaned and length-limited on the server", async () => {
    const t = setup();
    const alice = await signIn(t, ALICE);
    const id = await listTool(alice, { name: "  Big\t\tladder \u0007 " });
    const tool = await t.run(async (ctx) => await ctx.db.get("tools", id));
    expect(tool?.name).toBe("Big ladder");

    await expectAppError(listTool(alice, { name: "   " }), "INVALID");
    await expectAppError(listTool(alice, { name: "x".repeat(81) }), "INVALID");
    await expectAppError(listTool(alice, { description: "x".repeat(501) }), "INVALID");
  });

  test("listing creation is rate limited per user", async () => {
    const t = setup();
    const alice = await signIn(t, ALICE);
    for (let i = 0; i < 5; i++) await listTool(alice, { name: `Tool ${i}` });
    await expect(listTool(alice, { name: "One too many" })).rejects.toMatchObject({
      data: { kind: "RateLimited", name: "createListing" },
    });
    // Another user has their own bucket.
    const bob = await signIn(t, BOB);
    await expect(listTool(bob)).resolves.toBeTruthy();
  });
});

describe("admin role", () => {
  test("every admin function refuses regular users, enforced in Convex", async () => {
    const t = setup();
    const alice = await signIn(t, ALICE);
    const toolId = await listTool(alice);
    const aliceId = await t.run(async (ctx) => (await ctx.db.query("users").first())!._id);

    await expectAppError(alice.query(api.admin.listings, {}), "FORBIDDEN");
    await expectAppError(alice.query(api.admin.users, {}), "FORBIDDEN");
    await expectAppError(alice.query(api.admin.automationHealth, {}), "FORBIDDEN");
    await expectAppError(alice.query(api.admin.auditLog, {}), "FORBIDDEN");
    await expectAppError(
      alice.query(api.admin.loans, { paginationOpts: { numItems: 10, cursor: null } }),
      "FORBIDDEN",
    );
    await expectAppError(alice.mutation(api.admin.removeListing, { toolId }), "FORBIDDEN");
    await expectAppError(
      alice.mutation(api.admin.setTrustedLender, { userId: aliceId, trusted: true }),
      "FORBIDDEN",
    );
  });

  test("admins can remove any listing and mark Trusted Lenders, and both are audited", async () => {
    const t = setup();
    const alice = await signIn(t, ALICE);
    const admin = await signIn(t, ADMIN);
    await makeAdmin(t, ADMIN.email);
    const toolId = await listTool(alice);
    const aliceId = await t.run(
      async (ctx) =>
        (await ctx.db
          .query("users")
          .withIndex("by_email", (q) => q.eq("email", ALICE.email))
          .unique())!._id,
    );

    await admin.mutation(api.admin.setTrustedLender, { userId: aliceId, trusted: true });
    expect((await alice.query(api.users.me, {}))?.isTrustedLender).toBe(true);
    const cards = await admin.query(api.tools.list, {});
    expect(cards[0].owner).toEqual({ firstName: "Alice", isTrustedLender: true });

    await admin.mutation(api.admin.removeListing, { toolId, reason: "Duplicate listing" });
    expect(await admin.query(api.tools.list, {})).toEqual([]);

    const log = await admin.query(api.admin.auditLog, {});
    expect(log.map((entry) => entry.action)).toEqual(
      expect.arrayContaining(["user.role_changed", "user.trusted_lender_granted", "tool.removed_by_admin"]),
    );
    expect(log.find((entry) => entry.action === "tool.removed_by_admin")?.actor).toBe("Ada");
  });

  test("with LENDLOOP_ADMIN_REQUIRE_MFA on, admin functions need a session that passed a second factor", async () => {
    vi.stubEnv("LENDLOOP_ADMIN_REQUIRE_MFA", "true");
    try {
      const t = setup();
      await signIn(t, ADMIN);
      await makeAdmin(t, ADMIN.email);

      // Clerk's fva claim: [minutes since first factor, minutes since second factor]; -1 = never.
      for (const fva of [undefined, [3, -1], "3,1", [3]]) {
        const admin = t.withIdentity({ ...ADMIN, fva });
        await expectAppError(admin.query(api.admin.auditLog, {}), "MFA_REQUIRED");
        await expectAppError(
          admin.mutation(api.admin.setTrustedLender, { userId: await adaId(t), trusted: true }),
          "MFA_REQUIRED",
        );
        expect((await admin.query(api.users.me, {}))?.adminNeedsMfa).toBe(true);
      }

      const verified = t.withIdentity({ ...ADMIN, fva: [30, 2] });
      await expect(verified.query(api.admin.auditLog, {})).resolves.toBeTruthy();
      expect((await verified.query(api.users.me, {}))?.adminNeedsMfa).toBe(false);

      // Regular users are told FORBIDDEN, MFA or not; the flag is only for admins.
      const alice = await signIn(t, { ...ALICE, fva: [1, 1] });
      await expectAppError(alice.query(api.admin.auditLog, {}), "FORBIDDEN");
      expect((await t.withIdentity(ALICE).query(api.users.me, {}))?.adminNeedsMfa).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  test("with the setting off (local default), admins don't need a second factor", async () => {
    const t = setup();
    await signIn(t, ADMIN);
    await makeAdmin(t, ADMIN.email);
    const admin = t.withIdentity({ ...ADMIN, fva: [3, -1] });
    await expect(admin.query(api.admin.auditLog, {})).resolves.toBeTruthy();
    expect((await admin.query(api.users.me, {}))?.adminNeedsMfa).toBe(false);
  });

  test("the role can only be changed by an internal function", async () => {
    const t = setup();
    await signIn(t, BOB);
    // There is no public path: admin.setRole is internal, so it isn't on `api` at all.
    expect(Object.keys(api.admin)).not.toContain("setRole");
    await t.mutation(internal.admin.setRole, { email: BOB.email, role: "admin" });
    const bob = t.withIdentity(BOB);
    expect((await bob.query(api.users.me, {}))?.role).toBe("admin");
  });
});
