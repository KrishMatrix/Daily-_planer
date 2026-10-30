// Calendar helpers that operate on local "YYYY-MM-DD" / "HH:mm" strings.
// All arithmetic is done in UTC so it never depends on the server's timezone.

export const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
export const WEEKDAYS_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export function isDateStr(s: unknown): s is string {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false;
  return toDateStr(parseDate(s)) === s; // rejects 2026-02-31
}

export function isTimeStr(s: unknown): s is string {
  return typeof s === "string" && TIME_RE.test(s);
}

export function parseDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(s: string, n: number): string {
  const d = parseDate(s);
  d.setUTCDate(d.getUTCDate() + n);
  return toDateStr(d);
}

export function addMonths(s: string, n: number): string | null {
  const [y, m, d] = s.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  if (d > lastDay) return null; // e.g. the 31st in a 30-day month
  target.setUTCDate(d);
  return toDateStr(target);
}

/** 0 = Monday … 6 = Sunday */
export function weekdayOf(s: string): number {
  return (parseDate(s).getUTCDay() + 6) % 7;
}

export function startOfWeek(s: string): string {
  return addDays(s, -weekdayOf(s));
}

export function diffDays(a: string, b: string): number {
  return Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / 86_400_000);
}

export function toMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export function fromMinutes(n: number): string {
  const c = Math.max(0, Math.min(23 * 60 + 59, Math.round(n)));
  return `${String(Math.floor(c / 60)).padStart(2, "0")}:${String(c % 60).padStart(2, "0")}`;
}

export function durationMinutes(start?: string | null, end?: string | null): number {
  if (!start || !end) return 0;
  return Math.max(0, toMinutes(end) - toMinutes(start));
}

/** Current local date and time ("YYYY-MM-DD", minutes since midnight) in an IANA timezone. */
export function nowInTz(timeZone: string, at: Date = new Date()): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

function tzOffsetMs(timeZone: string, at: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(at));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(at / 1000) * 1000;
}

/** Convert a wall-clock date+time in `timeZone` to an absolute Date. */
export function zonedToDate(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let ts = guess - tzOffsetMs(timeZone, guess);
  ts = guess - tzOffsetMs(timeZone, ts); // second pass handles DST boundaries
  return new Date(ts);
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function datesBetween(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

export function formatTime12(t: string): string {
  const m = toMinutes(t);
  const h = Math.floor(m / 60);
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const min = m % 60;
  return min === 0 ? `${h12} ${suffix}` : `${h12}:${String(min).padStart(2, "0")} ${suffix}`;
}

export function formatDateLong(s: string): string {
  return parseDate(s).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
}

export function formatDateShort(s: string): string {
  return parseDate(s).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}
