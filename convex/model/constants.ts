// Shared constants. Plain TypeScript with no server imports, so the Next.js
// client can import them too and the UI never drifts from what Convex accepts.

export const CATEGORY_VALUES = [
  "power_tools",
  "hand_tools",
  "garden",
  "kitchen",
  "camping",
  "cleaning",
  "ladders_moving",
  "other",
] as const;
export type Category = (typeof CATEGORY_VALUES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  power_tools: "Power tools",
  hand_tools: "Hand tools",
  garden: "Garden",
  kitchen: "Kitchen",
  camping: "Camping",
  cleaning: "Cleaning",
  ladders_moving: "Ladders & moving",
  other: "Other",
};

export const CONDITION_VALUES = ["like_new", "good", "fair", "well_used"] as const;
export type Condition = (typeof CONDITION_VALUES)[number];

export const CONDITION_LABELS: Record<Condition, string> = {
  like_new: "Like new",
  good: "Good",
  fair: "Fair",
  well_used: "Well used",
};

export const LOAN_STATUS_VALUES = ["requested", "approved", "declined", "cancelled", "returned"] as const;
export type LoanStatus = (typeof LOAN_STATUS_VALUES)[number];

export const ROLE_VALUES = ["admin", "user"] as const;
export type Role = (typeof ROLE_VALUES)[number];

export const LIMITS = {
  toolNameMax: 80,
  descriptionMax: 500,
  reasonMax: 200,
  /** Longest loan a neighbour can ask for, in days (inclusive range). */
  maxLoanDays: 30,
  /** How far ahead a loan may start, in days. */
  maxAdvanceDays: 180,
  /** Rows a list query returns; the UI is built for a neighbourhood, not a city. */
  listMax: 200,
} as const;
