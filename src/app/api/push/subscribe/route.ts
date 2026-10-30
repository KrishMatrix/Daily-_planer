import { z } from "zod";
import { db } from "@/lib/db";
import { ApiError, authed, json, parseBody } from "@/lib/http";
import { pushConfigured, sendPush } from "@/lib/push";

const subSchema = z
  .object({
    endpoint: z.url().max(1000).refine((u) => u.startsWith("https://"), "Push endpoint must be https"),
    keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }),
    expirationTime: z.number().nullable().optional(),
  })
  .strip();

export const GET = authed(async (_req, user) => {
  const count = await db.pushSubscription.count({ where: { userId: user.id } });
  return json({ configured: pushConfigured(), devices: count, publicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null });
});

export const POST = authed(async (req, user) => {
  if (!pushConfigured()) throw new ApiError(503, "Push notifications aren't configured on the server (missing VAPID keys).");
  const sub = await parseBody(req, subSchema);
  await db.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    update: { userId: user.id, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    create: { userId: user.id, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent: req.headers.get("user-agent")?.slice(0, 300) },
  });
  await sendPush(user.id, { title: "Notifications enabled", body: "You'll get reminders on this device.", url: "/settings" });
  return json({ ok: true }, { status: 201 });
});

export const DELETE = authed(async (req, user) => {
  const body = await parseBody(req, z.object({ endpoint: z.string().max(1000) }).strict());
  await db.pushSubscription.deleteMany({ where: { userId: user.id, endpoint: body.endpoint } });
  return json({ ok: true });
});
