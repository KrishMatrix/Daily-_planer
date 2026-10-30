import { db } from "@/lib/db";
import { authed, json, parseBody } from "@/lib/http";
import { semesterSchema } from "@/lib/validation";

export const GET = authed(async (_req, user) => {
  const semesters = await db.semester.findMany({ where: { userId: user.id }, orderBy: { startDate: "desc" } });
  return json({ semesters });
});

export const POST = authed(async (req, user) => {
  const body = await parseBody(req, semesterSchema);
  const semester = await db.semester.create({ data: { ...body, userId: user.id } });
  return json({ semester }, { status: 201 });
});
