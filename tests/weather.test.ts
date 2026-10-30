import { describe, expect, it } from "vitest";
import { normalize } from "@/lib/weather";
import { goodOutdoorWindows, outdoorReason, weatherWarningFor } from "@/lib/weather-advice";
import { isWet, weatherGroup, weatherLabel } from "@/lib/weather-codes";

const loc = { label: "Test", lat: 49.2, lon: 7, unit: "celsius" as const, timezone: "Europe/Berlin" };

function hourly(date: string, codes: Record<string, [number, number]>) {
  const time: string[] = [], temperature_2m: number[] = [], weather_code: number[] = [], precipitation_probability: number[] = [], is_day: number[] = [];
  for (let h = 0; h < 24; h++) {
    const hh = String(h).padStart(2, "0");
    const [code, prob] = codes[hh] ?? [1, 0];
    time.push(`${date}T${hh}:00`);
    temperature_2m.push(18);
    weather_code.push(code);
    precipitation_probability.push(prob);
    is_day.push(h >= 7 && h < 19 ? 1 : 0);
  }
  return { time, temperature_2m, weather_code, precipitation_probability, is_day };
}

describe("weather codes", () => {
  it("maps WMO codes to groups and labels", () => {
    expect(weatherGroup(0)).toBe("clear");
    expect(weatherLabel(0)).toBe("Sunny");
    expect(weatherLabel(0, false)).toBe("Clear");
    expect(weatherLabel(63)).toBe("Rainy");
    expect(isWet(80)).toBe(true);
    expect(isWet(3)).toBe(false);
  });
});

describe("Open-Meteo normalisation", () => {
  it("turns column arrays into rows and drops incomplete rows instead of inventing values", () => {
    const f = normalize(
      {
        daily: {
          time: ["2026-11-02", "2026-11-03"],
          weather_code: [61, null],
          temperature_2m_max: [12.6, 14],
          temperature_2m_min: [5.4, 6],
          precipitation_probability_max: [80, 10],
          sunrise: ["2026-11-02T07:20", "2026-11-03T07:22"],
          sunset: ["2026-11-02T17:05", "2026-11-03T17:03"],
        },
        hourly: hourly("2026-11-02", {}),
        current: { time: "2026-11-02T10:00", temperature_2m: 9.6, weather_code: 3, is_day: 1 },
      },
      loc,
    );
    expect(f.daily).toHaveLength(1);
    expect(f.daily[0]).toMatchObject({ date: "2026-11-02", code: 61, tMax: 13, tMin: 5, precipProb: 80, sunrise: "07:20" });
    expect(f.hourly).toHaveLength(24);
    expect(f.current).toMatchObject({ temp: 10, code: 3, isDay: true });
  });
});

describe("weather-aware advice", () => {
  const f = {
    unit: "celsius" as const,
    daily: [{ date: "2026-11-07", code: 63, tMax: 15, tMin: 8, precipProb: 80, precipSum: 6, windMax: 10, uvMax: 1, sunrise: null, sunset: null }],
    hourly: [
      ...normalize({ hourly: hourly("2026-11-07", { "18": [63, 80], "19": [61, 60] }) }, loc).hourly,
      ...normalize({ hourly: hourly("2026-11-08", {}) }, loc).hourly,
    ],
  };
  const run = { id: "t1", title: "Evening run", date: "2026-11-07", startTime: "18:00", endTime: "19:00", completed: false };

  it("detects outdoor activities from the flag or the title", () => {
    expect(outdoorReason({ ...run, title: "Read paper" })).toBeNull();
    expect(outdoorReason({ ...run, title: "Read paper", outdoor: true })).toBe("marked");
    expect(outdoorReason(run)).toBe("guessed");
  });
  it("warns when rain is forecast during an outdoor activity, using hourly data", () => {
    const w = weatherWarningFor(run, f);
    expect(w?.maxProb).toBe(80);
    expect(w?.message).toMatch(/Rainy is forecast \(80% chance\)/);
    expect(weatherWarningFor({ ...run, startTime: "10:00", endTime: "11:00" }, f)).toBeNull();
    expect(weatherWarningFor({ ...run, title: "Library study" }, f)).toBeNull();
  });
  it("finds dry, mild windows and never looks beyond the data", () => {
    const wins = goodOutdoorWindows(f, "2026-11-07", 3);
    expect(wins.every((w) => w.maxProb <= 20)).toBe(true);
    expect(wins.some((w) => w.date === "2026-11-09")).toBe(false); // no data for the 9th
    expect(wins.find((w) => w.date === "2026-11-07" && w.part === "evening")).toBeUndefined();
  });
});
