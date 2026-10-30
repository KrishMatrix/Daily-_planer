import { ApiError, authed, json } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { searchPlaces } from "@/lib/weather";

/** City search (Open-Meteo geocoding), proxied so the client never calls third parties directly. */
export const GET = authed(async (req, user) => {
  await rateLimit(`geocode:${user.id}`, 60, 600);
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return json({ places: [] });
  if (q.length > 80) throw new ApiError(400, "Search text is too long");
  return json({ places: await searchPlaces(q) });
});
