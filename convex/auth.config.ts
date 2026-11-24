import type { AuthConfig } from "convex/server";

/**
 * Convex accepts a Clerk token only if its issuer is exactly this Frontend API
 * URL and its audience is "convex" (set by Clerk's Convex integration, or by a
 * JWT template named "convex"; see README).
 */
export default {
  providers: [
    {
      // Auth config is evaluated at push time, before the typed `env` exists.
      // eslint-disable-next-line @convex-dev/no-process-env
      domain: process.env.CLERK_FRONTEND_API_URL!,
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
