import { describe, expect, it } from "vitest";
import { expandOccurrences, describeRecurrence } from "@/lib/recurrence";

describe("expandOccurrences", () => {
  it("expands weekly classes on several weekdays until the semester ends", () => {
    // 2026-10-26 is a Monday. Mon + Wed until Nov 8.
    const dates = expandOccurrences("2026-10-26", { freq: "WEEKLY", interval: 1, byWeekday: [0, 2], until: "2026-11-08" }, [], "2026-10-01", "2026-12-31");
    expect(dates).toEqual(["2026-10-26", "2026-10-28", "2026-11-02", "2026-11-04"]);
  });

  it("respects the requested range and excluded dates", () => {
    const dates = expandOccurrences("2026-10-01", { freq: "DAILY", interval: 1 }, ["2026-10-11"], "2026-10-10", "2026-10-13");
    expect(dates).toEqual(["2026-10-10", "2026-10-12", "2026-10-13"]);
  });

  it("supports intervals and counts from the series start", () => {
    const dates = expandOccurrences("2026-01-01", { freq: "DAILY", interval: 3, count: 4 }, [], "2026-01-05", "2026-12-31");
    // occurrences: Jan 1, 4, 7, 10 → only 7 and 10 are in range
    expect(dates).toEqual(["2026-01-07", "2026-01-10"]);
  });

  it("does not generate dates before the series starts (weekly, mid-week start)", () => {
    // Start on Wednesday with Mon+Wed pattern → first Monday is skipped.
    const dates = expandOccurrences("2026-10-28", { freq: "WEEKLY", interval: 1, byWeekday: [0, 2] }, [], "2026-10-26", "2026-11-03");
    expect(dates).toEqual(["2026-10-28", "2026-11-02"]);
  });

  it("handles bi-weekly series far in the future", () => {
    const dates = expandOccurrences("2026-01-05", { freq: "WEEKLY", interval: 2 }, [], "2026-03-01", "2026-03-31");
    expect(dates).toEqual(["2026-03-02", "2026-03-16", "2026-03-30"]);
  });

  it("skips months that lack the day for monthly series", () => {
    const dates = expandOccurrences("2026-01-31", { freq: "MONTHLY", interval: 1 }, [], "2026-01-01", "2026-05-31");
    expect(dates).toEqual(["2026-01-31", "2026-03-31", "2026-05-31"]);
  });

  it("describes recurrence rules", () => {
    expect(describeRecurrence({ freq: "WEEKLY", interval: 1, byWeekday: [0, 2], until: "2027-02-01" })).toBe("Weekly on Mon, Wed until 2027-02-01");
    expect(describeRecurrence(null)).toBe("Does not repeat");
  });
});
