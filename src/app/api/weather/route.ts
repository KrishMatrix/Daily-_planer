import { db } from "@/lib/db";
import { ApiError, authed, json } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { getForecast } from "@/lib/weather";

/** The forecast for the user's saved location. Served from a shared cache; refreshed at most every 30 minutes. */
export const GET = authed(async (_req, user) => {
  await rateLimit(`weather:${user.id}`, 600, 3600); // served from the shared cache; upstream calls are limited separately
  const s = await db.userSettings.findUnique({ where: { userId: user.id }, select: { weatherLabel: true, weatherLat: true, weatherLon: true, weatherUnit: true } });
  if (!s || s.weatherLat === null || s.weatherLon === null) return json({ configured: false });
  try {
    const forecast = await getForecast({
      label: s.weatherLabel ?? "Saved location",
      lat: s.weatherLat,
      lon: s.weatherLon,
      unit: s.weatherUnit === "fahrenheit" ? "fahrenheit" : "celsius",
      timezone: user.timezone,
    });
    return json({ configured: true, ...forecast }, { headers: { "Cache-Control": "private, max-age=300" } });
  } catch (e) {
    // Weather is supporting information — report the outage without failing the page.
    return json({ configured: true, error: e instanceof ApiError ? e.message : "Weather is unavailable right now." });
  }
});
