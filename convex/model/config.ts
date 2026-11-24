import { env } from "../_generated/server";
import { todayIn } from "./dates";

/** The zone that decides what "today" and "overdue" mean. */
export function appTimeZone(): string {
  return env.LENDLOOP_TIMEZONE || "UTC";
}

export function today(): string {
  return todayIn(appTimeZone());
}

export function appUrl(): string {
  return (env.LENDLOOP_APP_URL || "http://localhost:3000").replace(/\/+$/, "");
}

/** Outgoing (Convex → n8n) settings, or null when automation isn't configured. */
export function outgoingWebhook(): { url: string; secret: string } | null {
  const url = env.N8N_LOAN_EVENTS_WEBHOOK_URL;
  const secret = env.LENDLOOP_CONVEX_TO_N8N_SECRET;
  return url && secret ? { url, secret } : null;
}

/** Secrets accepted on incoming (n8n → Convex) calls: current first, then previous. */
export function incomingSecrets(): string[] {
  return [env.LENDLOOP_N8N_TO_CONVEX_SECRET, env.LENDLOOP_N8N_TO_CONVEX_SECRET_PREVIOUS].filter(
    (secret): secret is string => Boolean(secret),
  );
}
