// Loan dates are whole days ("YYYY-MM-DD"). They're formatted in UTC so a date
// never shifts by one for people west of Greenwich.

const dayFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const dayWithYear = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const relative = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });
const stamp = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

function asUtc(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

export function formatDay(date: string): string {
  const year = new Date().getUTCFullYear();
  return asUtc(date).getUTCFullYear() === year
    ? dayFormat.format(asUtc(date))
    : dayWithYear.format(asUtc(date));
}

export function formatRange(startDate: string, endDate: string): string {
  return startDate === endDate ? formatDay(startDate) : `${formatDay(startDate)} – ${formatDay(endDate)}`;
}

export function formatTimeAgo(timestamp: number, now: number = Date.now()): string {
  const seconds = Math.round((timestamp - now) / 1000);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

export function formatStamp(timestamp: number): string {
  return stamp.format(new Date(timestamp));
}

/** Today in the browser's zone, as "YYYY-MM-DD". The server re-checks with its own clock. */
export function localToday(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
