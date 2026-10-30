// Weather-aware planning hints computed from real forecast data (no AI).
// Weather is supporting information: these only ever *suggest* — nothing is moved automatically.

import { addDays, formatTime12, toMinutes, WEEKDAYS, weekdayOf } from "./dates";
import { isWet, weatherLabel, type DailyWeather, type Forecast, type HourlyWeather } from "./weather-codes";

type ItemLike = { id: string; title: string; date: string | null; startTime: string | null; endTime: string | null; outdoor?: boolean; completed: boolean; kind?: string; category?: { key: string | null } | null };

const OUTDOOR_WORDS = /\b(run|running|jog|jogging|hike|hiking|cycl\w*|bike ride|biking|walk|walking|outdoor\w*|park|football|soccer|tennis|picnic|bbq|barbecue|garden\w*)\b/i;

/** Explicitly marked outdoor, or a title that strongly suggests it. */
export function outdoorReason(i: ItemLike): "marked" | "guessed" | null {
  if (i.outdoor) return "marked";
  return OUTDOOR_WORDS.test(i.title) ? "guessed" : null;
}

/** Hours of the forecast overlapping an item's time block. */
export function hoursDuring(hourly: HourlyWeather[], date: string, start: string, end: string): HourlyWeather[] {
  const s = Math.floor(toMinutes(start) / 60) * 60;
  const e = toMinutes(end);
  return hourly.filter((h) => h.date === date && toMinutes(h.time) >= s && toMinutes(h.time) < Math.max(e, s + 60));
}

export type WeatherWarning = { itemId: string; title: string; date: string; startTime: string; message: string; maxProb: number | null; guessed: boolean };

/** Rain/snow/storm forecast during an outdoor activity (hourly data where available, else the daily summary). */
export function weatherWarningFor(i: ItemLike, f: Pick<Forecast, "hourly" | "daily">, threshold = 50): WeatherWarning | null {
  const why = outdoorReason(i);
  if (!why || i.completed || !i.date || !i.startTime) return null;
  const end = i.endTime ?? i.startTime;
  const hours = hoursDuring(f.hourly, i.date, i.startTime, end);
  const when = `${WEEKDAYS[weekdayOf(i.date)]} ${formatTime12(i.startTime)}`;
  if (hours.length) {
    const maxProb = Math.max(...hours.map((h) => h.precipProb ?? 0));
    const wet = hours.find((h) => isWet(h.code));
    if (maxProb >= threshold || (wet && maxProb >= 30)) {
      const label = wet ? weatherLabel(wet.code).toLowerCase() : "rain";
      return {
        itemId: i.id,
        title: i.title,
        date: i.date,
        startTime: i.startTime,
        maxProb,
        guessed: why === "guessed",
        message: `${capitalize(label)} is forecast (${maxProb}% chance) during "${i.title}" on ${when}. Consider moving it indoors or to a drier time.`,
      };
    }
    return null;
  }
  const day = f.daily.find((d) => d.date === i.date);
  if (day && day.precipProb !== null && day.precipProb >= threshold && isWet(day.code)) {
    return {
      itemId: i.id,
      title: i.title,
      date: i.date,
      startTime: i.startTime,
      maxProb: day.precipProb,
      guessed: why === "guessed",
      message: `${weatherLabel(day.code)} is forecast on ${WEEKDAYS[weekdayOf(i.date)]} (${day.precipProb}% chance) — "${i.title}" may get wet.`,
    };
  }
  return null;
}

export type OutdoorWindow = { date: string; part: "morning" | "afternoon" | "evening"; start: string; end: string; tMax: number; maxProb: number; message: string };

const PARTS = [
  { part: "morning", start: "08:00", end: "12:00" },
  { part: "afternoon", start: "12:00", end: "17:00" },
  { part: "evening", start: "17:00", end: "20:00" },
] as const;

/** Dry, mild blocks in the next `days` days, best first. Uses hourly data only (never extrapolates). */
export function goodOutdoorWindows(f: Pick<Forecast, "hourly" | "daily" | "unit">, from: string, days = 7, nowMinutes = 0): OutdoorWindow[] {
  const [lo, hi] = f.unit === "fahrenheit" ? [50, 84] : [10, 29];
  const out: OutdoorWindow[] = [];
  for (let d = from, n = 0; n < days; d = addDays(d, 1), n++) {
    for (const p of PARTS) {
      if (d === from && toMinutes(p.end) <= nowMinutes + 60) continue;
      const hours = f.hourly.filter((h) => h.date === d && h.time >= p.start && h.time < p.end && h.isDay);
      if (hours.length < 3) continue;
      const maxProb = Math.max(...hours.map((h) => h.precipProb ?? 100));
      const temps = hours.map((h) => h.temp);
      const tMax = Math.max(...temps);
      if (maxProb > 20 || hours.some((h) => isWet(h.code)) || Math.min(...temps) < lo || tMax > hi) continue;
      out.push({ date: d, part: p.part, start: p.start, end: p.end, tMax, maxProb, message: `${WEEKDAYS[weekdayOf(d)]} ${p.part} looks dry (${maxProb === 0 ? "no rain expected" : `rain chance ≤${maxProb}%`}) and up to ${tMax}°.` });
    }
  }
  // Prefer the driest, then the warmest within the comfortable range.
  return out.sort((a, b) => a.maxProb - b.maxProb || b.tMax - a.tMax || (a.date < b.date ? -1 : 1));
}

/** A compact per-day summary for the AI (only dates the provider returned). */
export function compactForecast(daily: DailyWeather[], from: string, to: string) {
  return daily
    .filter((d) => d.date >= from && d.date <= to)
    .map((d) => ({ date: d.date, cond: weatherLabel(d.code), hi: d.tMax, lo: d.tMin, rain_pct: d.precipProb }));
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
