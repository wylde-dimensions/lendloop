#!/usr/bin/env node
// Supply-chain gate (runs in CI):  npm run check:signatures
//
// Verifies every installed package against the npm registry: its registry
// signature, and its Sigstore attestations (publish + build provenance) where it
// has them. Wraps `npm audit signatures` so a failure says which package and why,
// as an annotation on the run page, instead of only an exit code.
//
// Why one retry, and why this kind. With an empty cache (every CI run), npm
// verifies ~150 packages' attestations in parallel, and each one finds Sigstore's
// bundled trusted_root.json out of date, downloads the current one and copies it
// over the same file while the others read it. Some read it half-written
// ("Unexpected end of JSON input") and that package is reported as an invalid
// attestation. Reproduced with npm 10.9.9's own sigstore code: 6 of 900 checks
// failed this way from a cold cache, 0 of 1,500 from a warm one.
//
// So the retry runs in a fresh cache (npm keeps attestation responses for a
// year, so the old one would replay whatever the first attempt received), seeded
// with the first attempt's Sigstore trust files, which are now current. Copying
// them can't smuggle anything in: TUF re-checks each cached file against its
// signed metadata and downloads it again on a mismatch.
//
// Retrying can't let a bad package through: a pass needs every signature to
// verify, and no number of attempts makes a forged one verify. A first-attempt
// failure is still reported, as a warning, when the retry passes.

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const IN_ACTIONS = process.env.GITHUB_ACTIONS === "true";

// GitHub workflow-command escaping for annotation messages.
const escape = (s) => String(s).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const annotate = (level, title, message) => {
  if (IN_ACTIONS) console.log(`::${level} title=${escape(title)}::${escape(message)}`);
};

// npm is a .cmd shim on Windows, which Node only runs through a shell. The
// arguments are fixed strings plus a path this script created, so nothing
// outside it is interpolated.
const npm = (args) =>
  spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", args, {
    encoding: "utf8",
    shell: process.platform === "win32",
    maxBuffer: 64 * 1024 * 1024,
  });

function audit(cacheDir) {
  const result = npm(["audit", "signatures", "--json", ...(cacheDir ? ["--cache", cacheDir] : [])]);
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    // Not a verification verdict (network down, npm crashed): show what npm said.
    return {
      ok: false,
      problems: [
        `npm audit signatures did not report (exit ${result.status}): ${(result.stderr || result.stdout).trim().slice(0, 2000)}`,
      ],
    };
  }
  const problems = [
    ...(report.invalid ?? []).map(
      (p) =>
        `${p.name}@${p.version}: ${p.code}${p.predicateType ? ` (${p.predicateType})` : ""}: ${p.message ?? "invalid"}`,
    ),
    ...(report.missing ?? []).map(
      (p) => `${p.name}@${p.version}: missing registry signature${p.registry ? ` (${p.registry})` : ""}`,
    ),
  ];
  if (result.status !== 0 && !problems.length)
    problems.push(`npm audit signatures exited ${result.status}: ${result.stderr.trim().slice(0, 2000)}`);
  return { ok: problems.length === 0, problems };
}

const first = audit();
if (first.ok) {
  console.log("✔ Every installed package's registry signature and attestations verified.");
  process.exit(0);
}

console.error(`First attempt found ${first.problems.length} problem(s):\n  ${first.problems.join("\n  ")}`);
const cache = mkdtempSync(join(tmpdir(), "npm-signatures-"));
let second;
try {
  const firstTuf = join(npm(["config", "get", "cache"]).stdout.trim(), "_tuf");
  if (existsSync(firstTuf)) cpSync(firstTuf, join(cache, "_tuf"), { recursive: true });
  second = audit(cache);
} finally {
  rmSync(cache, { recursive: true, force: true });
}

if (second.ok) {
  annotate("warning", "npm signatures: first attempt failed, retry passed", first.problems.join("\n"));
  console.log("✔ Verified on retry in a fresh cache. The first attempt's problems are listed above.");
  process.exit(0);
}

for (const problem of second.problems) annotate("error", "npm signature verification failed", problem);
console.error(`✘ Retry in a fresh cache also failed:\n  ${second.problems.join("\n  ")}`);
process.exit(1);
