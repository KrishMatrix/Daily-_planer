import "server-only";
import { addDays, durationMinutes, nowInTz, startOfWeek } from "./dates";
import { getItemsInRange, getOpenTasks } from "./tasks";
import type { ScheduleItem } from "./types";

const countsTowardsCompletion = (i: ScheduleItem) => i.kind !== "CLASS" && i.kind !== "MEETING" && i.kind !== "EVENT";

/** Facts only — every number here is derived directly from the user's data. */
export async function computeStats(userId: string, timezone: string, weeks = 8) {
  const today = nowInTz(timezone).date;
  const weekStart = startOfWeek(today);
  const weekEnd = addDays(weekStart, 6);
  const trendStart = addDays(weekStart, -7 * (weeks - 1));
  const [items, open] = await Promise.all([getItemsInRange(userId, trendStart, weekEnd), getOpenTasks(userId)]);

  const trend = Array.from({ length: weeks }, (_, w) => {
    const ws = addDays(trendStart, w * 7);
    const we = addDays(ws, 6);
    const inWeek = items.filter((i) => i.date! >= ws && i.date! <= we && countsTowardsCompletion(i));
    const completed = inWeek.filter((i) => i.completed).length;
    return { weekStart: ws, completed, total: inWeek.length };
  });

  const days = Array.from({ length: 7 }, (_, d) => {
    const date = addDays(weekStart, d);
    const dayItems = items.filter((i) => i.date === date);
    const tasks = dayItems.filter(countsTowardsCompletion);
    const byCategory: Record<string, number> = {};
    for (const i of dayItems) {
      const mins = durationMinutes(i.startTime, i.endTime) || (i.startTime ? 0 : (i.estimatedMinutes ?? 0));
      if (!mins) continue;
      const key = i.category?.name ?? "Uncategorised";
      byCategory[key] = (byCategory[key] ?? 0) + mins;
    }
    return { date, completed: tasks.filter((t) => t.completed).length, total: tasks.length, minutesByCategory: byCategory };
  });

  const thisWeekTasks = items.filter((i) => i.date! >= weekStart && i.date! <= weekEnd && countsTowardsCompletion(i));
  const overdue = open.filter((t) => (t.deadlineDate && t.deadlineDate < today) || (!t.deadlineDate && t.date && t.date < today && t.kind !== "CLASS"));
  const upcomingDeadlines = open
    .filter((t) => t.deadlineDate && t.deadlineDate >= today && t.deadlineDate <= addDays(today, 14))
    .sort((a, b) => (a.deadlineDate! < b.deadlineDate! ? -1 : 1));

  const categoryColors: Record<string, string> = {};
  for (const i of items) if (i.category) categoryColors[i.category.name] = i.category.color;

  return {
    today,
    weekStart,
    completedThisWeek: thisWeekTasks.filter((t) => t.completed).length,
    remainingThisWeek: thisWeekTasks.filter((t) => !t.completed).length,
    overdue: overdue.map(slim),
    overdueAssignments: overdue.filter((t) => t.kind === "ASSIGNMENT").map(slim),
    upcomingDeadlines: upcomingDeadlines.map(slim),
    days,
    trend,
    categoryColors,
  };
}

const slim = (t: ScheduleItem) => ({
  id: t.id,
  title: t.title,
  kind: t.kind,
  priority: t.priority,
  date: t.date,
  deadlineDate: t.deadlineDate,
  category: t.category?.name ?? null,
  color: t.category?.color ?? null,
});

export type Stats = Awaited<ReturnType<typeof computeStats>>;
