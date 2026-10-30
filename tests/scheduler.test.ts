import { describe, expect, it } from "vitest";
import {
  DEFAULT_PREFERENCES,
  detectConflicts,
  evaluateMove,
  findFreeSlots,
  planDay,
  resolveConflict,
  suggestSlots,
  type TimedItem,
} from "@/lib/scheduler";
import { addDays, nowInTz, toMinutes, weekdayOf, zonedToDate, isDateStr } from "@/lib/dates";

const item = (id: string, date: string, start: string, end: string, extra: Partial<TimedItem> = {}): TimedItem => ({
  id,
  title: id,
  date,
  startTime: start,
  endTime: end,
  ...extra,
});

describe("dates", () => {
  it("knows weekdays (Monday = 0)", () => {
    expect(weekdayOf("2026-10-26")).toBe(0);
    expect(weekdayOf("2026-11-01")).toBe(6);
  });
  it("validates real calendar dates", () => {
    expect(isDateStr("2026-02-28")).toBe(true);
    expect(isDateStr("2026-02-31")).toBe(false);
    expect(isDateStr("2026-2-1")).toBe(false);
  });
  it("converts wall-clock time in a timezone to an instant, across DST", () => {
    expect(zonedToDate("2026-07-01", "09:00", "Europe/Berlin").toISOString()).toBe("2026-07-01T07:00:00.000Z");
    expect(zonedToDate("2026-12-01", "09:00", "Europe/Berlin").toISOString()).toBe("2026-12-01T08:00:00.000Z");
    expect(zonedToDate("2026-03-10", "09:00", "America/New_York").toISOString()).toBe("2026-03-10T13:00:00.000Z");
  });
  it("reads local date/time in a timezone", () => {
    const r = nowInTz("Asia/Tokyo", new Date("2026-10-28T20:30:00Z"));
    expect(r).toEqual({ date: "2026-10-29", minutes: 5 * 60 + 30 });
  });
});

describe("findFreeSlots", () => {
  it("returns gaps around busy blocks with a buffer", () => {
    const slots = findFreeSlots({
      windowStart: toMinutes("08:00"),
      windowEnd: toMinutes("12:00"),
      busy: [{ start: toMinutes("09:00"), end: toMinutes("10:00") }],
      buffer: 15,
      minDuration: 30,
    });
    expect(slots).toEqual([
      { start: toMinutes("08:00"), end: toMinutes("08:45") },
      { start: toMinutes("10:15"), end: toMinutes("12:00") },
    ]);
  });
  it("merges overlapping busy blocks", () => {
    const slots = findFreeSlots({
      windowStart: 0,
      windowEnd: 300,
      busy: [
        { start: 60, end: 120 },
        { start: 100, end: 180 },
      ],
      minDuration: 1,
    });
    expect(slots).toEqual([
      { start: 0, end: 60 },
      { start: 180, end: 300 },
    ]);
  });
});

describe("detectConflicts / resolveConflict", () => {
  it("detects a gym session during a lecture and suggests a later slot", () => {
    const lecture = item("lecture", "2026-10-28", "16:00", "18:00", { kind: "CLASS" });
    const gym = item("gym", "2026-10-28", "17:00", "18:00", { kind: "TASK" });
    const conflicts = detectConflicts([lecture, gym]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].overlapMinutes).toBe(60);
    const fix = resolveConflict(gym, [lecture, gym], DEFAULT_PREFERENCES);
    expect(fix).toEqual({ startTime: "18:15", endTime: "19:15" });
  });
  it("ignores completed items and back-to-back blocks", () => {
    expect(detectConflicts([item("a", "2026-10-28", "09:00", "10:00"), item("b", "2026-10-28", "10:00", "11:00")])).toHaveLength(0);
    expect(detectConflicts([item("a", "2026-10-28", "09:00", "10:00"), item("b", "2026-10-28", "09:30", "11:00", { completed: true })])).toHaveLength(0);
  });
});

describe("suggestSlots", () => {
  const today = "2026-10-26"; // Monday
  it("finds a slot before the deadline, outside work hours for university work", () => {
    const items = [item("class", "2026-10-26", "18:00", "20:00", { kind: "CLASS" })];
    const slots = suggestSlots({
      request: { durationMinutes: 120, deadlineDate: "2026-10-30", priority: "HIGH", isWork: false },
      items,
      prefs: DEFAULT_PREFERENCES,
      today,
      nowMinutes: toMinutes("07:00"),
    });
    expect(slots.length).toBeGreaterThan(0);
    for (const s of slots) {
      expect(s.date <= "2026-10-30").toBe(true);
      const start = toMinutes(s.startTime);
      const end = toMinutes(s.endTime);
      expect(end - start).toBe(120);
      // never during work hours on a weekday
      expect(end <= toMinutes("09:00") - 15 || start >= toMinutes("17:00") + 15).toBe(true);
      // never overlaps the class on Monday
      if (s.date === "2026-10-26") expect(end <= toMinutes("17:45") || start >= toMinutes("20:15")).toBe(true);
    }
  });
  it("schedules work tasks only inside work hours on work days", () => {
    const slots = suggestSlots({
      request: { durationMinutes: 60, priority: "MEDIUM", isWork: true },
      items: [],
      prefs: DEFAULT_PREFERENCES,
      today,
      nowMinutes: 0,
      horizonDays: 7,
    });
    for (const s of slots) {
      expect(weekdayOf(s.date)).toBeLessThan(5);
      expect(toMinutes(s.startTime) >= toMinutes("09:00")).toBe(true);
      expect(toMinutes(s.endTime) <= toMinutes("17:00")).toBe(true);
    }
  });
  it("does not suggest times that have already passed today", () => {
    const slots = suggestSlots({
      request: { durationMinutes: 60, priority: "URGENT", isWork: false },
      items: [],
      prefs: DEFAULT_PREFERENCES,
      today,
      nowMinutes: toMinutes("20:00"),
      horizonDays: 2,
    });
    for (const s of slots) if (s.date === today) expect(toMinutes(s.startTime)).toBeGreaterThanOrEqual(toMinutes("20:15"));
  });
});

describe("evaluateMove", () => {
  const today = "2026-10-26";
  it("warns when a task lands on the day before a deadline and offers a safer day", () => {
    const w = evaluateMove({ title: "Maths assignment", newDate: "2026-10-29", deadlineDate: "2026-10-30", estimatedMinutes: 120, today });
    expect(w?.message).toContain("only one day");
    expect(w?.saferDate).toBe("2026-10-28");
  });
  it("warns when moved past the deadline", () => {
    const w = evaluateMove({ title: "Essay", newDate: "2026-11-02", deadlineDate: "2026-10-30", today });
    expect(w?.level).toBe("warning");
  });
  it("stays quiet with plenty of buffer", () => {
    expect(evaluateMove({ title: "Essay", newDate: addDays(today, 1), deadlineDate: "2026-11-10", today })).toBeNull();
  });
});

describe("planDay", () => {
  it("fits tasks around fixed commitments, most urgent first, and postpones what does not fit", () => {
    const prefs = { ...DEFAULT_PREFERENCES, dayStart: "08:00", dayEnd: "12:00", workDays: [] as number[], bufferMinutes: 10, maxFocusMinutes: 90 };
    const { blocks, postponed } = planDay({
      date: "2026-10-31",
      fixed: [item("meeting", "2026-10-31", "09:00", "10:00", { kind: "MEETING" })],
      flexible: [
        { id: "low", title: "Tidy desk", priority: "LOW", estimatedMinutes: 30 },
        { id: "urgent", title: "Submit report", priority: "URGENT", estimatedMinutes: 45, deadlineDate: "2026-10-31" },
        { id: "big", title: "Thesis chapter", priority: "MEDIUM", estimatedMinutes: 240 },
        { id: "mid", title: "Reply emails", priority: "MEDIUM", estimatedMinutes: 60 },
      ],
      prefs,
    });
    const tasks = blocks.filter((b) => b.type === "task");
    expect(tasks[0].taskId).toBe("urgent");
    expect(tasks[0].startTime).toBe("08:00");
    // nothing overlaps the meeting
    for (const b of blocks.filter((b) => b.type !== "fixed")) {
      const s = toMinutes(b.startTime);
      const e = toMinutes(b.endTime);
      expect(e <= toMinutes("09:00") || s >= toMinutes("10:00")).toBe(true);
    }
    // the 4h task gets capped to the focus limit; whatever doesn't fit is postponed
    expect(blocks.length + postponed.length).toBeGreaterThanOrEqual(4);
    expect(postponed.map((p) => p.id)).toContain("low");
  });

  it("doesn't insert spurious breaks when an urgent task was placed later in the day", () => {
    // Regression: the urgent 2h task only fits in the evening; the small task must still
    // use the free afternoon gap instead of being postponed behind a phantom break.
    const prefs = { ...DEFAULT_PREFERENCES, dayStart: "08:00", dayEnd: "22:00", workDays: [] as number[], bufferMinutes: 15, maxFocusMinutes: 120 };
    const { blocks, postponed } = planDay({
      date: "2026-10-31",
      fixed: [item("lecture", "2026-10-31", "08:00", "17:00", { kind: "CLASS" }), item("gym", "2026-10-31", "18:30", "19:30")],
      flexible: [
        { id: "assignment", title: "Assignment", priority: "HIGH", estimatedMinutes: 120, deadlineDate: "2026-11-01" },
        { id: "groceries", title: "Groceries", priority: "MEDIUM", estimatedMinutes: 45 },
      ],
      prefs,
    });
    expect(postponed).toHaveLength(0);
    expect(blocks.find((b) => b.taskId === "groceries")?.startTime).toBe("17:15");
    expect(blocks.find((b) => b.taskId === "assignment")?.startTime).toBe("19:45");
    expect(blocks.some((b) => b.type === "break")).toBe(false);
  });

  it("adds a break between back-to-back blocks that exceed the focus limit", () => {
    const prefs = { ...DEFAULT_PREFERENCES, dayStart: "08:00", dayEnd: "14:00", workDays: [] as number[], bufferMinutes: 10, maxFocusMinutes: 90 };
    const { blocks } = planDay({
      date: "2026-10-31",
      fixed: [],
      flexible: [
        { id: "a", title: "A", priority: "HIGH", estimatedMinutes: 60 },
        { id: "b", title: "B", priority: "MEDIUM", estimatedMinutes: 60 },
      ],
      prefs,
    });
    expect(blocks.map((b) => b.type)).toEqual(["task", "break", "task"]);
  });
});
