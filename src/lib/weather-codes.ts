// Client-safe helpers for WMO weather codes (as returned by Open-Meteo).
// https://open-meteo.com/en/docs → "WMO Weather interpretation codes"

export type WeatherGroup = "clear" | "partly" | "cloudy" | "fog" | "drizzle" | "rain" | "showers" | "snow" | "storm";

export type DailyWeather = {
  date: string;
  code: number;
  tMax: number;
  tMin: number;
  precipProb: number | null;
  precipSum: number | null;
  windMax: number | null;
  uvMax: number | null;
  sunrise: string | null; // HH:mm
  sunset: string | null;
};

export type HourlyWeather = { date: string; time: string; temp: number; code: number; precipProb: number | null; precip: number | null; wind: number | null; isDay: boolean };

export type CurrentWeather = { time: string; temp: number; apparent: number | null; code: number; isDay: boolean; wind: number | null; humidity: number | null };

export type Forecast = {
  location: { label: string; lat: number; lon: number };
  unit: "celsius" | "fahrenheit";
  timezone: string;
  fetchedAt: string;
  /** True when the provider was unreachable and an older cached forecast is shown. */
  stale: boolean;
  current: CurrentWeather | null;
  daily: DailyWeather[];
  hourly: HourlyWeather[];
};

export type WeatherResponse = { configured: false } | ({ configured: true } & Forecast) | { configured: true; error: string };

const GROUP: Record<number, WeatherGroup> = {
  0: "clear",
  1: "clear",
  2: "partly",
  3: "cloudy",
  45: "fog",
  48: "fog",
  51: "drizzle",
  53: "drizzle",
  55: "drizzle",
  56: "drizzle",
  57: "drizzle",
  61: "rain",
  63: "rain",
  65: "rain",
  66: "rain",
  67: "rain",
  71: "snow",
  73: "snow",
  75: "snow",
  77: "snow",
  80: "showers",
  81: "showers",
  82: "showers",
  85: "snow",
  86: "snow",
  95: "storm",
  96: "storm",
  99: "storm",
};

const LABEL: Record<number, string> = {
  0: "Sunny",
  1: "Mostly sunny",
  2: "Partly cloudy",
  3: "Cloudy",
  45: "Foggy",
  48: "Freezing fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Heavy drizzle",
  56: "Freezing drizzle",
  57: "Freezing drizzle",
  61: "Light rain",
  63: "Rainy",
  65: "Heavy rain",
  66: "Freezing rain",
  67: "Freezing rain",
  71: "Light snow",
  73: "Snowy",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Showers",
  81: "Showers",
  82: "Heavy showers",
  85: "Snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorms",
  96: "Thunderstorms & hail",
  99: "Thunderstorms & hail",
};

export function weatherGroup(code: number): WeatherGroup {
  return GROUP[code] ?? "cloudy";
}

export function weatherLabel(code: number, isDay = true): string {
  if (!isDay && code <= 1) return code === 0 ? "Clear" : "Mostly clear";
  return LABEL[code] ?? "Unknown";
}

/** Wet or severe weather that matters for outdoor plans. */
export function isWet(code: number): boolean {
  const g = weatherGroup(code);
  return g === "drizzle" || g === "rain" || g === "showers" || g === "snow" || g === "storm";
}

export const tempUnit = (u: Forecast["unit"]) => (u === "fahrenheit" ? "°F" : "°C");
export const windUnit = (u: Forecast["unit"]) => (u === "fahrenheit" ? "mph" : "km/h");
