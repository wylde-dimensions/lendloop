import { HOUR, RateLimiter } from "@convex-dev/rate-limiter";
import { components } from "./_generated/api";

/**
 * Per-user limits on the two actions that create work for other people.
 * Token buckets allow a short burst, then a steady rate. Limits are evaluated
 * inside the mutation's transaction, so a rejected mutation spends nothing.
 */
export const rateLimiter = new RateLimiter(components.rateLimiter, {
  createListing: { kind: "token bucket", rate: 20, period: HOUR, capacity: 5 },
  requestLoan: { kind: "token bucket", rate: 30, period: HOUR, capacity: 10 },
});
