import { httpRouter } from "convex/server";
import { v, type GenericValidator, type Infer } from "convex/values";
import { literals } from "convex-helpers/validators";
import { validate } from "convex-helpers/validators";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { incomingSecrets, today } from "./model/config";
import { verify } from "./model/signing";

/**
 * Endpoints n8n calls. Each one:
 *   1. refuses bodies over 16 KB before reading them;
 *   2. verifies the Standard Webhooks signature (HMAC-SHA256, ±5 min replay window)
 *      against the n8n → Convex secret, accepting the previous secret during rotation;
 *   3. checks the body's `type` matches the endpoint, so a signed body for one
 *      endpoint can't be replayed against another;
 *   4. validates the body shape, then calls an internal, idempotent function.
 * Failures return a bare error code; the reason is logged, not sent back.
 */

const MAX_BODY_BYTES = 16 * 1024;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

async function readSignedBody<V extends GenericValidator>(
  request: Request,
  type: string,
  validator: V,
): Promise<{ ok: true; body: Infer<V> } | { ok: false; response: Response }> {
  const secrets = incomingSecrets();
  if (secrets.length === 0) {
    console.error(JSON.stringify({ event: "automation.request_rejected", type, reason: "not_configured" }));
    return { ok: false, response: json(503, { error: "automation_not_configured" }) };
  }
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return { ok: false, response: json(413, { error: "body_too_large" }) };
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return { ok: false, response: json(413, { error: "body_too_large" }) };

  const verdict = await verify({
    secrets,
    id: request.headers.get("webhook-id"),
    timestamp: request.headers.get("webhook-timestamp"),
    signature: request.headers.get("webhook-signature"),
    body: raw,
  });
  if (!verdict.ok) {
    console.warn(JSON.stringify({ event: "automation.request_rejected", type, reason: verdict.reason }));
    return { ok: false, response: json(401, { error: "invalid_signature" }) };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, response: json(400, { error: "invalid_json" }) };
  }
  if ((parsed as { type?: unknown } | null)?.type !== type) {
    return { ok: false, response: json(400, { error: "wrong_type" }) };
  }
  if (!validate(validator, parsed)) {
    return { ok: false, response: json(400, { error: "invalid_body" }) };
  }
  return { ok: true, body: parsed };
}

const overdueLoans = httpAction(async (ctx, request) => {
  const read = await readSignedBody(request, "overdue_loans.list", v.object({ type: v.string() }));
  if (!read.ok) return read.response;
  // The action reads the clock and passes it in, so the query itself stays deterministic.
  return json(200, await ctx.runQuery(internal.automation.overdueLoans, { asOf: today(), now: Date.now() }));
});

const claimReminder = httpAction(async (ctx, request) => {
  const read = await readSignedBody(
    request,
    "reminder.claim",
    v.object({
      type: v.string(),
      loanId: v.string(),
      asOf: v.string(),
      executionId: v.optional(v.string()),
    }),
  );
  if (!read.ok) return read.response;
  const { loanId, asOf, executionId } = read.body;
  return json(200, await ctx.runMutation(internal.automation.claimReminder, { loanId, asOf, executionId }));
});

const reminderResult = httpAction(async (ctx, request) => {
  const read = await readSignedBody(
    request,
    "reminder.result",
    v.object({
      type: v.string(),
      reminderKey: v.string(),
      status: literals("sent", "failed"),
      error: v.optional(v.string()),
      executionId: v.optional(v.string()),
    }),
  );
  if (!read.ok) return read.response;
  const { reminderKey, status, error, executionId } = read.body;
  const result = await ctx.runMutation(internal.automation.recordReminderResult, {
    reminderKey,
    status,
    error,
    executionId,
  });
  return json(result.outcome === "not_claimed" ? 409 : 200, result);
});

const reportIncident = httpAction(async (ctx, request) => {
  const read = await readSignedBody(
    request,
    "incident.report",
    v.object({
      type: v.string(),
      incidentKey: v.string(),
      workflow: v.string(),
      node: v.optional(v.string()),
      message: v.string(),
      executionId: v.optional(v.string()),
    }),
  );
  if (!read.ok) return read.response;
  const { incidentKey, workflow, node, message, executionId } = read.body;
  return json(
    200,
    await ctx.runMutation(internal.automation.reportIncident, {
      incidentKey,
      workflow,
      node,
      message,
      executionId,
    }),
  );
});

const http = httpRouter();
http.route({ path: "/automation/overdue-loans", method: "POST", handler: overdueLoans });
http.route({ path: "/automation/reminders/claim", method: "POST", handler: claimReminder });
http.route({ path: "/automation/reminders/result", method: "POST", handler: reminderResult });
http.route({ path: "/automation/incidents", method: "POST", handler: reportIncident });
export default http;
