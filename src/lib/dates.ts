/**
 * Date-only helpers. Task dates are stored as "YYYY-MM-DD" strings and handled in UTC
 * internally, so a due date never shifts by a day across time zones.
 */

export const DAY_MS = 86_400_000;

/** Today's calendar date in the viewer's local time zone, as "YYYY-MM-DD". */
export function todayISO(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function toUTC(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

export function fromUTC(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, n: number): string {
  return fromUTC(new Date(toUTC(iso).getTime() + n * DAY_MS));
}

/** Whole days from `a` to `b` (b - a). */
export function diffDays(a: string, b: string): number {
  return Math.round((toUTC(b).getTime() - toUTC(a).getTime()) / DAY_MS);
}

export function startOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

export function addMonths(iso: string, n: number): string {
  const d = toUTC(startOfMonth(iso));
  d.setUTCMonth(d.getUTCMonth() + n);
  return fromUTC(d);
}

/** Monday-based weekday index 0..6. */
export function weekdayMon(iso: string): number {
  return (toUTC(iso).getUTCDay() + 6) % 7;
}

export function startOfWeek(iso: string): string {
  return addDays(iso, -weekdayMon(iso));
}

const fmtShort = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const fmtMonth = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const fmtWeekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });

export const formatShort = (iso: string) => fmtShort.format(toUTC(iso));
export const formatMonth = (iso: string) => fmtMonth.format(toUTC(iso));
export const formatWeekday = (iso: string) => fmtWeekday.format(toUTC(iso));

export type DueState = "overdue" | "today" | "soon" | "later";

/** How urgent a due date is relative to today. Done tasks are never "overdue". */
export function dueState(due: string | null, done: boolean, today = todayISO()): DueState | null {
  if (!due || done) return due ? "later" : null;
  const d = diffDays(today, due);
  if (d < 0) return "overdue";
  if (d === 0) return "today";
  if (d <= 2) return "soon";
  return "later";
}

/** Human label: "Today", "Tomorrow", "Yesterday", or "Nov 28". */
export function relativeDueLabel(due: string, today = todayISO()): string {
  const d = diffDays(today, due);
  if (d === 0) return "Today";
  if (d === 1) return "Tomorrow";
  if (d === -1) return "Yesterday";
  return formatShort(due);
}
