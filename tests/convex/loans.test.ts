import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import {
  ALICE,
  BOB,
  CARA,
  expectAppError,
  freezeTime,
  listTool,
  outboxRows,
  setup,
  signIn,
  TODAY,
} from "./setup";

beforeEach(() => freezeTime());
afterEach(() => vi.useRealTimers());

async function neighbors() {
  const t = setup();
  const alice = await signIn(t, ALICE); // lender
  const bob = await signIn(t, BOB); // borrower
  const cara = await signIn(t, CARA); // another borrower
  const toolId = await listTool(alice);
  return { t, alice, bob, cara, toolId };
}

describe("requesting a loan", () => {
  test("rejects impossible dates and borrowing your own tool", async () => {
    const { alice, bob, toolId } = await neighbors();
    const ask = (startDate: string, endDate: string) =>
      bob.mutation(api.loans.request, { toolId, startDate, endDate });

    await expectAppError(ask("2026-06-09", "2026-06-11"), "INVALID"); // starts in the past
    await expectAppError(ask("2026-06-12", "2026-06-11"), "INVALID"); // ends before it starts
    await expectAppError(ask("2026-06-11", "2026-07-11"), "INVALID"); // 31 days
    await expectAppError(ask("2026-13-01", "2026-13-02"), "INVALID"); // not a date
    await expectAppError(
      alice.mutation(api.loans.request, { toolId, startDate: TODAY, endDate: TODAY }),
      "INVALID",
    );
  });

  test("notifies the lender through the outbox, in the same transaction", async () => {
    const { t, bob, toolId } = await neighbors();
    const loanId = await bob.mutation(api.loans.request, {
      toolId,
      startDate: "2026-06-12",
      endDate: "2026-06-14",
    });
    const rows = await outboxRows(t);
    expect(rows).toMatchObject([
      { loanId, loanStatus: "requested", recipientRole: "lender", status: "pending" },
    ]);
  });

  test("refuses a second pending request for the same tool", async () => {
    const { bob, toolId } = await neighbors();
    await bob.mutation(api.loans.request, { toolId, startDate: "2026-06-12", endDate: "2026-06-14" });
    await expectAppError(
      bob.mutation(api.loans.request, { toolId, startDate: "2026-06-20", endDate: "2026-06-21" }),
      "CONFLICT",
    );
  });
});

describe("the lender's decision", () => {
  test("only the lender can approve, and approval closes overlapping requests", async () => {
    const { t, alice, bob, cara, toolId } = await neighbors();
    const bobs = await bob.mutation(api.loans.request, {
      toolId,
      startDate: "2026-06-12",
      endDate: "2026-06-14",
    });
    const caras = await cara.mutation(api.loans.request, {
      toolId,
      startDate: "2026-06-14",
      endDate: "2026-06-15",
    });

    // Someone outside the loan can't even tell it exists.
    await expectAppError(cara.mutation(api.loans.approve, { loanId: bobs }), "NOT_FOUND");
    await expectAppError(bob.mutation(api.loans.approve, { loanId: bobs }), "NOT_FOUND");

    await alice.mutation(api.loans.approve, { loanId: bobs });

    const [bobView] = await bob.query(api.loans.borrowing, {});
    expect(bobView).toMatchObject({ status: "approved", counterpart: { firstName: "Alice" } });
    const [caraView] = await cara.query(api.loans.borrowing, {});
    expect(caraView).toMatchObject({ id: caras, status: "declined", closedReason: "dates_taken" });

    // Booked dates can't be requested again.
    await expectAppError(
      cara.mutation(api.loans.request, { toolId, startDate: "2026-06-13", endDate: "2026-06-13" }),
      "CONFLICT",
    );

    const notices = (await outboxRows(t)).map((row) => [row.loanStatus, row.recipientRole]);
    expect(notices).toEqual(
      expect.arrayContaining([
        ["approved", "borrower"],
        ["declined", "borrower"],
      ]),
    );
  });

  test("decline, cancel and return each belong to one party", async () => {
    const { alice, bob, toolId } = await neighbors();
    const first = await bob.mutation(api.loans.request, {
      toolId,
      startDate: "2026-06-12",
      endDate: "2026-06-12",
    });
    await expectAppError(bob.mutation(api.loans.decline, { loanId: first }), "NOT_FOUND");
    await expectAppError(alice.mutation(api.loans.cancel, { loanId: first }), "NOT_FOUND");
    await bob.mutation(api.loans.cancel, { loanId: first });
    await expectAppError(alice.mutation(api.loans.approve, { loanId: first }), "CONFLICT");

    const second = await bob.mutation(api.loans.request, { toolId, startDate: TODAY, endDate: "2026-06-11" });
    await expectAppError(alice.mutation(api.loans.markReturned, { loanId: second }), "CONFLICT");
    await alice.mutation(api.loans.approve, { loanId: second });
    await expectAppError(bob.mutation(api.loans.markReturned, { loanId: second }), "NOT_FOUND");
    await alice.mutation(api.loans.markReturned, { loanId: second });

    const lending = await alice.query(api.loans.lending, {});
    expect(lending.map((loan) => loan.status).sort()).toEqual(["cancelled", "returned"]);
  });
});

describe("availability", () => {
  test("a tool out on loan leaves the public list and can't be deleted", async () => {
    const { t, alice, bob, toolId } = await neighbors();
    const loanId = await bob.mutation(api.loans.request, { toolId, startDate: TODAY, endDate: "2026-06-12" });
    await alice.mutation(api.loans.approve, { loanId });

    expect(await t.query(api.tools.listPublic, {})).toEqual([]);
    const [card] = await bob.query(api.tools.list, {});
    expect(card.availability).toEqual({ state: "on_loan", until: "2026-06-12", overdue: false });
    expect(card.myRequest).toMatchObject({ status: "approved" });
    await expectAppError(alice.mutation(api.tools.remove, { toolId }), "CONFLICT");

    await alice.mutation(api.loans.markReturned, { loanId });
    expect(await t.query(api.tools.listPublic, {})).toHaveLength(1);
  });

  test("an overdue loan is flagged for both sides", async () => {
    const { alice, bob, toolId } = await neighbors();
    const loanId = await bob.mutation(api.loans.request, { toolId, startDate: TODAY, endDate: TODAY });
    await alice.mutation(api.loans.approve, { loanId });
    vi.setSystemTime(new Date("2026-06-13T12:00:00Z"));
    const [view] = await bob.query(api.loans.borrowing, {});
    expect(view.overdue).toBe(true);
    const [card] = await bob.query(api.tools.list, {});
    expect(card.availability).toEqual({ state: "on_loan", until: TODAY, overdue: true });
  });

  test("deleting a listing cancels future requests and tells each borrower", async () => {
    const { t, alice, bob, toolId } = await neighbors();
    const loanId = await bob.mutation(api.loans.request, {
      toolId,
      startDate: "2026-06-20",
      endDate: "2026-06-21",
    });
    await alice.mutation(api.tools.remove, { toolId });
    const [view] = await bob.query(api.loans.borrowing, {});
    expect(view).toMatchObject({
      id: loanId,
      status: "cancelled",
      closedReason: "listing_removed",
      tool: { removed: true },
    });
    expect((await outboxRows(t)).find((row) => row.loanStatus === "cancelled")).toMatchObject({
      loanId,
      recipientRole: "borrower",
    });
  });
});

describe("data minimisation in loan views", () => {
  test("the other party appears by first name only", async () => {
    const { alice, bob, toolId } = await neighbors();
    await bob.mutation(api.loans.request, { toolId, startDate: "2026-06-12", endDate: "2026-06-12" });
    const [incoming] = await alice.query(api.loans.lending, {});
    expect(incoming.counterpart).toEqual({ firstName: "Bob", isTrustedLender: false });
    expect(JSON.stringify(incoming)).not.toContain("@example.com");
  });
});
