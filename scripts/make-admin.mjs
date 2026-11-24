#!/usr/bin/env node
// Grant (or revoke) the admin role:  npm run make-admin -- you@example.com [--revoke]
// Calls the internal admin:setRole function with your deployment's admin key,
// which is the only way to change a role: there is no client-side path.
import { spawnSync } from "node:child_process";

const email = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
if (!email) {
  console.error("Usage: npm run make-admin -- you@example.com [--revoke]");
  process.exit(1);
}
const role = process.argv.includes("--revoke") ? "user" : "admin";
const result = spawnSync(
  process.execPath,
  ["node_modules/convex/bin/main.js", "run", "admin:setRole", JSON.stringify({ email, role })],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
