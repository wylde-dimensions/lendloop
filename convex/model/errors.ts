import { ConvexError } from "convex/values";

/**
 * Errors the client may show to the person. Anything else (a bug, an outage)
 * reaches the client as a generic "Server Error" with no internals.
 */
export type AppErrorCode =
  "UNAUTHENTICATED" | "NOT_PROVISIONED" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "INVALID";

export type AppErrorData = { code: AppErrorCode; message: string };

export function appError(code: AppErrorCode, message: string) {
  return new ConvexError<AppErrorData>({ code, message });
}
