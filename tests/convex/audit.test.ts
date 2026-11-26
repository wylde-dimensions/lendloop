import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { GENESIS_HASH } from "../../convex/model/audit";
import {
  ADMIN,
  ALICE,
  expectAppError,
  freezeTime,
  listTool,
  makeAdmin,
  setup,
  signIn,
  type T,
} from "./setup";

beforeEach(() => freezeTime());
afterEach(() => vi.useRealTimers());

/** Alice lists three tools and deletes one; making Ada admin is audited too: 5 entries. */
async function activity(t: T) {
  const alice = await signIn(t, ALICE);
  const admin = await signIn(t, ADMIN);
  await makeAdmin(t, ADMIN.email);
  const ids = [
    await listTool(alice, { name: "A" }),
    await listTool(alice, { name: "B" }),
    await listTool(alice, { name: "C" }),
  ];
  await alice.mutation(api.tools.remove, { toolId: ids[1] });
  return { alice, admin };
}

const chain = (t: T) => t.run(async (ctx) => await ctx.db.query("auditLog").withIndex("by_seq").collect());

describe("audit log hash chain", () => {
  test("every entry links to the one before it, and the chain verifies", async () => {
    const t = setup();
    const { admin } = await activity(t);

    const entries = await chain(t);
    expect(entries.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(entries[0].prevHash).toBe(GENESIS_HASH);
    for (let i = 1; i < entries.length; i++) expect(entries[i].prevHash).toBe(entries[i - 1].hash);

    expect(await admin.query(api.admin.auditIntegrity, {})).toEqual({ checked: 5, intact: true, lastSeq: 5 });
    expect(await t.query(internal.admin.verifyAuditChain, {})).toEqual({
      checked: 5,
      intact: true,
      lastSeq: 5,
    });
    // Paging from the middle verifies against the entry it starts after.
    expect(await t.query(internal.admin.verifyAuditChain, { afterSeq: 2 })).toEqual({
      checked: 3,
      intact: true,
      lastSeq: 5,
    });
  });

  test("editing an entry is detected at that entry", async () => {
    const t = setup();
    const { admin } = await activity(t);
    await t.run(async (ctx) => {
      const third = (await ctx.db
        .query("auditLog")
        .withIndex("by_seq", (q) => q.eq("seq", 3))
        .unique())!;
      await ctx.db.patch("auditLog", third._id, { action: "tool.deleted" });
    });
    expect(await admin.query(api.admin.auditIntegrity, {})).toMatchObject({ intact: false, brokenAtSeq: 3 });
    expect(await t.query(internal.admin.verifyAuditChain, {})).toMatchObject({
      intact: false,
      brokenAtSeq: 3,
    });
  });

  test("deleting an entry is detected at the entry after the gap", async () => {
    const t = setup();
    const { admin } = await activity(t);
    await t.run(async (ctx) => {
      const second = (await ctx.db
        .query("auditLog")
        .withIndex("by_seq", (q) => q.eq("seq", 2))
        .unique())!;
      await ctx.db.delete("auditLog", second._id);
    });
    expect(await admin.query(api.admin.auditIntegrity, {})).toMatchObject({ intact: false, brokenAtSeq: 3 });
  });

  test("recomputing one entry's hash after editing it still breaks the next link", async () => {
    const t = setup();
    const { admin } = await activity(t);
    await t.run(async (ctx) => {
      const { auditHash } = await import("../../convex/model/audit");
      const second = (await ctx.db
        .query("auditLog")
        .withIndex("by_seq", (q) => q.eq("seq", 2))
        .unique())!;
      const forged = { ...second, details: "forged" };
      await ctx.db.patch("auditLog", second._id, {
        details: "forged",
        hash: await auditHash(forged as typeof forged & { seq: number; prevHash: string; at: number }),
      });
    });
    expect(await admin.query(api.admin.auditIntegrity, {})).toMatchObject({ intact: false, brokenAtSeq: 3 });
  });

  test("only admins can check it", async () => {
    const t = setup();
    const { alice } = await activity(t);
    await expectAppError(alice.query(api.admin.auditIntegrity, {}), "FORBIDDEN");
  });
});
