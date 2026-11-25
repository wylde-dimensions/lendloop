#!/usr/bin/env node
// Removes what LendLoop put on this machine outside the source files:
//
//   npm run stack:destroy            shows what would be removed
//   npm run stack:destroy -- --yes   removes it
//
// - the Docker containers, network, volumes (Convex and n8n data) and images
// - the generated secrets (docker/.env, .env.local) and build output (.next, .convex)
//
// It can't revoke things that live elsewhere. It lists those at the end.

import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";

const LOCAL_FILES = ["docker/.env", ".env.local", ".next", ".convex"];

if (!process.argv.includes("--yes")) {
  console.log(`This removes:
  - LendLoop's Docker containers, network, volumes and images
  - ${LOCAL_FILES.filter((f) => existsSync(f)).join(", ") || "(no local secret files present)"}

Run it with:  npm run stack:destroy -- --yes`);
  process.exit(0);
}

// `down` doesn't use the secrets, but compose refuses to read the file without them.
const placeholders = Object.fromEntries(
  [
    "N8N_ENCRYPTION_KEY",
    "N8N_RUNNERS_AUTH_TOKEN",
    "N8N_OWNER_PASSWORD_HASH",
    "CONVEX_INSTANCE_SECRET",
    "LENDLOOP_CONVEX_TO_N8N_SECRET",
    "LENDLOOP_N8N_TO_CONVEX_SECRET",
  ].map((name) => [name, "unused"]),
);
const down = spawnSync(
  "docker",
  ["compose", "-f", "docker/compose.yml", "down", "--volumes", "--remove-orphans", "--rmi", "all"],
  { stdio: "inherit", env: { ...process.env, ...placeholders } },
);
if (down.status !== 0) {
  console.error("\ndocker compose down failed. Nothing local was deleted; fix Docker and run again.");
  process.exit(down.status ?? 1);
}

for (const file of LOCAL_FILES) {
  if (existsSync(file)) {
    rmSync(file, { recursive: true, force: true });
    console.log(`removed ${file}`);
  }
}

console.log(`
Done. What only you can revoke, if you used them:
  - Clerk: delete the LendLoop application (dashboard.clerk.com → app → Settings),
    which invalidates its keys and test users.
  - Git: remove any deploy key or access token you created to push this repo.`);
