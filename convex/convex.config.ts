import { defineApp } from "convex/server";
import { v } from "convex/values";
import rateLimiter from "@convex-dev/rate-limiter/convex.config.js";

/**
 * Deployment environment variables, declared and typed. A push fails if a
 * required one is missing, so a misconfigured deployment can't go live.
 * Read them via `env` from ./_generated/server, never process.env.
 */
const app = defineApp({
  env: {
    /** Clerk Frontend API URL, the issuer Convex checks tokens against. */
    CLERK_FRONTEND_API_URL: v.string(),
    /** Public URL of the Next.js app, used for links in notifications. */
    LENDLOOP_APP_URL: v.optional(v.string()),
    /** IANA zone that decides what "today" and "overdue" mean. Default UTC. */
    LENDLOOP_TIMEZONE: v.optional(v.string()),
    /** n8n production webhook for loan events. Unset: notifications are recorded as skipped. */
    N8N_LOAN_EVENTS_WEBHOOK_URL: v.optional(v.string()),
    /** Standard Webhooks secret (whsec_...) Convex signs outgoing events with. */
    LENDLOOP_CONVEX_TO_N8N_SECRET: v.optional(v.string()),
    /** Secret n8n signs its calls to Convex with; a separate key per direction. */
    LENDLOOP_N8N_TO_CONVEX_SECRET: v.optional(v.string()),
    /** Previous n8n → Convex secret, accepted during a key rotation. */
    LENDLOOP_N8N_TO_CONVEX_SECRET_PREVIOUS: v.optional(v.string()),
    /**
     * "true": admin functions also require the session to have passed a second
     * factor (Clerk's `fva` claim). Set in production; off locally so reviewers
     * don't need MFA set up. Needs Clerk's Convex integration (session token),
     * since a JWT template can't carry `fva`.
     */
    LENDLOOP_ADMIN_REQUIRE_MFA: v.optional(v.string()),
  },
});
app.use(rateLimiter);

export default app;
