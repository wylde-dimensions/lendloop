import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import { signedHeaders, verify } from "../../convex/model/signing";
import { MAX_DELIVERY_ATTEMPTS } from "../../convex/model/outbox";
import {
  ADMIN,
  ALICE,
  BOB,
  freezeTime,
  listTool,
  makeAdmin,
  outboxRows,
  setup,
  signIn,
  type T,
} from "./setup";

const WEBHOOK_URL = "https://n8n.test/webhook/lendloop/loan-events";
const CONVEX_TO_N8N = "convex-to-n8n-test-secret";
const N8N_TO_CONVEX = "n8n-to-convex-test-secret";

beforeEach(() => {
  freezeTime();
  vi.stubEnv("N8N_LOAN_EVENTS_WEBHOOK_URL", WEBHOOK_URL);
  vi.stubEnv("LENDLOOP_CONVEX_TO_N8N_SECRET", CONVEX_TO_N8N);
  vi.stubEnv("LENDLOOP_N8N_TO_CONVEX_SECRET", N8N_TO_CONVEX);
  vi.stubEnv("LENDLOOP_APP_URL", "https://lendloop.test");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

type Call = { url: string; headers: Record<string, string>; body: string };

function mockN8n(...statuses: (number | "network")[]) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, headers: init.headers as Record<string, string>, body: init.body as string });
      const status = statuses[Math.min(calls.length - 1, statuses.length - 1)];
      if (status === "network") throw new Error("connect ECONNREFUSED");
      return new Response("{}", { status });
    }),
  );
  return calls;
}

async function requestedLoan() {
  const t = setup();
  const alice = await signIn(t, ALICE);
  const bob = await signIn(t, BOB);
  const toolId = await listTool(alice, { name: "Pressure washer" });
  const loanId = await bob.mutation(api.loans.request, {
    toolId,
    startDate: "2026-06-12",
    endDate: "2026-06-13",
  });
  return { t, alice, bob, toolId, loanId };
}

const drain = (t: T) => t.finishAllScheduledFunctions(vi.runAllTimers);

describe("Convex → n8n notifications", () => {
  test("send a signed payload with only the fields the message needs", async () => {
    const calls = mockN8n(200);
    const { t, alice, loanId } = await requestedLoan();
    await drain(t);

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.url).toBe(WEBHOOK_URL);
    const payload = JSON.parse(call.body);
    expect(payload).toEqual({
      type: "loan.status_changed",
      eventId: expect.stringMatching(/^evt_/),
      occurredAt: expect.stringMatching(/^2026-06-10T12:00:00\.\d{3}Z$/),
      loan: {
        id: loanId,
        status: "requested",
        closedReason: null,
        startDate: "2026-06-12",
        endDate: "2026-06-13",
      },
      tool: { name: "Pressure washer" },
      recipient: { role: "lender", firstName: "Alice", email: "alice@example.com" },
      counterpart: { firstName: "Bob" },
      link: "https://lendloop.test/lending",
    });
    // The borrower's email and both last names stay in Convex.
    expect(call.body).not.toContain("bob@example.com");
    expect(call.body).not.toContain("Example");

    expect(call.headers["webhook-id"]).toBe(payload.eventId);
    const verdict = await verify({
      secrets: [CONVEX_TO_N8N],
      id: call.headers["webhook-id"],
      timestamp: call.headers["webhook-timestamp"],
      signature: call.headers["webhook-signature"],
      body: call.body,
    });
    expect(verdict).toEqual({ ok: true });

    expect(await outboxRows(t)).toMatchObject([{ status: "delivered", attempts: 1 }]);
    const [incoming] = await alice.query(api.loans.lending, {});
    expect(incoming.activity[0]).toMatchObject({
      kind: "notification",
      status: "sent",
      label: "New request sent to the lender",
    });
  });

  test("retry server errors with backoff, then dead-letter for an admin to retry", async () => {
    const calls = mockN8n(503);
    const { t } = await requestedLoan();
    await drain(t);
    expect(calls).toHaveLength(MAX_DELIVERY_ATTEMPTS);
    // Every retry reuses the same event id, so n8n can deduplicate.
    expect(new Set(calls.map((c) => c.headers["webhook-id"])).size).toBe(1);
    const [row] = await outboxRows(t);
    expect(row).toMatchObject({ status: "failed", attempts: MAX_DELIVERY_ATTEMPTS, lastStatusCode: 503 });

    const admin = await signIn(t, ADMIN);
    await makeAdmin(t, ADMIN.email);
    const health = await admin.query(api.admin.automationHealth, {});
    expect(health.failedDeliveries).toMatchObject([{ id: row._id, lastError: "n8n responded 503" }]);

    mockN8n(200);
    await admin.mutation(api.admin.retryDelivery, { outboxId: row._id });
    await drain(t);
    expect(await outboxRows(t)).toMatchObject([{ status: "delivered" }]);
  });

  test("a 4xx is a configuration problem: no retries", async () => {
    const calls = mockN8n(401);
    const { t } = await requestedLoan();
    await drain(t);
    expect(calls).toHaveLength(1);
    expect(await outboxRows(t)).toMatchObject([{ status: "failed", lastStatusCode: 401 }]);
  });

  test("network errors are retried and can recover", async () => {
    const calls = mockN8n("network", 200);
    const { t } = await requestedLoan();
    await drain(t);
    expect(calls).toHaveLength(2);
    expect(await outboxRows(t)).toMatchObject([{ status: "delivered", attempts: 2 }]);
  });

  test("with n8n not configured, notifications are recorded as skipped, not lost silently", async () => {
    vi.stubEnv("N8N_LOAN_EVENTS_WEBHOOK_URL", "");
    const calls = mockN8n(200);
    const { t } = await requestedLoan();
    await drain(t);
    expect(calls).toHaveLength(0);
    expect(await outboxRows(t)).toMatchObject([
      { status: "skipped", lastError: "automation_not_configured" },
    ]);
  });
});

async function signedPost(
  t: T,
  path: string,
  body: unknown,
  options: { secret?: string; now?: number } = {},
) {
  const raw = JSON.stringify(body);
  const headers = await signedHeaders(
    options.secret ?? N8N_TO_CONVEX,
    `msg_${Math.random()}`,
    raw,
    options.now,
  );
  return await t.fetch(path, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: raw,
  });
}

async function overdueLoan() {
  vi.setSystemTime(new Date("2026-06-01T12:00:00Z"));
  const t = setup();
  const alice = await signIn(t, ALICE);
  const bob = await signIn(t, BOB);
  const toolId = await listTool(alice, { name: "Tile saw" });
  const loanId = await bob.mutation(api.loans.request, {
    toolId,
    startDate: "2026-06-02",
    endDate: "2026-06-05",
  });
  await alice.mutation(api.loans.approve, { loanId });
  vi.setSystemTime(new Date("2026-06-10T09:00:00Z"));
  return { t, alice, bob, loanId };
}

describe("n8n → Convex endpoints", () => {
  test("reject unsigned, tampered, stale, wrongly-keyed and cross-endpoint requests", async () => {
    const { t } = await overdueLoan();
    const path = "/automation/overdue-loans";
    const body = { type: "overdue_loans.list" };

    expect((await t.fetch(path, { method: "POST", body: JSON.stringify(body) })).status).toBe(401);
    expect((await signedPost(t, path, body, { secret: "wrong" })).status).toBe(401);
    expect((await signedPost(t, path, body, { now: Date.now() - 10 * 60_000 })).status).toBe(401);

    const headers = await signedHeaders(N8N_TO_CONVEX, "msg_1", JSON.stringify(body));
    const tampered = await t.fetch(path, {
      method: "POST",
      headers,
      body: JSON.stringify({ type: "overdue_loans.list", x: 1 }),
    });
    expect(tampered.status).toBe(401);

    const crossEndpoint = await signedPost(t, path, {
      type: "reminder.claim",
      loanId: "x",
      asOf: "2026-06-10",
    });
    expect(crossEndpoint.status).toBe(400);
    expect(await crossEndpoint.json()).toEqual({ error: "wrong_type" });

    const huge = await signedPost(t, "/automation/incidents", {
      type: "incident.report",
      incidentKey: "1",
      workflow: "w",
      message: "x".repeat(20_000),
    });
    expect(huge.status).toBe(413);
  });

  test("refuse everything when the shared secret isn't configured", async () => {
    const { t } = await overdueLoan();
    vi.stubEnv("LENDLOOP_N8N_TO_CONVEX_SECRET", "");
    const response = await signedPost(t, "/automation/overdue-loans", { type: "overdue_loans.list" });
    expect(response.status).toBe(503);
  });

  test("accept the previous secret during a key rotation", async () => {
    const { t } = await overdueLoan();
    vi.stubEnv("LENDLOOP_N8N_TO_CONVEX_SECRET", "new-secret");
    vi.stubEnv("LENDLOOP_N8N_TO_CONVEX_SECRET_PREVIOUS", N8N_TO_CONVEX);
    expect((await signedPost(t, "/automation/overdue-loans", { type: "overdue_loans.list" })).status).toBe(
      200,
    );
    expect(
      (
        await signedPost(
          t,
          "/automation/overdue-loans",
          { type: "overdue_loans.list" },
          { secret: "new-secret" },
        )
      ).status,
    ).toBe(200);
  });

  test("overdue reminders: list, claim, send, write back, all idempotent", async () => {
    const { t, bob, loanId } = await overdueLoan();
    const list = async () =>
      await (await signedPost(t, "/automation/overdue-loans", { type: "overdue_loans.list" })).json();
    const claim = async () =>
      await (
        await signedPost(t, "/automation/reminders/claim", {
          type: "reminder.claim",
          loanId,
          asOf: "2026-06-10",
        })
      ).json();
    const result = async (status: "sent" | "failed", error?: string) => {
      const response = await signedPost(t, "/automation/reminders/result", {
        type: "reminder.result",
        reminderKey: `${loanId}:2026-06-10`,
        status,
        ...(error ? { error } : {}),
      });
      return { status: response.status, body: await response.json() };
    };

    expect(await list()).toEqual({
      asOf: "2026-06-10",
      hasMore: false,
      loans: [
        {
          loanId,
          reminderKey: `${loanId}:2026-06-10`,
          dueDate: "2026-06-05",
          daysOverdue: 5,
          toolName: "Tile saw",
          borrower: { firstName: "Bob", email: "bob@example.com" },
          link: "https://lendloop.test/borrowing",
        },
      ],
    });

    expect(await claim()).toEqual({ proceed: true, reminderKey: `${loanId}:2026-06-10` });
    // A retry or an overlapping run is told to stand down while the first holds the claim.
    expect(await claim()).toEqual({ proceed: false, reason: "in_progress" });
    expect((await list()).loans).toEqual([]);

    expect(await result("sent")).toEqual({ status: 200, body: { outcome: "recorded" } });
    expect(await result("sent")).toEqual({ status: 200, body: { outcome: "duplicate" } });
    // "sent" is terminal: a late failure from a retried branch can't undo it.
    expect(await result("failed", "timeout")).toEqual({ status: 200, body: { outcome: "duplicate" } });
    expect(await claim()).toEqual({ proceed: false, reason: "already_sent" });

    const reminders = await t.run(async (ctx) => await ctx.db.query("reminders").collect());
    expect(reminders).toHaveLength(1);
    const [view] = await bob.query(api.loans.borrowing, {});
    expect(view.activity[0]).toMatchObject({
      kind: "reminder",
      status: "sent",
      label: "Overdue reminder sent",
    });

    // Tomorrow is a new reminder.
    vi.setSystemTime(new Date("2026-06-11T09:00:00Z"));
    expect((await list()).loans).toHaveLength(1);
  });

  test("a failed reminder can be retried, and its error is stored without the address", async () => {
    const { t, loanId } = await overdueLoan();
    const claim = () =>
      signedPost(t, "/automation/reminders/claim", { type: "reminder.claim", loanId, asOf: "2026-06-10" });
    expect(await (await claim()).json()).toMatchObject({ proceed: true });
    await signedPost(t, "/automation/reminders/result", {
      type: "reminder.result",
      reminderKey: `${loanId}:2026-06-10`,
      status: "failed",
      error: "550 mailbox unavailable: bob@example.com",
    });
    const [failed] = await t.run(async (ctx) => await ctx.db.query("reminders").collect());
    expect(failed).toMatchObject({ status: "failed", error: "550 mailbox unavailable: [email]" });

    expect(await (await claim()).json()).toMatchObject({ proceed: true });
    const [retried] = await t.run(async (ctx) => await ctx.db.query("reminders").collect());
    expect(retried).toMatchObject({ status: "sending", attempts: 2 });
  });

  test("an abandoned claim can be taken over after the lease", async () => {
    const { t, loanId } = await overdueLoan();
    const claim = async () =>
      await (
        await signedPost(t, "/automation/reminders/claim", {
          type: "reminder.claim",
          loanId,
          asOf: "2026-06-10",
        })
      ).json();
    expect(await claim()).toMatchObject({ proceed: true });
    vi.setSystemTime(new Date("2026-06-10T09:16:00Z"));
    expect(await claim()).toMatchObject({ proceed: true });
  });

  test("claims are refused for returned loans, unknown ids and odd dates; results need a claim", async () => {
    const { t, alice, loanId } = await overdueLoan();
    const claim = async (body: Record<string, string>) =>
      await (await signedPost(t, "/automation/reminders/claim", { type: "reminder.claim", ...body })).json();

    expect(await claim({ loanId, asOf: "2026-06-01" })).toEqual({ proceed: false, reason: "bad_date" });
    expect(await claim({ loanId: "not-an-id", asOf: "2026-06-10" })).toEqual({
      proceed: false,
      reason: "not_found",
    });
    const orphan = await signedPost(t, "/automation/reminders/result", {
      type: "reminder.result",
      reminderKey: `${loanId}:2026-06-10`,
      status: "sent",
    });
    expect(orphan.status).toBe(409);

    await alice.mutation(api.loans.markReturned, { loanId });
    expect(await claim({ loanId, asOf: "2026-06-10" })).toEqual({ proceed: false, reason: "not_overdue" });
  });

  test("n8n incidents are recorded once and shown to admins", async () => {
    const { t } = await overdueLoan();
    const report = {
      type: "incident.report",
      incidentKey: "exec-42",
      workflow: "LendLoop · Overdue reminders",
      node: "Send reminder email",
      message: "Connection refused for alice@example.com",
      executionId: "42",
    };
    expect(await (await signedPost(t, "/automation/incidents", report)).json()).toEqual({
      outcome: "recorded",
    });
    expect(await (await signedPost(t, "/automation/incidents", report)).json()).toEqual({
      outcome: "duplicate",
    });

    const admin = await signIn(t, ADMIN);
    await makeAdmin(t, ADMIN.email);
    const { openIncidents } = await admin.query(api.admin.automationHealth, {});
    expect(openIncidents).toMatchObject([
      { workflow: report.workflow, message: "Connection refused for [email]" },
    ]);
    await admin.mutation(api.admin.resolveIncident, { incidentId: openIncidents[0].id });
    expect((await admin.query(api.admin.automationHealth, {})).openIncidents).toEqual([]);
  });
});
