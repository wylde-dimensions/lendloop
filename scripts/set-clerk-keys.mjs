#!/usr/bin/env node
// Store a Clerk key in .env.local without opening the file:
//   node scripts/set-clerk-keys.mjs publishable pk_test_...
//   node scripts/set-clerk-keys.mjs secret sk_test_...
// Then run `npm run setup` so Convex learns the matching issuer.
import { updateEnvFile } from "./lib/env-file.mjs";

const [kind, value] = process.argv.slice(2);
const target = {
  publishable: ["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_"],
  secret: ["CLERK_SECRET_KEY", "sk_"],
}[kind];
if (!target || !value) {
  console.error("Usage: node scripts/set-clerk-keys.mjs <publishable|secret> <key>");
  process.exit(1);
}
const [name, prefix] = target;
if (!value.startsWith(prefix)) {
  console.error(`That doesn't look like a Clerk ${kind} key (it should start with ${prefix}).`);
  process.exit(1);
}
// A new publishable key may mean a new Clerk instance: let setup re-derive the issuer.
updateEnvFile(
  ".env.local",
  { [name]: value },
  { remove: kind === "publishable" ? ["CLERK_FRONTEND_API_URL"] : [] },
);
console.log(`✔ ${name} saved to .env.local${kind === "secret" ? " (not printed)" : ""}`);
