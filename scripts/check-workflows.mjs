#!/usr/bin/env node
// Guard rails for the committed n8n workflows (runs in CI):  npm run check:workflows
//
//   • no secret values: no credential data, no secret-looking parameters, and
//     none of the values in a local docker/.env (if present) appear anywhere;
//   • no per-instance or personal data: static data, pin data, sharing/owner info;
//   • every credential reference points at one the bootstrap creates;
//   • workflows that handle personal data don't keep successful executions and
//     report failures to the error workflow.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readEnvFile } from "./lib/env-file.mjs";

const DIR = "n8n/workflows";
const KNOWN_CREDENTIALS = new Set(["llSmtpMailpit001", "llVerifyConvex01", "llSignForConvex1"]);
const ERROR_WORKFLOW = "llErrorHandler01";
const SUB_WORKFLOW = "llConvexRequest1";
const FORBIDDEN_TOP_LEVEL = ["staticData", "pinData", "shared", "meta", "versionMetadata"];
const SECRETISH = /(secret|password|passwd|token|api[-_]?key|private[-_]?key|hmac)/i;

const localSecrets = existsSync("docker/.env")
  ? Object.entries(readEnvFile("docker/.env"))
      .filter(([key, value]) => value && value.length >= 12 && !key.endsWith("_EMAIL"))
      .map(([key, value]) => ({ key, value }))
  : [];

const problems = [];
const files = readdirSync(DIR).filter((name) => name.endsWith(".json"));

function walk(value, path, visit) {
  visit(value, path);
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) walk(child, `${path}.${key}`, visit);
  }
}

for (const file of files) {
  const raw = readFileSync(join(DIR, file), "utf8");
  const workflow = JSON.parse(raw);
  const where = (detail) => problems.push(`${file}: ${detail}`);

  for (const key of FORBIDDEN_TOP_LEVEL) {
    if (key in workflow && workflow[key] && Object.keys(workflow[key]).length)
      where(`has "${key}" (instance or personal data)`);
  }
  for (const { key, value } of localSecrets) {
    if (raw.includes(value)) where(`contains the value of ${key} from docker/.env`);
  }

  for (const node of workflow.nodes ?? []) {
    for (const [type, ref] of Object.entries(node.credentials ?? {})) {
      if (Object.keys(ref).some((k) => !["id", "name"].includes(k)))
        where(`node "${node.name}" embeds credential data`);
      if (!KNOWN_CREDENTIALS.has(ref.id))
        where(`node "${node.name}" uses unknown ${type} credential ${ref.id}`);
    }
    walk(node.parameters ?? {}, "parameters", (value, path) => {
      const key = path.split(".").at(-1);
      if (typeof value === "string" && SECRETISH.test(key) && value && !value.startsWith("=")) {
        where(`node "${node.name}" has a literal value at ${path}`);
      }
    });
  }

  const s = workflow.settings ?? {};
  if (workflow.id !== ERROR_WORKFLOW) {
    if (s.saveDataSuccessExecution !== "none") where(`settings.saveDataSuccessExecution should be "none"`);
    if (workflow.id !== SUB_WORKFLOW && s.errorWorkflow !== ERROR_WORKFLOW) {
      where(`settings.errorWorkflow should be ${ERROR_WORKFLOW}`);
    }
  }
}

if (problems.length) {
  console.error(`✘ ${problems.length} problem(s) in ${DIR}:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(
  `✔ ${files.length} workflows: no secrets, no instance data, credentials by reference, failures reported.`,
);
