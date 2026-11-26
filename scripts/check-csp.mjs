#!/usr/bin/env node
// Checks the production build's Content-Security-Policy (CI runs it after the build):
//   npm run build && npm run check:csp
//
// Starts `next start` on a local port and, for a few pages, checks that:
//   - scripts are allowed only by a per-request nonce with 'strict-dynamic',
//     with no 'unsafe-eval', and the nonce changes on every request;
//   - every <script> tag in the HTML carries that nonce (a prerendered page
//     couldn't, and its scripts would be blocked);
//   - framing, plugins and <base> are locked down.
// A regression to Clerk's non-strict default (inline scripts from any host) fails here.

import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const PORT = 3123;
const PAGES = ["/", "/sign-in", "/tools"];
const ORIGIN = `http://localhost:${PORT}`;

const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");
const server = spawn(process.execPath, [nextBin, "start", "-H", "localhost", "-p", String(PORT)], {
  stdio: ["ignore", "ignore", "pipe"],
});
// Keep the server's errors: they usually say why a page failed.
let serverErrors = "";
server.stderr.on("data", (chunk) => {
  process.stderr.write(chunk);
  if (serverErrors.length < 4000) serverErrors += chunk;
});

const failed = [];
function check(name, ok, detail = "") {
  console.log(`${ok ? "✔" : "✘"} ${name}${!ok && detail ? `\n    ${detail}` : ""}`);
  if (!ok) failed.push(detail ? `${name}: ${String(detail).slice(0, 300)}` : name);
}

const directives = (csp) =>
  Object.fromEntries(
    csp
      .split(";")
      .map((d) => d.trim().split(/\s+/))
      .filter(([name]) => name)
      .map(([name, ...values]) => [name, values]),
  );

try {
  let up = false;
  for (let i = 0; i < 120 && !up; i++) {
    up = await fetch(ORIGIN).then(
      () => true,
      () => new Promise((resolve) => setTimeout(() => resolve(false), 500)),
    );
  }
  if (!up) throw new Error(`next start didn't answer on ${ORIGIN} within 60 s`);

  const nonces = new Set();
  for (const page of PAGES) {
    const res = await fetch(ORIGIN + page, { redirect: "manual" });
    const csp = res.headers.get("content-security-policy") ?? "";
    const d = directives(csp);
    const script = d["script-src"] ?? [];
    const nonce = script.find((v) => v.startsWith("'nonce-"))?.slice(7, -1);
    if (nonce) nonces.add(nonce);
    const html = await res.text();
    const tags = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
    const missing = tags.filter((tag) => !nonce || !tag.includes(`nonce="${nonce}"`));

    console.log(`\n${page} (${res.status})`);
    check(
      "scripts need this request's nonce, with 'strict-dynamic'",
      Boolean(nonce) && script.includes("'strict-dynamic'"),
      csp,
    );
    check("no 'unsafe-eval'", !script.includes("'unsafe-eval'"), script.join(" "));
    check(
      `all ${tags.length} <script> tags carry the nonce`,
      tags.length > 0 && missing.length === 0,
      missing[0],
    );
    check(
      "frame-ancestors 'none', object-src 'none', base-uri 'self'",
      d["frame-ancestors"]?.join() === "'none'" &&
        d["object-src"]?.join() === "'none'" &&
        d["base-uri"]?.join() === "'self'",
    );
  }
  console.log("");
  check("every response got a different nonce", nonces.size === PAGES.length, `${nonces.size} distinct`);
} catch (error) {
  check("the production server ran", false, String(error));
} finally {
  server.kill();
}

if (failed.length === 0) {
  console.log("\nThe CSP is strict on every page checked.");
  process.exit(0);
}
console.log(`\n${failed.length} check(s) failed.`);
// On GitHub, also as an annotation on the run page (readable without opening the log).
if (process.env.GITHUB_ACTIONS === "true") {
  const escape = (s) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  const errors = serverErrors.trim() ? `\n\nServer errors:\n${serverErrors.trim().slice(0, 1500)}` : "";
  console.log(`::error title=CSP check failed::${escape(failed.join("\n") + errors)}`);
}
process.exit(1);
