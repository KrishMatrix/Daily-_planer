import "server-only";
import { db } from "./db";
import { ApiError } from "./http";
import type { CurrentWeather, DailyWeather, Forecast, HourlyWeather } from "./weather-codes";

// Open-Meteo (https://open-meteo.com) — free for non-commercial use, no API key.
// Forecasts are cached in Postgres and shared between users at the same
// location, so a busy week of page loads costs a handful of upstream calls.

const FORECAST_URL = process.env.WEATHER_FORECAST_URL || "https://api.open-meteo.com/v1/forecast";
const GEOCODE_URL = process.env.WEATHER_GEOCODE_URL || "https://geocoding-api.open-meteo.com/v1/search";
const FRESH_MS = 30 * 60_000; // refresh at most every 30 min per location
const STALE_MAX_MS = 48 * 3_600_000; // serve an old forecast if the provider is down
export const FORECAST_DAYS = 16; // Open-Meteo's maximum
const PAST_DAYS = 7; // so the current week's earlier days still show their weather

export type WeatherLocation = { label: string; lat: number; lon: number; unit: "celsius" | "fahrenheit"; timezone: string };

const inflight = new Map<string, Promise<Forecast>>();

export async function getForecast(loc: WeatherLocation): Promise<Forecast> {
  const key = `${loc.lat.toFixed(2)},${loc.lon.toFixed(2)}|${loc.unit}|${loc.timezone}`;
  const cached = await db.weatherCache.findUnique({ where: { key } });
  const age = cached ? Date.now() - cached.fetchedAt.getTime() : Infinity;
  const withLabel = (f: Forecast, stale = false): Forecast => ({ ...f, location: { ...f.location, label: loc.label }, stale });
  if (cached && age < FRESH_MS) return withLabel(cached.data as unknown as Forecast);

  let p = inflight.get(key);
  if (!p) {
    p = fetchForecast(loc).finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  try {
    const fresh = await p;
    await db.weatherCache.upsert({
      where: { key },
      update: { data: fresh as unknown as object, fetchedAt: new Date(fresh.fetchedAt) },
      create: { key, data: fresh as unknown as object, fetchedAt: new Date(fresh.fetchedAt) },
    });
    return withLabel(fresh);
  } catch (e) {
    if (cached && age < STALE_MAX_MS) return withLabel(cached.data as unknown as Forecast, true);
    throw e instanceof ApiError ? e : new ApiError(503, "The weather service is unavailable right now.");
  }
}

type OpenMeteoResponse = {
  timezone?: string;
  current?: Record<string, number | string>;
  daily?: Record<string, (number | string | null)[]>;
  hourly?: Record<string, (number | string | null)[]>;
};

async function fetchForecast(loc: WeatherLocation): Promise<Forecast> {
  const params = new URLSearchParams({
    latitude: loc.lat.toFixed(4),
    longitude: loc.lon.toFixed(4),
    timezone: loc.timezone,
    forecast_days: String(FORECAST_DAYS),
    past_days: String(PAST_DAYS),
    current: "temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m,relative_humidity_2m",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max,uv_index_max,sunrise,sunset",
    hourly: "temperature_2m,weather_code,precipitation_probability,precipitation,wind_speed_10m,is_day",
  });
  if (loc.unit === "fahrenheit") {
    params.set("temperature_unit", "fahrenheit");
    params.set("wind_speed_unit", "mph");
  }
  let res: Response;
  try {
    res = await fetch(`${FORECAST_URL}?${params}`, { signal: AbortSignal.timeout(8000), cache: "no-store" });
  } catch {
    throw new ApiError(503, "Couldn't reach the weather service.");
  }
  if (!res.ok) {
    console.error("[weather] provider error", res.status);
    throw new ApiError(503, res.status === 429 ? "The weather service is rate-limiting requests. Try again later." : "The weather service is unavailable right now.");
  }
  const data = (await res.json()) as OpenMeteoResponse;
  return normalize(data, loc);
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const hm = (iso: unknown) => (typeof iso === "string" && iso.length >= 16 ? iso.slice(11, 16) : null);

/** Convert Open-Meteo's column arrays into rows. Rows with missing core values are dropped, never filled in. */
export function normalize(data: OpenMeteoResponse, loc: WeatherLocation): Forecast {
  const d = data.daily ?? {};
  const daily: DailyWeather[] = [];
  (d.time ?? []).forEach((date, i) => {
    const code = num(d.weather_code?.[i]);
    const tMax = num(d.temperature_2m_max?.[i]);
    const tMin = num(d.temperature_2m_min?.[i]);
    if (typeof date !== "string" || code === null || tMax === null || tMin === null) return;
    daily.push({
      date,
      code,
      tMax: Math.round(tMax),
      tMin: Math.round(tMin),
      precipProb: num(d.precipitation_probability_max?.[i]),
      precipSum: num(d.precipitation_sum?.[i]),
      windMax: num(d.wind_speed_10m_max?.[i]),
      uvMax: num(d.uv_index_max?.[i]),
      sunrise: hm(d.sunrise?.[i]),
      sunset: hm(d.sunset?.[i]),
    });
  });

  const h = data.hourly ?? {};
  const hourly: HourlyWeather[] = [];
  (h.time ?? []).forEach((t, i) => {
    const temp = num(h.temperature_2m?.[i]);
    const code = num(h.weather_code?.[i]);
    if (typeof t !== "string" || temp === null || code === null) return;
    hourly.push({
      date: t.slice(0, 10),
      time: t.slice(11, 16),
      temp: Math.round(temp),
      code,
      precipProb: num(h.precipitation_probability?.[i]),
      precip: num(h.precipitation?.[i]),
      wind: num(h.wind_speed_10m?.[i]),
      isDay: h.is_day?.[i] !== 0,
    });
  });

  const c = data.current;
  const current: CurrentWeather | null =
    c && num(c.temperature_2m) !== null && num(c.weather_code) !== null
      ? {
          time: String(c.time ?? ""),
          temp: Math.round(num(c.temperature_2m)!),
          apparent: num(c.apparent_temperature) !== null ? Math.round(num(c.apparent_temperature)!) : null,
          code: num(c.weather_code)!,
          isDay: c.is_day !== 0,
          wind: num(c.wind_speed_10m),
          humidity: num(c.relative_humidity_2m),
        }
      : null;

  return {
    location: { label: loc.label, lat: loc.lat, lon: loc.lon },
    unit: loc.unit,
    timezone: data.timezone ?? loc.timezone,
    fetchedAt: new Date().toISOString(),
    stale: false,
    current,
    daily,
    hourly,
  };
}

export type Place = { id: number; name: string; admin1?: string; country?: string; countryCode?: string; lat: number; lon: number; timezone?: string; label: string };

const geoCache = new Map<string, { at: number; places: Place[] }>();

export async function searchPlaces(query: string): Promise<Place[]> {
  const q = query.trim().toLowerCase();
  const hit = geoCache.get(q);
  if (hit && Date.now() - hit.at < 24 * 3_600_000) return hit.places;
  const params = new URLSearchParams({ name: query.trim(), count: "8", language: "en", format: "json" });
  let res: Response;
  try {
    res = await fetch(`${GEOCODE_URL}?${params}`, { signal: AbortSignal.timeout(6000), cache: "no-store" });
  } catch {
    throw new ApiError(503, "Couldn't reach the location search service.");
  }
  if (!res.ok) throw new ApiError(503, "Location search is unavailable right now.");
  const data = (await res.json()) as {
    results?: { id: number; name: string; admin1?: string; country?: string; country_code?: string; latitude: number; longitude: number; timezone?: string }[];
  };
  const places = (data.results ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    admin1: r.admin1,
    country: r.country,
    countryCode: r.country_code,
    lat: r.latitude,
    lon: r.longitude,
    timezone: r.timezone,
    label: [r.name, r.admin1 && r.admin1 !== r.name ? r.admin1 : null, r.country].filter(Boolean).join(", "),
  }));
  if (geoCache.size > 500) geoCache.clear();
  geoCache.set(q, { at: Date.now(), places });
  return places;
}

/** The user's saved forecast, or null when no location is set. Never throws for provider outages. */
export async function getUserForecast(user: { id: string; timezone: string }): Promise<Forecast | null> {
  const s = await db.userSettings.findUnique({ where: { userId: user.id }, select: { weatherLabel: true, weatherLat: true, weatherLon: true, weatherUnit: true } });
  if (!s || s.weatherLat === null || s.weatherLon === null) return null;
  try {
    return await getForecast({
      label: s.weatherLabel ?? "Saved location",
      lat: s.weatherLat,
      lon: s.weatherLon,
      unit: s.weatherUnit === "fahrenheit" ? "fahrenheit" : "celsius",
      timezone: user.timezone,
    });
  } catch {
    return null;
  }
}
