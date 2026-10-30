import "server-only";
import { createHash } from "node:crypto";
import { db } from "../db";

// Cache AI answers by a hash of the exact compact input sent to the model.
// If the schedule (and therefore the input) hasn't changed, the stored answer is
// reused and no tokens are spent. Any edit changes the hash, so stale answers aren't served.

export function cacheKey(feature: string, model: string, payload: unknown): string {
  return createHash("sha256").update(`${feature}\n${model}\n${JSON.stringify(payload)}`).digest("hex");
}

export async function getCachedAnswer<T>(userId: string, key: string): Promise<T | null> {
  const hit = await db.aiCache.findUnique({ where: { userId_key: { userId, key } } });
  if (!hit || hit.expiresAt < new Date()) return null;
  return hit.response as T;
}

export async function setCachedAnswer(userId: string, feature: string, key: string, response: unknown, ttlMinutes: number) {
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);
  await db.aiCache.upsert({
    where: { userId_key: { userId, key } },
    update: { response: response as object, expiresAt, createdAt: new Date() },
    create: { userId, feature, key, response: response as object, expiresAt },
  });
}

export async function purgeExpiredAiCache() {
  await db.aiCache.deleteMany({ where: { expiresAt: { lt: new Date() } } });
}
