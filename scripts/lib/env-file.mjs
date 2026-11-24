// Tiny dotenv reader/writer that keeps comments and order, so re-running setup
// only fills in what's missing and never clobbers values someone set by hand.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

export function readEnvFile(path) {
  const values = {};
  if (!existsSync(path)) return values;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2];
    if (/^'.*'$/.test(value) || /^".*"$/.test(value)) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}

/** Set keys in a dotenv file. `quote` single-quotes values (compose then reads `$` literally). */
export function updateEnvFile(path, updates, { header = "", quote = false, remove = [] } = {}) {
  const lines = existsSync(path)
    ? readFileSync(path, "utf8").split(/\r?\n/)
    : header
      ? header.split("\n")
      : [];
  const pending = new Map(Object.entries(updates).filter(([, value]) => value !== undefined));
  const format = (key, value) => `${key}=${quote ? `'${value}'` : value}`;
  const out = [];
  for (const line of lines) {
    const key = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1];
    if (key && remove.includes(key)) continue;
    if (key && pending.has(key)) {
      out.push(format(key, pending.get(key)));
      pending.delete(key);
    } else {
      out.push(line);
    }
  }
  while (out.length && out.at(-1) === "") out.pop();
  for (const [key, value] of pending) out.push(format(key, value));
  writeFileSync(path, `${out.join("\n")}\n`);
}
