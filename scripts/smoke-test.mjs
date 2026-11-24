#!/usr/bin/env node
// End-to-end check of the running stack (npm run setup first):  npm run smoke
//
// Plays Convex's part against the live n8n webhook and n8n's part against the
// live Convex endpoints, and checks every security and idempotency promise the
// README makes. Needs no Clerk account. Exits non-zero on the first failure.

import { createHmac, randomUUID } from "node:crypto";
import { readEnvFile } from "./lib/env-file.mjs";

const env = readEnvFile("docker/.env");
const N8N_WEBHOOK = "http://localhost:5678/webhook/lendloop/loan-events";
const CONVEX_SITE = "http://127.0.0.1:3211";
const MAILPIT = "http://localhost:8025";

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "✔" : "✘"} ${name}${!ok && detail ? `\n    ${detail}` : ""}`);
  if (!ok) failures++;
}

/** Standard Webhooks headers. Plain-string secrets are UTF-8 HMAC keys (as in n8n's Crypto credential). */
function signed(secret, body, { id = `msg_${randomUUID()}`, ageSeconds = 0 } = {}) {
  const timestamp = String(Math.floor(Date.now() / 1000) - ageSeconds);
  const signature = createHmac("sha256", secret).update(`${id}.${timestamp}.${body}`).digest("base64");
  return {
    "content-type": "application/json",
    "webhook-id": id,
    "webhook-timestamp": timestamp,
    "webhook-signature": `v1,${signature}`,
  };
}

async function post(url, body, headers) {
  const response = await fetch(url, { method: "POST", headers, body });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // not JSON
  }
  return { status: response.status, json, text };
}

const toConvexSecret = env.LENDLOOP_N8N_TO_CONVEX_SECRET;
const toN8nSecret = env.LENDLOOP_CONVEX_TO_N8N_SECRET;
if (!toConvexSecret || !toN8nSecret) {
  console.error("No secrets in docker/.env. Run `npm run setup` first.");
  process.exit(1);
}

// ── Convex → n8n: the loan-notification webhook ───────────────────────────
console.log("\nConvex → n8n (loan notifications webhook)");
const eventId = `evt_smoke_${Date.now()}`;
const toolName = `Smoke-test ladder ${Date.now().toString(36)}`;
const event = JSON.stringify({
  type: "loan.status_changed",
  eventId,
  occurredAt: new Date().toISOString(),
  loan: {
    id: "smoke",
    status: "approved",
    closedReason: null,
    startDate: "2026-12-01",
    endDate: "2026-12-03",
  },
  tool: { name: toolName },
  recipient: {
    role: "borrower",
    firstName: "Robin",
    email: "smoke-test@lendloop.example",
  },
  counterpart: { firstName: "Priya" },
  link: "http://localhost:3000/borrowing",
});

let r = await post(N8N_WEBHOOK, event, { "content-type": "application/json" });
check("unsigned event is rejected (401)", r.status === 401, `got ${r.status} ${r.text}`);

r = await post(N8N_WEBHOOK, event, signed("not-the-secret", event, { id: eventId }));
check("event signed with the wrong key is rejected (401)", r.status === 401, `got ${r.status}`);

r = await post(N8N_WEBHOOK, event, signed(toN8nSecret, event, { id: eventId, ageSeconds: 600 }));
check("10-minute-old signature is rejected as a replay (401)", r.status === 401, `got ${r.status}`);

const tampered = event.replace("Robin", "Mallory");
r = await post(N8N_WEBHOOK, tampered, signed(toN8nSecret, event, { id: eventId }));
check("tampered body is rejected (401)", r.status === 401, `got ${r.status}`);

r = await post(N8N_WEBHOOK, event, signed(toN8nSecret, event, { id: eventId }));
check(
  "valid signed event is accepted (200)",
  r.status === 200 && r.json?.ok === true,
  `got ${r.status} ${r.text}`,
);

// Convex's first retry comes ≥1.6 s later (2 s backoff, ±20% jitter); redeliver the same way.
await new Promise((resolve) => setTimeout(resolve, 2000));
r = await post(N8N_WEBHOOK, event, signed(toN8nSecret, event, { id: eventId }));
check(
  "a retried delivery of the same event is acknowledged without a second email",
  r.status === 200 && r.json?.duplicate === true,
  `got ${r.status} ${r.text}`,
);

await new Promise((resolve) => setTimeout(resolve, 1500));
const inbox = await (
  await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`subject:"${toolName}"`)}`)
).json();
check("exactly one email reached the inbox", inbox.messages_count === 1, `found ${inbox.messages_count}`);
if (inbox.messages?.[0]) {
  const message = await (await fetch(`${MAILPIT}/api/v1/message/${inbox.messages[0].ID}`)).json();
  check(
    "it went to the recipient only",
    message.To?.length === 1 && message.To[0].Address === "smoke-test@lendloop.example",
  );
  check("it carries no n8n attribution or internal ids", !/n8n|evt_smoke|smoke"/.test(message.Text));
}

// ── n8n → Convex: the automation endpoints ─────────────────────────────────
console.log("\nn8n → Convex (automation endpoints)");
const list = JSON.stringify({ type: "overdue_loans.list" });
r = await post(`${CONVEX_SITE}/automation/overdue-loans`, list, {
  "content-type": "application/json",
});
check("unsigned request is rejected (401)", r.status === 401, `got ${r.status}`);

r = await post(`${CONVEX_SITE}/automation/overdue-loans`, list, signed(toN8nSecret, list));
check("request signed with the other direction's key is rejected (401)", r.status === 401, `got ${r.status}`);

r = await post(
  `${CONVEX_SITE}/automation/overdue-loans`,
  JSON.stringify({ type: "reminder.claim" }),
  signed(toConvexSecret, JSON.stringify({ type: "reminder.claim" })),
);
check("a body meant for another endpoint is rejected (400)", r.status === 400, `got ${r.status}`);

r = await post(`${CONVEX_SITE}/automation/overdue-loans`, list, signed(toConvexSecret, list));
check(
  "signed request returns overdue loans with minimal fields",
  r.status === 200 &&
    typeof r.json?.asOf === "string" &&
    Array.isArray(r.json?.loans) &&
    r.json.loans.every(
      (loan) =>
        Object.keys(loan).sort().join() === "borrower,daysOverdue,dueDate,link,loanId,reminderKey,toolName",
    ),
  `got ${r.status} ${r.text.slice(0, 200)}`,
);

const result = JSON.stringify({
  type: "reminder.result",
  reminderKey: "no-such-key",
  status: "sent",
});
r = await post(`${CONVEX_SITE}/automation/reminders/result`, result, signed(toConvexSecret, result));
check("a result for a reminder that was never claimed is refused (409)", r.status === 409, `got ${r.status}`);

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll checks passed.");
process.exit(failures ? 1 : 0);
