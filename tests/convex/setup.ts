/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { expect, vi } from "vitest";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import schema from "../../convex/schema";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { AppErrorCode } from "../../convex/model/errors";

// Every Convex module, loaded lazily: convex-test only imports what a test calls.
const modules = import.meta.glob("../../convex/**/*.*s");

export type T = TestConvex<typeof schema>;

/** A fixed "today" so date rules are deterministic: 2026-06-10 (UTC). */
export const TODAY = "2026-06-10";

export function freezeTime(iso = `${TODAY}T12:00:00Z`) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
}

export function setup(): T {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  return t;
}

const person = (key: string, givenName: string, extra: Record<string, unknown> = {}) => ({
  subject: `user_${key}`,
  issuer: "https://test.clerk.accounts.dev",
  givenName,
  name: `${givenName} Example`,
  email: `${key}@example.com`,
  emailVerified: true,
  ...extra,
});

export const ALICE = person("alice", "Alice");
export const BOB = person("bob", "Bob");
export const CARA = person("cara", "Cara");
export const ADMIN = person("admin", "Ada");

export async function signIn(t: T, identity: ReturnType<typeof person>) {
  const as = t.withIdentity(identity);
  await as.mutation(api.users.ensure, {});
  return as;
}

export async function makeAdmin(t: T, email: string) {
  await t.mutation(internal.admin.setRole, { email, role: "admin" });
}

type As = Awaited<ReturnType<typeof signIn>>;

export async function listTool(
  as: As,
  overrides: Partial<{
    name: string;
    category: "power_tools" | "garden" | "camping";
    description: string;
  }> = {},
): Promise<Id<"tools">> {
  return await as.mutation(api.tools.create, {
    name: "Cordless drill",
    category: "power_tools",
    condition: "good",
    description: "18V, two batteries",
    ...overrides,
  });
}

export async function expectAppError(promise: Promise<unknown>, code: AppErrorCode) {
  await expect(promise).rejects.toMatchObject({ data: { code } });
}

export async function outboxRows(t: T) {
  return await t.run(async (ctx) => await ctx.db.query("outbox").collect());
}
