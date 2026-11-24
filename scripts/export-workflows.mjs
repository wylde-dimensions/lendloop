#!/usr/bin/env node
// Pull the LendLoop workflows out of the running n8n into n8n/workflows/:
//   npm run n8n:export
//
// Edit in the n8n editor, export with this, review the diff, commit. Fields that
// are per-instance or can hold personal data are dropped: static data (handled
// event ids, schedule state), pin data, sharing/owner info, instance ids,
// version counters and timestamps. Credentials are referenced by id and name
// only; n8n never exports their values. `npm run check:workflows` verifies this.

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DIR = "n8n/workflows";
const compose = (...args) =>
  execFileSync("docker", ["compose", "-f", "docker/compose.yml", "exec", "-T", "n8n", ...args], {
    encoding: "utf8",
  });

// Keep the existing file name for each workflow id.
const fileById = new Map(
  readdirSync(DIR)
    .filter((name) => name.endsWith(".json"))
    .map((name) => [JSON.parse(readFileSync(join(DIR, name), "utf8")).id, name]),
);

compose(
  "sh",
  "-c",
  "rm -rf /tmp/lendloop-export && n8n export:workflow --all --separate --output=/tmp/lendloop-export >/dev/null",
);
const exported = compose("ls", "/tmp/lendloop-export").split(/\s+/).filter(Boolean);

const KEEP = ["id", "name", "description", "nodes", "connections", "settings"];
let written = 0;
for (const name of exported) {
  const workflow = JSON.parse(compose("cat", `/tmp/lendloop-export/${name}`));
  const file = fileById.get(workflow.id);
  if (!file) {
    console.log(`skipping "${workflow.name}" (${workflow.id}): not a LendLoop workflow file yet`);
    continue;
  }
  const clean = Object.fromEntries(
    KEEP.filter((key) => workflow[key] != null).map((key) => [key, workflow[key]]),
  );
  writeFileSync(join(DIR, file), `${JSON.stringify(clean, null, 2)}\n`);
  written++;
  console.log(`✔ ${file}  ←  ${workflow.name}`);
}
console.log(`\n${written} workflow(s) exported. Run \`npm run check:workflows\` before committing.`);
