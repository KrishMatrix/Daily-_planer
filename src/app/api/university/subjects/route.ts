import { db } from "@/lib/db";
import { ApiError, authed, json, parseBody } from "@/lib/http";
import { subjectSchema } from "@/lib/validation";

export const GET = authed(async (_req, user) => {
  const subjects = await db.subject.findMany({
    where: { userId: user.id },
    orderBy: { name: "asc" },
    include: { _count: { select: { tasks: true, notes: true } }, semester: { select: { id: true, name: true } } },
  });
  return json({ subjects });
});

export const POST = authed(async (req, user) => {
  const body = await parseBody(req, subjectSchema);
  if (body.semesterId) {
    const s = await db.semester.findFirst({ where: { id: body.semesterId, userId: user.id } });
    if (!s) throw new ApiError(400, "Unknown semester");
  }
  const subject = await db.subject.create({ data: { ...body, userId: user.id } });
  return json({ subject }, { status: 201 });
});
