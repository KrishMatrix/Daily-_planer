import { db } from "@/lib/db";
import { ApiError, authed, json, notFound, parseBody } from "@/lib/http";
import { subjectSchema } from "@/lib/validation";

export const PATCH = authed<{ id: string }>(async (req, user, { id }) => {
  const body = await parseBody(req, subjectSchema.partial());
  const existing = await db.subject.findFirst({ where: { id, userId: user.id } });
  if (!existing) throw notFound("Subject not found");
  if (body.semesterId) {
    const s = await db.semester.findFirst({ where: { id: body.semesterId, userId: user.id } });
    if (!s) throw new ApiError(400, "Unknown semester");
  }
  const subject = await db.subject.update({ where: { id }, data: body });
  return json({ subject });
});

/** Deletes the subject and its recurring classes; assignments/exams are kept but unlinked. */
export const DELETE = authed<{ id: string }>(async (_req, user, { id }) => {
  const existing = await db.subject.findFirst({ where: { id, userId: user.id } });
  if (!existing) throw notFound("Subject not found");
  await db.$transaction([
    db.task.deleteMany({ where: { userId: user.id, subjectId: id, kind: "CLASS" } }),
    db.subject.delete({ where: { id } }),
  ]);
  return json({ ok: true });
});
