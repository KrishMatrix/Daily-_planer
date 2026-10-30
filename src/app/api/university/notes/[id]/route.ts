import { db } from "@/lib/db";
import { authed, json, notFound, parseBody } from "@/lib/http";
import { lectureNoteSchema } from "@/lib/validation";

export const PATCH = authed<{ id: string }>(async (req, user, { id }) => {
  const body = await parseBody(req, lectureNoteSchema.omit({ subjectId: true }).partial());
  const res = await db.lectureNote.updateMany({ where: { id, userId: user.id }, data: body });
  if (!res.count) throw notFound("Note not found");
  return json({ note: await db.lectureNote.findUnique({ where: { id } }) });
});

export const DELETE = authed<{ id: string }>(async (_req, user, { id }) => {
  const res = await db.lectureNote.deleteMany({ where: { id, userId: user.id } });
  if (!res.count) throw notFound("Note not found");
  return json({ ok: true });
});
