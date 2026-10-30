import { addDays, addMonths, diffDays, startOfWeek, weekdayOf } from "./dates";

export type Recurrence = {
  freq: "DAILY" | "WEEKLY" | "MONTHLY";
  interval: number;
  /** 0 = Monday … 6 = Sunday (WEEKLY only). Defaults to the start date's weekday. */
  byWeekday?: number[];
  until?: string;
  count?: number;
};

const MAX_ITERATIONS = 10_000;

/**
 * Expand a recurring series into occurrence dates inside [rangeStart, rangeEnd].
 * `count` counts every generated occurrence from the series start (RFC 5545 semantics),
 * and excluded dates are removed after counting.
 */
export function expandOccurrences(
  startDate: string,
  rec: Recurrence,
  exDates: string[],
  rangeStart: string,
  rangeEnd: string,
): string[] {
  const interval = Math.max(1, Math.floor(rec.interval || 1));
  const until = rec.until && rec.until < rangeEnd ? rec.until : rangeEnd;
  const excluded = new Set(exDates);
  const out: string[] = [];
  let generated = 0;
  const push = (d: string): boolean => {
    if (d < startDate) return true;
    if (d > until) return false;
    generated++;
    if (rec.count && generated > rec.count) return false;
    if (d >= rangeStart && !excluded.has(d)) out.push(d);
    return true;
  };

  if (rec.freq === "DAILY") {
    // Skip ahead when there's no count to honour.
    let k = 0;
    if (!rec.count && rangeStart > startDate) k = Math.floor(diffDays(startDate, rangeStart) / interval);
    for (let i = 0; i < MAX_ITERATIONS; i++, k++) {
      if (!push(addDays(startDate, k * interval))) break;
    }
  } else if (rec.freq === "WEEKLY") {
    const days = [...new Set(rec.byWeekday?.length ? rec.byWeekday : [weekdayOf(startDate)])]
      .filter((d) => d >= 0 && d <= 6)
      .sort((a, b) => a - b);
    const firstWeek = startOfWeek(startDate);
    let w = 0;
    if (!rec.count && rangeStart > startDate) w = Math.max(0, Math.floor(diffDays(firstWeek, rangeStart) / 7 / interval) - 1);
    outer: for (let i = 0; i < MAX_ITERATIONS; i++, w++) {
      const weekStart = addDays(firstWeek, w * 7 * interval);
      for (const d of days) {
        if (!push(addDays(weekStart, d))) break outer;
      }
    }
  } else if (rec.freq === "MONTHLY") {
    for (let k = 0; k < 1200; k += interval) {
      const d = addMonths(startDate, k);
      if (d === null) continue; // month without that day
      if (!push(d)) break;
    }
  }
  return out;
}

export function describeRecurrence(rec: Recurrence | null | undefined): string {
  if (!rec) return "Does not repeat";
  const names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const every = rec.interval > 1 ? `Every ${rec.interval} ` : "Every ";
  let base: string;
  if (rec.freq === "DAILY") base = rec.interval > 1 ? `${every}days` : "Daily";
  else if (rec.freq === "WEEKLY") {
    const days = rec.byWeekday?.length ? ` on ${rec.byWeekday.map((d) => names[d]).join(", ")}` : "";
    base = (rec.interval > 1 ? `${every}weeks` : "Weekly") + days;
  } else base = rec.interval > 1 ? `${every}months` : "Monthly";
  if (rec.until) base += ` until ${rec.until}`;
  if (rec.count) base += `, ${rec.count} times`;
  return base;
}
