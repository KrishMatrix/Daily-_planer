import "server-only";
import { Prisma, type Task } from "@prisma/client";
import { db } from "./db";
import { ApiError, notFound } from "./http";
import { addDays, diffDays, durationMinutes, nowInTz } from "./dates";
import { expandOccurrences, type Recurrence } from "./recurrence";
import { DEFAULT_PREFERENCES, detectConflicts, evaluateMove, findFreeSlots, isFixedKind, resolveConflict, type Preferences, type TimedItem } from "./scheduler";
import type { Insight, ScheduleItem } from "./types";
import { getUserForecast } from "./weather";
import { weatherWarningFor } from "./weather-advice";
import type { TaskCreateInput, TaskUpdateInput } from "./validation";

const include = {
  category: { select: { id: true, name: true, color: true, key: true } },
  subject: { select: { id: true, name: true, color: true, code: true } },
  _count: { select: { attachments: true } },
} satisfies Prisma.TaskInclude;

type TaskRow = Prisma.TaskGetPayload<{ include: typeof include }>;

export function toItem(t: TaskRow, occurrenceDate: string | null = null): ScheduleItem {
  const isOcc = occurrenceDate !== null;
  return {
    id: isOcc ? `${t.id}@${occurrenceDate}` : t.id,
    taskId: t.id,
    occurrenceDate,
    isRecurring: Boolean(t.recurrence) || Boolean(t.seriesId),
    seriesId: t.seriesId ?? (t.recurrence ? t.id : null),
    title: t.title,
    description: t.description,
    notes: t.notes,
    kind: t.kind,
    priority: t.priority,
    categoryId: t.categoryId,
    category: t.category,
    subjectId: t.subjectId,
    subject: t.subject,
    project: t.project,
    location: t.location,
    outdoor: t.outdoor,
    date: isOcc ? occurrenceDate : t.date,
    startTime: t.startTime,
    endTime: t.endTime,
    deadlineDate: isOcc ? null : t.deadlineDate,
    deadlineTime: isOcc ? null : t.deadlineTime,
    estimatedMinutes: t.estimatedMinutes,
    completed: isOcc ? false : t.completed,
    completedAt: isOcc ? null : (t.completedAt?.toISOString() ?? null),
    recurrence: (t.recurrence as Recurrence | null) ?? null,
    reminderMinutes: t.reminderMinutes,
    sortOrder: t.sortOrder,
    version: t.version,
    attachmentCount: t._count.attachments,
    updatedAt: t.updatedAt.toISOString(),
  };
}

export function parseItemId(id: string): { taskId: string; occurrenceDate: string | null } {
  const at = id.indexOf("@");
  if (at === -1) return { taskId: id, occurrenceDate: null };
  return { taskId: id.slice(0, at), occurrenceDate: id.slice(at + 1) };
}

/** All items (one-off tasks + expanded recurring occurrences) whose date is in [start, end]. */
export async function getItemsInRange(userId: string, start: string, end: string): Promise<ScheduleItem[]> {
  if (diffDays(start, end) > 400) throw new ApiError(400, "Range too large (max 400 days)");
  const [single, series] = await Promise.all([
    db.task.findMany({
      where: { userId, date: { gte: start, lte: end }, recurrence: { equals: Prisma.DbNull } },
      include,
    }),
    db.task.findMany({
      where: { userId, date: { lte: end }, NOT: { recurrence: { equals: Prisma.DbNull } } },
      include,
    }),
  ]);
  const items = single.map((t) => toItem(t));
  for (const s of series) {
    const dates = expandOccurrences(s.date!, s.recurrence as Recurrence, s.exDates, start, end);
    for (const d of dates) items.push(toItem(s, d));
  }
  return sortItems(items);
}

export function sortItems(items: ScheduleItem[]) {
  return items.sort((a, b) => {
    if (a.date !== b.date) return (a.date ?? "") < (b.date ?? "") ? -1 : 1;
    if (a.startTime && b.startTime) return a.startTime < b.startTime ? -1 : a.startTime > b.startTime ? 1 : 0;
    if (a.startTime) return -1;
    if (b.startTime) return 1;
    return a.sortOrder - b.sortOrder;
  });
}

/** Incomplete one-off tasks (unscheduled, with deadlines, or overdue) — used for assignments, inbox and deadlines. */
export async function getOpenTasks(userId: string): Promise<ScheduleItem[]> {
  const rows = await db.task.findMany({
    where: { userId, completed: false, recurrence: { equals: Prisma.DbNull }, kind: { not: "CLASS" } },
    include,
    orderBy: [{ deadlineDate: { sort: "asc", nulls: "last" } }, { date: { sort: "asc", nulls: "first" } }],
    take: 500,
  });
  return rows.map((t) => toItem(t));
}

async function assertRefs(userId: string, data: { categoryId?: string | null; subjectId?: string | null }) {
  if (data.categoryId) {
    const c = await db.category.findFirst({ where: { id: data.categoryId, userId }, select: { id: true } });
    if (!c) throw new ApiError(400, "Unknown category");
  }
  if (data.subjectId) {
    const s = await db.subject.findFirst({ where: { id: data.subjectId, userId }, select: { id: true } });
    if (!s) throw new ApiError(400, "Unknown subject");
  }
}

function normalize<T extends Partial<TaskUpdateInput>>(data: T): T {
  const out = { ...data };
  // Clearing the start time clears the end time too.
  if (out.startTime === null) out.endTime = null;
  // A timed task with no end gets its estimated duration (or 1h).
  return out;
}

export async function createTask(userId: string, input: TaskCreateInput): Promise<ScheduleItem> {
  await assertRefs(userId, input);
  const data = normalize(input);
  if (data.startTime && !data.endTime) {
    const mins = data.estimatedMinutes ?? 60;
    const [h, m] = data.startTime.split(":").map(Number);
    const end = Math.min(h * 60 + m + mins, 23 * 60 + 59);
    data.endTime = `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
  }
  if (data.startTime && data.endTime && !data.estimatedMinutes) data.estimatedMinutes = durationMinutes(data.startTime, data.endTime) || null;
  const task = await db.task.create({
    data: {
      ...data,
      userId,
      recurrence: data.recurrence ?? Prisma.DbNull,
      completedAt: data.completed ? new Date() : null,
    },
    include,
  });
  return toItem(task);
}

async function getOwnedTask(userId: string, taskId: string) {
  const task = await db.task.findFirst({ where: { id: taskId, userId }, include });
  if (!task) throw notFound("Task not found");
  return task;
}

function copyFields(t: Task) {
  return {
    userId: t.userId,
    title: t.title,
    description: t.description,
    notes: t.notes,
    kind: t.kind,
    priority: t.priority,
    categoryId: t.categoryId,
    subjectId: t.subjectId,
    project: t.project,
    location: t.location,
    outdoor: t.outdoor,
    startTime: t.startTime,
    endTime: t.endTime,
    estimatedMinutes: t.estimatedMinutes,
    reminderMinutes: t.reminderMinutes,
    sortOrder: t.sortOrder,
  };
}

function toUpdateData(changes: TaskUpdateInput, current: { completed: boolean }): Prisma.TaskUncheckedUpdateInput {
  const data: Prisma.TaskUncheckedUpdateInput = { ...normalize(changes), recurrence: undefined };
  if ("recurrence" in changes) data.recurrence = changes.recurrence ?? Prisma.DbNull;
  if (changes.completed !== undefined && changes.completed !== current.completed) {
    data.completedAt = changes.completed ? new Date() : null;
  }
  return data;
}

/** Update a task or one occurrence of a recurring series. Returns the resulting item. */
export async function updateItem(
  userId: string,
  itemId: string,
  changes: TaskUpdateInput,
  scope: "occurrence" | "series",
  version?: number,
): Promise<{ item: ScheduleItem; previousDate: string | null }> {
  await assertRefs(userId, changes);
  const { taskId, occurrenceDate } = parseItemId(itemId);
  const task = await getOwnedTask(userId, taskId);

  if (occurrenceDate && task.recurrence) {
    if (scope === "series") {
      const data = toUpdateData(changes, task);
      if (changes.date) {
        // Shift the whole series by the same number of days as this occurrence moved.
        data.date = addDays(task.date!, diffDays(occurrenceDate, changes.date));
      }
      delete data.completed;
      delete data.completedAt;
      const updated = await db.task.update({ where: { id: task.id }, data: { ...data, version: { increment: 1 } }, include });
      return { item: toItem(updated, changes.date ?? occurrenceDate), previousDate: occurrenceDate };
    }
    // Detach this single occurrence into its own task and exclude it from the series.
    const { recurrence: _ignored, ...rest } = changes;
    void _ignored;
    const child = await db.$transaction(async (tx) => {
      await tx.task.update({ where: { id: task.id }, data: { exDates: { push: occurrenceDate } } });
      return tx.task.create({
        data: {
          ...copyFields(task),
          seriesId: task.id,
          originalDate: occurrenceDate,
          date: occurrenceDate,
          ...normalize(rest),
          completedAt: rest.completed ? new Date() : null,
          recurrence: Prisma.DbNull,
        },
        include,
      });
    });
    return { item: toItem(child), previousDate: occurrenceDate };
  }

  if (version !== undefined && version !== task.version) {
    throw new ApiError(409, "This task was changed on another device. Showing the latest version.", { current: toItem(task) });
  }
  const data = toUpdateData(changes, task);
  const updated = await db.task.updateMany({
    where: { id: task.id, userId, version: task.version },
    data: { ...(data as Prisma.TaskUncheckedUpdateManyInput), version: { increment: 1 } },
  });
  if (updated.count === 0) {
    const latest = await getOwnedTask(userId, taskId);
    throw new ApiError(409, "This task was changed on another device. Showing the latest version.", { current: toItem(latest) });
  }
  const fresh = await getOwnedTask(userId, taskId);
  return { item: toItem(fresh), previousDate: task.date };
}

export async function deleteItem(userId: string, itemId: string, scope: "occurrence" | "series") {
  const { taskId, occurrenceDate } = parseItemId(itemId);
  const task = await getOwnedTask(userId, taskId);
  if (occurrenceDate && task.recurrence && scope === "occurrence") {
    await db.task.update({ where: { id: task.id }, data: { exDates: { push: occurrenceDate } } });
    return;
  }
  if (scope === "series" && task.seriesId) {
    await db.task.deleteMany({ where: { id: task.seriesId, userId } });
    return;
  }
  await db.task.delete({ where: { id: task.id } });
}

export async function duplicateItem(userId: string, itemId: string): Promise<ScheduleItem> {
  const { taskId, occurrenceDate } = parseItemId(itemId);
  const task = await getOwnedTask(userId, taskId);
  const copy = await db.task.create({
    data: {
      ...copyFields(task),
      title: `${task.title} (copy)`,
      date: occurrenceDate ?? task.date,
      deadlineDate: occurrenceDate ? null : task.deadlineDate,
      deadlineTime: occurrenceDate ? null : task.deadlineTime,
      recurrence: occurrenceDate ? Prisma.DbNull : (task.recurrence ?? Prisma.DbNull),
      sortOrder: task.sortOrder + 0.5,
    },
    include,
  });
  return toItem(copy);
}

export async function getPreferences(userId: string): Promise<Preferences> {
  const s = await db.userSettings.findUnique({ where: { userId } });
  if (!s) return DEFAULT_PREFERENCES;
  return {
    dayStart: s.dayStart,
    dayEnd: s.dayEnd,
    workDays: s.workDays,
    workStart: s.workStart,
    workEnd: s.workEnd,
    bufferMinutes: s.bufferMinutes,
    maxFocusMinutes: s.maxFocusMinutes,
  };
}

export function toTimed(items: ScheduleItem[]): TimedItem[] {
  return items
    .filter((i) => i.date && i.startTime && i.endTime)
    .map((i) => ({
      id: i.id,
      title: i.title,
      date: i.date!,
      startTime: i.startTime!,
      endTime: i.endTime!,
      kind: i.kind,
      categoryKey: i.category?.key ?? null,
      completed: i.completed,
    }));
}

/** Non-blocking advice after a create/update: conflicts and risky moves. */
export async function computeInsights(
  userId: string,
  timezone: string,
  item: ScheduleItem,
  previousDate: string | null,
): Promise<Insight[]> {
  if (!item.date || item.completed) return [];
  const insights: Insight[] = [];
  const prefs = await getPreferences(userId);
  const today = nowInTz(timezone).date;

  if (item.startTime && item.endTime) {
    const dayItems = toTimed(await getItemsInRange(userId, item.date, item.date));
    const self = dayItems.find((d) => d.id === item.id) ?? toTimed([item])[0];
    const conflicts = detectConflicts(dayItems).filter((c) => c.a.id === self.id || c.b.id === self.id);
    for (const c of conflicts.slice(0, 2)) {
      const other = c.a.id === self.id ? c.b : c.a;
      // Move the flexible one; if both are fixed, suggest moving the item just edited.
      const movable = isFixedKind(self.kind) && !isFixedKind(other.kind) ? other : self;
      const fix = resolveConflict(movable, dayItems, prefs);
      const label = (k?: string) => (k === "CLASS" ? "lecture" : k === "MEETING" ? "meeting" : k === "EXAM" ? "exam" : "task");
      insights.push({
        type: "conflict",
        level: "warning",
        message: `"${self.title}" overlaps your ${label(other.kind)} "${other.title}" (${other.startTime}–${other.endTime}).${
          fix ? ` Move "${movable.title}" to ${fix.startTime}?` : ""
        }`,
        fix: fix ? { itemId: movable.id, changes: fix, label: `Move to ${fix.startTime}` } : undefined,
      });
    }
  }

  if (previousDate && previousDate !== item.date && item.deadlineDate) {
    const freeMinutes = new Map<string, number>();
    const windowItems = toTimed(await getItemsInRange(userId, today, item.deadlineDate < today ? today : item.deadlineDate));
    for (let d = today; d <= item.deadlineDate; d = addDays(d, 1)) {
      const busy = windowItems.filter((w) => w.date === d && !w.completed).map((w) => ({ start: toMin(w.startTime), end: toMin(w.endTime) }));
      const free = findFreeSlots({ windowStart: toMin(prefs.dayStart), windowEnd: toMin(prefs.dayEnd), busy, minDuration: 30 });
      freeMinutes.set(d, free.reduce((s, f) => s + f.end - f.start, 0));
    }
    const warn = evaluateMove({
      title: item.title,
      newDate: item.date,
      deadlineDate: item.deadlineDate,
      estimatedMinutes: item.estimatedMinutes,
      today,
      freeMinutesByDate: freeMinutes,
    });
    if (warn) {
      insights.push({
        type: "move",
        level: warn.level,
        message: warn.saferDate ? `${warn.message} ${weekdayName(warn.saferDate)} would be safer.` : warn.message,
        fix: warn.saferDate ? { itemId: item.id, changes: { date: warn.saferDate }, label: `Move to ${weekdayName(warn.saferDate)}` } : undefined,
      });
    }
  }
  const moved = previousDate !== null && previousDate !== item.date;
  const dayName = weekdayName(item.date);

  // Excessive workload on the destination day (only when the item just landed there).
  if (moved || previousDate === null) {
    const dayItems = await getItemsInRange(userId, item.date, item.date);
    const timed = toTimed(dayItems).filter((t) => !t.completed);
    const busy = timed.reduce((s, t) => s + toMin(t.endTime) - toMin(t.startTime), 0);
    const untimed = dayItems.filter((d) => !d.startTime && !d.completed).reduce((s, d) => s + (d.estimatedMinutes ?? 0), 0);
    const active = toMin(prefs.dayEnd) - toMin(prefs.dayStart);
    const load = busy + untimed;
    if (moved && active > 0 && load > active * 0.8) {
      insights.push({
        type: "workload",
        level: "warning",
        message: `${dayName} now has about ${Math.round(load / 6) / 10} h planned — over 80% of your active hours.`,
        askAi: `${dayName} (${item.date}) looks overloaded after I moved "${item.title}" there. What could I move to another day?`,
      });
    }
  }

  // Preparation time: studying after the exam it's for, or an exam/meeting pulled closer with open prep work.
  if (moved && item.subjectId) {
    const open = await db.task.findMany({
      where: { userId, subjectId: item.subjectId, completed: false, id: { not: item.taskId } },
      select: { title: true, kind: true, date: true, deadlineDate: true },
    });
    if (item.kind !== "EXAM") {
      const exam = open.find((t) => t.kind === "EXAM" && t.date && t.date >= today && t.date < item.date!);
      if (exam)
        insights.push({
          type: "prep",
          level: "warning",
          message: `"${item.title}" is now after your exam "${exam.title}" on ${weekdayName(exam.date!)}.`,
          askAi: `I moved "${item.title}" to ${item.date}, after my exam "${exam.title}" on ${exam.date}. Help me fit my preparation in before the exam.`,
        });
    } else if (previousDate && item.date < previousDate) {
      const prep = open.filter((t) => t.kind !== "EXAM" && t.kind !== "CLASS");
      const days = diffDays(today, item.date);
      if (prep.length && days <= 3)
        insights.push({
          type: "prep",
          level: "warning",
          message: `Only ${days} day${days === 1 ? "" : "s"} until "${item.title}" and ${prep.length} prep task${prep.length === 1 ? " is" : "s are"} still open.`,
          askAi: `My exam "${item.title}" moved earlier to ${item.date}. I still have ${prep.length} open prep tasks. Help me plan the remaining days.`,
        });
    }
  }

  // Weather (supporting information only): rain forecast during an outdoor activity.
  if (item.startTime && (moved || previousDate === null || item.outdoor)) {
    const forecast = await getUserForecast({ id: userId, timezone });
    const w = forecast ? weatherWarningFor(item, forecast) : null;
    if (w) {
      insights.push({
        type: "weather",
        level: "info",
        message: w.message,
        askAi: `${w.message} Find me a drier time for it this week, or suggest an indoor alternative. Use the weather forecast.`,
      });
    }
  }

  // Serious risks get a one-tap route to deeper AI analysis (only spent if the user taps it).
  for (const ins of insights) {
    if (!ins.askAi && ins.level === "warning" && ins.type !== "conflict") ins.askAi = `${ins.message} What do you recommend?`;
  }
  return insights;
}

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const weekdayName = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });

/** One-off tasks of a built-in category (open + completed in the last 60 days), e.g. the ZeMA Work section. */
export async function getCategoryTasks(userId: string, categoryKey: string): Promise<ScheduleItem[]> {
  const since = new Date(Date.now() - 60 * 86_400_000);
  const rows = await db.task.findMany({
    where: {
      userId,
      category: { key: categoryKey },
      recurrence: { equals: Prisma.DbNull },
      OR: [{ completed: false }, { completedAt: { gte: since } }],
    },
    include,
    orderBy: [{ date: { sort: "asc", nulls: "last" } }, { startTime: { sort: "asc", nulls: "last" } }],
    take: 500,
  });
  return rows.map((t) => toItem(t));
}

/** Recently completed one-off tasks (last 60 days), newest first. */
export async function getCompletedTasks(userId: string): Promise<ScheduleItem[]> {
  const since = new Date(Date.now() - 60 * 86_400_000);
  const rows = await db.task.findMany({
    where: { userId, completed: true, completedAt: { gte: since }, recurrence: { equals: Prisma.DbNull }, kind: { not: "CLASS" } },
    include,
    orderBy: { completedAt: "desc" },
    take: 300,
  });
  return rows.map((t) => toItem(t));
}
