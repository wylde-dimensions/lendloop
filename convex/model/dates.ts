// Loans are whole days. Dates travel as ISO "YYYY-MM-DD" strings, which sort
// and compare correctly as plain strings and carry no time-zone ambiguity.
// "Today" is evaluated in one configured zone (LENDLOOP_TIMEZONE, default UTC)
// so the app, the overdue query and n8n's schedule all agree on what day it is.
// No server imports: the browser uses these helpers too.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function todayIn(timeZone: string, now: number = Date.now()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(now));
    const part = (type: string) => parts.find((p) => p.type === type)?.value;
    const iso = `${part("year")}-${part("month")}-${part("day")}`;
    if (isIsoDate(iso)) return iso;
  } catch {
    // Unknown zone: fall through to UTC rather than failing the request.
  }
  return new Date(now).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

export type DateRange = { startDate: string; endDate: string };

/** Inclusive ranges: a loan ending on the 5th overlaps one starting on the 5th. */
export function rangesOverlap(a: DateRange, b: DateRange): boolean {
  return a.startDate <= b.endDate && b.startDate <= a.endDate;
}
