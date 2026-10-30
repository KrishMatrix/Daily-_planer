import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { addDays, weekdayOf } from "@/lib/dates";
import { ApiError, authed, json, parseBody } from "@/lib/http";
import { createTask } from "@/lib/tasks";
import { classSessionSchema } from "@/lib/validation";

/** Recurring class series (the semester timetable). */
export const GET = authed(async (_req, user) => {
  const classes = await db.task.findMany({
    where: { userId: user.id, kind: "CLASS", NOT: { recurrence: { equals: Prisma.DbNull } } },
    include: { subject: { select: { id: true, name: true, color: true, code: true, semesterId: true } } },
    orderBy: [{ startTime: "asc" }],
  });
  return json({
    classes: classes.map((c) => ({
      id: c.id,
      title: c.title,
      subject: c.subject,
      startTime: c.startTime,
      endTime: c.endTime,
      location: c.location,
      recurrence: c.recurrence,
      date: c.date,
    })),
  });
});

/** Enter a class once — it repeats every week until the semester ends. */
export const POST = authed(async (req, user) => {
  const body = await parseBody(req, classSessionSchema);
  const [subject, semester, category] = await Promise.all([
    db.subject.findFirst({ where: { id: body.subjectId, userId: user.id } }),
    db.semester.findFirst({ where: { id: body.semesterId, userId: user.id } }),
    db.category.findFirst({ where: { userId: user.id, key: "university" } }),
  ]);
  if (!subject) throw new ApiError(400, "Unknown subject");
  if (!semester) throw new ApiError(400, "Unknown semester");
  // First matching weekday on/after the semester start.
  let first = semester.startDate;
  for (let i = 0; i < 7 && !body.weekdays.includes(weekdayOf(first)); i++) first = addDays(first, 1);
  if (first > semester.endDate) throw new ApiError(400, "No class days fall inside this semester");
  const item = await createTask(user.id, {
    title: `${subject.name}${body.type ? ` · ${body.type}` : ""}`,
    description: "",
    notes: "",
    kind: "CLASS",
    priority: "MEDIUM",
    completed: false,
    categoryId: category?.id ?? null,
    subjectId: subject.id,
    location: body.location || null,
    date: first,
    startTime: body.startTime,
    endTime: body.endTime,
    recurrence: { freq: "WEEKLY", interval: 1, byWeekday: [...body.weekdays].sort(), until: semester.endDate },
    reminderMinutes: body.reminderMinutes !== undefined ? [body.reminderMinutes] : [],
  });
  return json({ item }, { status: 201 });
});
