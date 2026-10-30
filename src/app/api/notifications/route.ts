import { z } from "zod";
import { db } from "@/lib/db";
import { authed, json, parseBody } from "@/lib/http";

export const GET = authed(async (_req, user) => {
  const [notifications, unread] = await Promise.all([
    db.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 50 }),
    db.notification.count({ where: { userId: user.id, read: false } }),
  ]);
  return json({ notifications, unread });
});

const patchSchema = z.object({ ids: z.array(z.string().max(40)).max(100).optional(), all: z.boolean().optional() }).strict();

export const PATCH = authed(async (req, user) => {
  const body = await parseBody(req, patchSchema);
  await db.notification.updateMany({
    where: { userId: user.id, read: false, ...(body.all ? {} : { id: { in: body.ids ?? [] } }) },
    data: { read: true },
  });
  return json({ ok: true });
});

export const DELETE = authed(async (_req, user) => {
  await db.notification.deleteMany({ where: { userId: user.id, read: true } });
  return json({ ok: true });
});
