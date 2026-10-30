import { db } from "@/lib/db";
import { ApiError, authed, json, parseBody } from "@/lib/http";
import { lectureNoteSchema } from "@/lib/validation";

export const GET = authed(async (req, user) => {
  const subjectId = req.nextUrl.searchParams.get("subjectId") ?? undefined;
  const notes = await db.lectureNote.findMany({
    where: { userId: user.id, subjectId },
    orderBy: [{ date: { sort: "desc", nulls: "last" } }, { updatedAt: "desc" }],
    include: { subject: { select: { id: true, name: true, color: true } } },
    take: 200,
  });
  return json({ notes });
});

export const POST = authed(async (req, user) => {
  const body = await parseBody(req, lectureNoteSchema);
  const subject = await db.subject.findFirst({ where: { id: body.subjectId, userId: user.id } });
  if (!subject) throw new ApiError(400, "Unknown subject");
  const note = await db.lectureNote.create({ data: { ...body, userId: user.id } });
  return json({ note }, { status: 201 });
});
