import { db } from "@/lib/db";
import { authed, json, notFound } from "@/lib/http";

export const DELETE = authed<{ id: string }>(async (_req, user, { id }) => {
  const res = await db.task.deleteMany({ where: { id, userId: user.id, kind: "CLASS" } });
  if (!res.count) throw notFound("Class not found");
  return json({ ok: true });
});
