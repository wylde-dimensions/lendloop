/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as automation from "../automation.js";
import type * as http from "../http.js";
import type * as loans from "../loans.js";
import type * as model_activity from "../model/activity.js";
import type * as model_audit from "../model/audit.js";
import type * as model_availability from "../model/availability.js";
import type * as model_config from "../model/config.js";
import type * as model_constants from "../model/constants.js";
import type * as model_dates from "../model/dates.js";
import type * as model_errors from "../model/errors.js";
import type * as model_functions from "../model/functions.js";
import type * as model_loans from "../model/loans.js";
import type * as model_outbox from "../model/outbox.js";
import type * as model_redact from "../model/redact.js";
import type * as model_signing from "../model/signing.js";
import type * as model_validators from "../model/validators.js";
import type * as rateLimits from "../rateLimits.js";
import type * as seed from "../seed.js";
import type * as tools from "../tools.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  automation: typeof automation;
  http: typeof http;
  loans: typeof loans;
  "model/activity": typeof model_activity;
  "model/audit": typeof model_audit;
  "model/availability": typeof model_availability;
  "model/config": typeof model_config;
  "model/constants": typeof model_constants;
  "model/dates": typeof model_dates;
  "model/errors": typeof model_errors;
  "model/functions": typeof model_functions;
  "model/loans": typeof model_loans;
  "model/outbox": typeof model_outbox;
  "model/redact": typeof model_redact;
  "model/signing": typeof model_signing;
  "model/validators": typeof model_validators;
  rateLimits: typeof rateLimits;
  seed: typeof seed;
  tools: typeof tools;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
};
