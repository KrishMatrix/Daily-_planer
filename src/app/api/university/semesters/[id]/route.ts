import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { authed, json, notFound, parseBody } from "@/lib/http";
import type { Recurrence } from "@/lib/recurrence";
import { semesterSchema } from "@/lib/validation";

export const PATCH = authed<{ id: string }>(async (req, user, { id }) => {
  const body = await parseBody(req, semesterSchema);
  const existing = await db.semester.findFirst({ where: { id, userId: user.id } });
  if (!existing) throw notFound("Semester not found");
  const semester = await db.$transaction(async (tx) => {
    const s = await tx.semester.update({ where: { id }, data: body });
    if (body.endDate !== existing.endDate) {
      // Keep recurring classes in sync with the new semester end.
      const classes = await tx.task.findMany({
        where: { userId: user.id, kind: "CLASS", subject: { semesterId: id }, NOT: { recurrence: { equals: Prisma.DbNull } } },
      });
      for (const c of classes) {
        const rec = c.recurrence as Recurrence;
        await tx.task.update({ where: { id: c.id }, data: { recurrence: { ...rec, until: body.endDate }, version: { increment: 1 } } });
      }
    }
    return s;
  });
  return json({ semester });
});

export const DELETE = authed<{ id: string }>(async (_req, user, { id }) => {
  const existing = await db.semester.findFirst({ where: { id, userId: user.id } });
  if (!existing) throw notFound("Semester not found");
  await db.semester.delete({ where: { id } });
  return json({ ok: true });
});
