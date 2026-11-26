// One-shot n8n bootstrap, run by the n8n-bootstrap service before n8n starts.
//
// 1. Imports the three credentials the workflows use. Their secret values come
//    from the environment (.env) and n8n encrypts them with N8N_ENCRYPTION_KEY
//    on import; the plain JSON exists only briefly in this container's /tmp.
// 2. Imports every workflow in /workflows, filling each "Config" node with this
//    environment's values (the Convex URL and the ops address are not secrets,
//    but they differ per environment).
// 3. Publishes the workflows, so webhooks, schedules and the error handler are live.
//
// Re-running it is safe: n8n upserts credentials and workflows by id.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`[bootstrap] Missing ${name}. Run \`npm run setup\` to generate .env.`);
    process.exit(1);
  }
  return value;
}

function n8n(...args) {
  console.log(`[bootstrap] n8n ${args.join(" ")}`);
  execFileSync("n8n", args, { stdio: "inherit" });
}

const work = mkdtempSync(join(tmpdir(), "lendloop-"));

try {
  const credentials = [
    {
      id: "llSmtpMailpit001",
      name: "LendLoop SMTP",
      type: "smtp",
      data: {
        host: process.env.SMTP_HOST || "mailpit",
        port: Number(process.env.SMTP_PORT || 1025),
        secure: false,
        disableStartTls: true,
        user: process.env.SMTP_USER || "",
        password: process.env.SMTP_PASSWORD || "",
      },
    },
    {
      id: "llVerifyConvex01",
      name: "LendLoop · verify Convex → n8n",
      type: "crypto",
      data: { hmacSecret: required("LENDLOOP_CONVEX_TO_N8N_SECRET") },
    },
    {
      id: "llSignForConvex1",
      name: "LendLoop · sign n8n → Convex",
      type: "crypto",
      data: { hmacSecret: required("LENDLOOP_N8N_TO_CONVEX_SECRET") },
    },
  ];
  const credentialsFile = join(work, "credentials.json");
  writeFileSync(credentialsFile, JSON.stringify(credentials), { mode: 0o600 });
  n8n("import:credentials", `--input=${credentialsFile}`);
  rmSync(credentialsFile);

  const config = {
    convexSiteUrl: required("LENDLOOP_CONVEX_SITE_URL").replace(/\/+$/, ""),
    opsEmail: process.env.LENDLOOP_OPS_EMAIL || "ops@lendloop.example",
  };

  // Test hook: CI sets this to "* * * * *" so the daily reminder workflow runs
  // for real (as a production execution, error workflow included) within a minute.
  // Unset everywhere else, which keeps the exported daily schedule.
  const reminderSchedule = process.env.LENDLOOP_REMINDER_SCHEDULE?.trim();
  if (reminderSchedule && !/^[\d*/,\- ]+$/.test(reminderSchedule)) {
    console.error(
      `[bootstrap] LENDLOOP_REMINDER_SCHEDULE must be a cron expression, got "${reminderSchedule}".`,
    );
    process.exit(1);
  }

  const workflowsDir = join(work, "workflows");
  mkdirSync(workflowsDir);
  const ids = [];
  for (const file of readdirSync("/workflows")
    .filter((name) => name.endsWith(".json"))
    .sort()) {
    const workflow = JSON.parse(readFileSync(join("/workflows", file), "utf8"));
    for (const node of workflow.nodes) {
      if (node.name === "Config") {
        for (const assignment of node.parameters?.assignments?.assignments ?? []) {
          if (assignment.name in config) assignment.value = config[assignment.name];
        }
      }
      if (reminderSchedule && node.type === "n8n-nodes-base.scheduleTrigger") {
        node.parameters.rule = { interval: [{ field: "cronExpression", expression: reminderSchedule }] };
        console.log(`[bootstrap] "${workflow.name}" scheduled at "${reminderSchedule}" (test override)`);
      }
    }
    writeFileSync(join(workflowsDir, file), JSON.stringify(workflow));
    ids.push({ id: workflow.id, name: workflow.name });
  }
  n8n("import:workflow", "--separate", `--input=${workflowsDir}`);

  for (const { id, name } of ids) {
    console.log(`[bootstrap] publishing "${name}"`);
    n8n("publish:workflow", `--id=${id}`);
  }
  console.log(`[bootstrap] done: ${ids.length} workflows, ${credentials.length} credentials`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
