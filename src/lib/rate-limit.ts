import { db } from "./db";
import { ApiError } from "./http";

/**
 * Fixed-window rate limiter backed by Postgres, so limits hold across
 * serverless instances (an in-memory counter would reset per instance).
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<void> {
  const rows = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimit" ("key", "count", "windowStart")
    VALUES (${key}, 1, NOW())
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimit"."windowStart" < NOW() - make_interval(secs => ${windowSeconds}) THEN 1 ELSE "RateLimit"."count" + 1 END,
      "windowStart" = CASE WHEN "RateLimit"."windowStart" < NOW() - make_interval(secs => ${windowSeconds}) THEN NOW() ELSE "RateLimit"."windowStart" END
    RETURNING "count"`;
  const count = Number(rows[0]?.count ?? 0);
  if (count > limit) {
    throw new ApiError(429, "Too many requests — please wait a moment and try again.", { retryAfterSeconds: windowSeconds });
  }
}
