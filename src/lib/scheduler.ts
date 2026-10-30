// Deterministic scheduling engine. The AI layer only ever chooses between and
// explains slots computed here, so it cannot invent free time that doesn't exist.

import { addDays, diffDays, fromMinutes, toMinutes, weekdayOf } from "./dates";

export type PriorityLevel = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

export type TimedItem = {
  id: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  kind?: string;
  categoryKey?: string | null;
  completed?: boolean;
};

export type Interval = { start: number; end: number };

export type Preferences = {
  dayStart: string;
  dayEnd: string;
  workDays: number[];
  workStart: string;
  workEnd: string;
  bufferMinutes: number;
  maxFocusMinutes: number;
};

export const DEFAULT_PREFERENCES: Preferences = {
  dayStart: "08:00",
  dayEnd: "22:00",
  workDays: [0, 1, 2, 3, 4],
  workStart: "09:00",
  workEnd: "17:00",
  bufferMinutes: 15,
  maxFocusMinutes: 120,
};

export const PRIORITY_WEIGHT: Record<PriorityLevel, number> = { LOW: 1, MEDIUM: 2, HIGH: 3, URGENT: 4 };

export function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = list.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ ...i });
  }
  return out;
}

/** Free gaps inside [windowStart, windowEnd] that are at least `minDuration` long, keeping a buffer around busy blocks. */
export function findFreeSlots(opts: {
  windowStart: number;
  windowEnd: number;
  busy: Interval[];
  buffer?: number;
  minDuration?: number;
}): Interval[] {
  const buffer = opts.buffer ?? 0;
  const min = opts.minDuration ?? 1;
  const busy = mergeIntervals(opts.busy.map((b) => ({ start: b.start - buffer, end: b.end + buffer })));
  const out: Interval[] = [];
  let cursor = opts.windowStart;
  for (const b of busy) {
    if (b.end <= cursor) continue;
    if (b.start >= opts.windowEnd) break;
    if (b.start - cursor >= min) out.push({ start: cursor, end: b.start });
    cursor = Math.max(cursor, b.end);
  }
  if (opts.windowEnd - cursor >= min) out.push({ start: cursor, end: opts.windowEnd });
  return out;
}

export function busyByDate(items: TimedItem[]): Map<string, Interval[]> {
  const map = new Map<string, Interval[]>();
  for (const it of items) {
    if (it.completed) continue;
    const list = map.get(it.date) ?? [];
    list.push({ start: toMinutes(it.startTime), end: toMinutes(it.endTime) });
    map.set(it.date, list);
  }
  return map;
}

export type Conflict = { date: string; a: TimedItem; b: TimedItem; overlapMinutes: number };

/** Overlapping timed items on the same date (completed items are ignored). */
export function detectConflicts(items: TimedItem[]): Conflict[] {
  const byDate = new Map<string, TimedItem[]>();
  for (const it of items) {
    if (it.completed) continue;
    if (toMinutes(it.endTime) <= toMinutes(it.startTime)) continue;
    byDate.set(it.date, [...(byDate.get(it.date) ?? []), it]);
  }
  const out: Conflict[] = [];
  for (const [date, list] of byDate) {
    const sorted = [...list].sort((x, y) => toMinutes(x.startTime) - toMinutes(y.startTime));
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const a = sorted[i];
        const b = sorted[j];
        if (toMinutes(b.startTime) >= toMinutes(a.endTime)) break;
        const overlap = Math.min(toMinutes(a.endTime), toMinutes(b.endTime)) - toMinutes(b.startTime);
        if (overlap > 0) out.push({ date, a, b, overlapMinutes: overlap });
      }
    }
  }
  return out;
}

/** Items that are "fixed" commitments and should not be moved automatically. */
export function isFixedKind(kind?: string): boolean {
  return kind === "CLASS" || kind === "MEETING" || kind === "EXAM";
}

/**
 * For a conflict involving `movable`, find the nearest free slot on the same day
 * after the commitment it clashes with, keeping its duration.
 */
export function resolveConflict(
  movable: TimedItem,
  dayItems: TimedItem[],
  prefs: Preferences,
): { startTime: string; endTime: string } | null {
  const duration = toMinutes(movable.endTime) - toMinutes(movable.startTime);
  const others = dayItems.filter((i) => i.id !== movable.id && !i.completed);
  const slots = findFreeSlots({
    windowStart: toMinutes(prefs.dayStart),
    windowEnd: toMinutes(prefs.dayEnd),
    busy: others.map((o) => ({ start: toMinutes(o.startTime), end: toMinutes(o.endTime) })),
    buffer: prefs.bufferMinutes,
    minDuration: duration,
  });
  if (!slots.length) return null;
  const original = toMinutes(movable.startTime);
  const best = [...slots].sort((a, b) => {
    const da = a.start >= original ? a.start - original : (original - a.start) * 1.5;
    const db = b.start >= original ? b.start - original : (original - b.start) * 1.5;
    return da - db;
  })[0];
  const start = Math.ceil(best.start / 15) * 15;
  if (start + duration > best.end) return { startTime: fromMinutes(best.start), endTime: fromMinutes(best.start + duration) };
  return { startTime: fromMinutes(start), endTime: fromMinutes(start + duration) };
}

export type SlotRequest = {
  durationMinutes: number;
  deadlineDate?: string | null;
  priority: PriorityLevel;
  isWork: boolean;
};

export type SlotCandidate = { date: string; startTime: string; endTime: string; score: number; reasons: string[] };

/**
 * Rank candidate slots for a new task across the coming days.
 * Heuristics: finish at least a day before the deadline, respect work hours
 * (work tasks inside, personal/university tasks outside on work days),
 * prefer daytime, and pull high-priority work earlier.
 */
export function suggestSlots(opts: {
  request: SlotRequest;
  items: TimedItem[];
  prefs: Preferences;
  today: string;
  nowMinutes: number;
  horizonDays?: number;
  limit?: number;
}): SlotCandidate[] {
  const { request, prefs, today } = opts;
  const duration = Math.max(15, Math.min(request.durationMinutes, 8 * 60));
  let lastDay = addDays(today, (opts.horizonDays ?? 14) - 1);
  if (request.deadlineDate && request.deadlineDate >= today && request.deadlineDate < lastDay) lastDay = request.deadlineDate;
  const busy = busyByDate(opts.items);
  const candidates: SlotCandidate[] = [];
  const dayStart = toMinutes(prefs.dayStart);
  const dayEnd = toMinutes(prefs.dayEnd);
  const workStart = toMinutes(prefs.workStart);
  const workEnd = toMinutes(prefs.workEnd);

  for (let d = today; d <= lastDay; d = addDays(d, 1)) {
    const isWorkDay = prefs.workDays.includes(weekdayOf(d));
    let windowStart = dayStart;
    if (d === today) windowStart = Math.max(dayStart, Math.ceil((opts.nowMinutes + 15) / 15) * 15);
    let windowEnd = dayEnd;
    const extraBusy: Interval[] = [];
    if (isWorkDay) {
      if (request.isWork) {
        windowStart = Math.max(windowStart, workStart);
        windowEnd = Math.min(windowEnd, workEnd);
      } else {
        extraBusy.push({ start: workStart, end: workEnd });
      }
    } else if (request.isWork) {
      continue; // don't schedule work on days off
    }
    const free = findFreeSlots({
      windowStart,
      windowEnd,
      busy: [...(busy.get(d) ?? []), ...extraBusy],
      buffer: prefs.bufferMinutes,
      minDuration: duration,
    });
    for (const slot of free) {
      // Try the start of each free gap, plus an afternoon start if the gap is long.
      const starts = new Set([Math.ceil(slot.start / 15) * 15]);
      if (slot.end - slot.start >= duration + 120) starts.add(Math.max(Math.ceil(slot.start / 15) * 15, 14 * 60));
      for (const start of starts) {
        if (start + duration > slot.end) continue;
        const reasons: string[] = [];
        let score = 100;
        const daysOut = diffDays(today, d);
        if (request.deadlineDate) {
          const margin = diffDays(d, request.deadlineDate);
          if (margin < 0) continue;
          if (margin === 0) {
            score -= 35;
            reasons.push("on the deadline day");
          } else if (margin === 1) {
            score -= 10;
            reasons.push("one day before the deadline");
          } else reasons.push(`${margin} days before the deadline`);
        }
        score -= daysOut * (PRIORITY_WEIGHT[request.priority] + 1);
        if (start < 9 * 60 || start + duration > 21 * 60) {
          score -= 12;
          reasons.push("outside your most productive hours");
        }
        if (slot.end - slot.start >= duration + 60) {
          score += 5;
          reasons.push("leaves breathing room around it");
        }
        if (isWorkDay && !request.isWork) reasons.push("outside work hours");
        candidates.push({ date: d, startTime: fromMinutes(start), endTime: fromMinutes(start + duration), score, reasons });
      }
    }
  }
  return candidates.sort((a, b) => b.score - a.score).slice(0, opts.limit ?? 5);
}

export type MoveWarning = { level: "info" | "warning"; message: string; saferDate?: string };

/** Evaluate whether moving a task to `newDate` is practical. Never blocks the move. */
export function evaluateMove(opts: {
  title: string;
  newDate: string;
  deadlineDate?: string | null;
  estimatedMinutes?: number | null;
  today: string;
  freeMinutesByDate?: Map<string, number>;
}): MoveWarning | null {
  const { newDate, deadlineDate, today } = opts;
  if (!deadlineDate) return null;
  const margin = diffDays(newDate, deadlineDate);
  const pickSafer = (): string | undefined => {
    const candidates: string[] = [];
    for (let d = addDays(deadlineDate, -2); d >= today && candidates.length < 4; d = addDays(d, -1)) candidates.push(d);
    if (!candidates.length) return undefined;
    if (!opts.freeMinutesByDate) return candidates[0];
    return [...candidates].sort((a, b) => (opts.freeMinutesByDate!.get(b) ?? 0) - (opts.freeMinutesByDate!.get(a) ?? 0))[0];
  };
  if (margin < 0) {
    const saferDate = pickSafer();
    return { level: "warning", message: `"${opts.title}" is now scheduled after its deadline (${deadlineDate}).`, saferDate };
  }
  if (margin === 0) {
    const saferDate = pickSafer();
    return { level: "warning", message: `"${opts.title}" is now on its deadline day — there's no buffer if something goes wrong.`, saferDate };
  }
  if (margin === 1 && (opts.estimatedMinutes ?? 60) >= 90) {
    const saferDate = pickSafer();
    return { level: "info", message: `Moving "${opts.title}" leaves only one day before the deadline.`, saferDate };
  }
  return null;
}

export type FlexibleTask = {
  id: string;
  title: string;
  priority: PriorityLevel;
  estimatedMinutes?: number | null;
  deadlineDate?: string | null;
  isWork?: boolean;
};

export type PlanBlock = {
  type: "fixed" | "task" | "break";
  title: string;
  startTime: string;
  endTime: string;
  taskId?: string;
};

export function urgencyScore(t: FlexibleTask, today: string): number {
  let s = PRIORITY_WEIGHT[t.priority] * 10;
  if (t.deadlineDate) {
    const days = diffDays(today, t.deadlineDate);
    if (days < 0) s += 50;
    else s += Math.max(0, 30 - days * 5);
  }
  return s;
}

/** Greedy day plan: fill free time around fixed commitments, most urgent first, with breaks. */
export function planDay(opts: {
  date: string;
  fixed: TimedItem[];
  flexible: FlexibleTask[];
  prefs: Preferences;
  startFrom?: number;
}): { blocks: PlanBlock[]; postponed: FlexibleTask[] } {
  const { prefs } = opts;
  const windowStart = Math.max(toMinutes(prefs.dayStart), opts.startFrom ?? 0);
  const windowEnd = toMinutes(prefs.dayEnd);
  const isWorkDay = prefs.workDays.includes(weekdayOf(opts.date));
  const fixedBlocks: PlanBlock[] = opts.fixed
    .filter((f) => !f.completed)
    .map((f) => ({ type: "fixed" as const, title: f.title, startTime: f.startTime, endTime: f.endTime, taskId: f.id }));
  const busy: Interval[] = fixedBlocks.map((b) => ({ start: toMinutes(b.startTime), end: toMinutes(b.endTime) }));
  const sorted = [...opts.flexible].sort((a, b) => urgencyScore(b, opts.date) - urgencyScore(a, opts.date));
  const placed: PlanBlock[] = [];
  const postponed: FlexibleTask[] = [];
  // Minutes of back-to-back task blocks ending right before `start` (tasks are placed
  // in urgency order, not time order, so look at the actual neighbours).
  const focusBefore = (start: number) => {
    let total = 0;
    let cursor = start;
    for (;;) {
      const prev = placed.find((b) => b.type === "task" && toMinutes(b.endTime) <= cursor && cursor - toMinutes(b.endTime) <= prefs.bufferMinutes * 2);
      if (!prev) return total;
      total += toMinutes(prev.endTime) - toMinutes(prev.startTime);
      cursor = toMinutes(prev.startTime);
    }
  };

  for (const task of sorted) {
    const duration = Math.max(15, Math.min(task.estimatedMinutes ?? 45, prefs.maxFocusMinutes));
    const extra: Interval[] = [];
    if (isWorkDay && !task.isWork) extra.push({ start: toMinutes(prefs.workStart), end: toMinutes(prefs.workEnd) });
    if (isWorkDay && task.isWork) {
      extra.push({ start: 0, end: toMinutes(prefs.workStart) }, { start: toMinutes(prefs.workEnd), end: 24 * 60 });
    }
    const slots = findFreeSlots({
      windowStart,
      windowEnd,
      busy: [...busy, ...extra],
      buffer: prefs.bufferMinutes,
      minDuration: duration,
    });
    const slot = slots[0];
    if (!slot) {
      postponed.push(task);
      continue;
    }
    let start = Math.ceil(slot.start / 5) * 5;
    // Insert a real break once a focus run gets too long.
    const run = focusBefore(start);
    if (run > 0 && run + duration > prefs.maxFocusMinutes) {
      const breakLen = Math.max(15, prefs.bufferMinutes);
      if (start + breakLen + prefs.bufferMinutes + duration > slot.end) {
        postponed.push(task);
        continue;
      }
      placed.push({ type: "break", title: "Break", startTime: fromMinutes(start), endTime: fromMinutes(start + breakLen) });
      busy.push({ start, end: start + breakLen });
      start += breakLen + prefs.bufferMinutes;
    }
    placed.push({ type: "task", title: task.title, startTime: fromMinutes(start), endTime: fromMinutes(start + duration), taskId: task.id });
    busy.push({ start, end: start + duration });
  }

  const blocks = [...fixedBlocks, ...placed].sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));
  return { blocks, postponed };
}

/** Sum of scheduled (timed, incomplete) minutes for a date. */
export function scheduledMinutes(items: TimedItem[], date: string): number {
  return mergeIntervals(
    items.filter((i) => i.date === date && !i.completed).map((i) => ({ start: toMinutes(i.startTime), end: toMinutes(i.endTime) })),
  ).reduce((s, i) => s + (i.end - i.start), 0);
}
