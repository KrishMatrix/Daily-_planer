import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "./db";
import { addDays, formatTime12, nowInTz, toMinutes } from "./dates";
import { sendPush } from "./push";
import { getItemsInRange, getOpenTasks } from "./tasks";
import { ensureUserSettings } from "./users";

const LOOKBACK_MIN = 30; // tolerate a cron that runs every few minutes or a bit late

type NewNotification = { type: string; title: string; body: string; url?: string; taskId?: string; dedupeKey: string };

/** Insert unless the dedupe key already exists. Returns true if this is new. */
async function notify(userId: string, n: NewNotification): Promise<boolean> {
  try {
    await db.notification.create({ data: { userId, ...n } });
    return true;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return false;
    throw e;
  }
}

/**
 * Generate due reminders for one user: class/meeting/task reminders, deadline
 * reminders, overdue alerts and the daily planning nudge. Idempotent — safe to
 * run as often as you like (dedupe keys prevent repeats).
 */
export async function runRemindersForUser(user: { id: string; timezone: string }, at = new Date()) {
  const settings = await ensureUserSettings(user.id);
  const now = nowInTz(user.timezone, at);
  const created: NewNotification[] = [];
  const add = async (n: NewNotification) => {
    if (await notify(user.id, n)) created.push(n);
  };

  // Timed reminders (today + early tomorrow for reminders that cross midnight).
  const items = await getItemsInRange(user.id, now.date, addDays(now.date, 1));
  for (const i of items) {
    if (!i.date || !i.startTime || i.completed) continue;
    let mins = i.reminderMinutes;
    if (!mins.length) {
      if (i.kind === "CLASS" && settings.classReminders) mins = [settings.defaultReminderMinutes];
      else if (i.kind === "MEETING" && settings.meetingReminders) mins = [settings.defaultReminderMinutes];
    }
    if (i.kind === "CLASS" && !settings.classReminders) continue;
    if (i.kind === "MEETING" && !settings.meetingReminders) continue;
    const startAbs = (i.date === now.date ? 0 : 24 * 60) + toMinutes(i.startTime);
    for (const m of mins) {
      const fireAt = startAbs - m;
      if (fireAt <= now.minutes && fireAt > now.minutes - LOOKBACK_MIN && startAbs >= now.minutes - 5) {
        const label = i.kind === "CLASS" ? "Class" : i.kind === "MEETING" ? "Meeting" : i.kind === "EXAM" ? "Exam" : "Reminder";
        await add({
          type: i.kind === "CLASS" ? "CLASS" : i.kind === "MEETING" ? "MEETING" : "REMINDER",
          title: `${label}: ${i.title}`,
          body: `${startAbs - now.minutes <= 0 ? "Starting now" : `Starts in ${startAbs - now.minutes} min`} · ${formatTime12(i.startTime)}${i.location ? ` · ${i.location}` : ""}`,
          url: "/week",
          taskId: i.taskId,
          dedupeKey: `rem:${i.id}:${i.date}:${m}`,
        });
      }
    }
  }

  const open = await getOpenTasks(user.id);
  const planTimeReached = now.minutes >= toMinutes(settings.dailyPlanTime);

  if (settings.deadlineReminders && planTimeReached) {
    for (const t of open) {
      if (!t.deadlineDate) continue;
      const tomorrow = addDays(now.date, 1);
      if (t.deadlineDate === now.date || t.deadlineDate === tomorrow) {
        const when = t.deadlineDate === now.date ? "today" : "tomorrow";
        await add({
          type: "DEADLINE",
          title: `Due ${when}: ${t.title}`,
          body: t.deadlineTime ? `Deadline at ${formatTime12(t.deadlineTime)}` : "Don't forget to finish this.",
          url: "/",
          taskId: t.taskId,
          dedupeKey: `deadline:${t.id}:${t.deadlineDate}:${when}`,
        });
      }
    }
  }

  if (settings.overdueAlerts && planTimeReached) {
    const overdue = open.filter((t) => t.deadlineDate && t.deadlineDate < now.date);
    for (const t of overdue.slice(0, 10)) {
      await add({
        type: "OVERDUE",
        title: `Overdue: ${t.title}`,
        body: `Was due ${t.deadlineDate}. Reschedule it or mark it done.`,
        url: "/",
        taskId: t.taskId,
        dedupeKey: `overdue:${t.id}:${t.deadlineDate}`,
      });
    }
  }

  if (settings.dailyPlanNotification && planTimeReached && now.minutes < toMinutes(settings.dailyPlanTime) + 6 * 60) {
    const today = items.filter((i) => i.date === now.date && !i.completed);
    const classes = today.filter((i) => i.kind === "CLASS").length;
    const tasks = today.filter((i) => i.kind !== "CLASS").length;
    await add({
      type: "DAILY_PLAN",
      title: "Plan your day",
      body: `${tasks} task${tasks === 1 ? "" : "s"} and ${classes} class${classes === 1 ? "" : "es"} today. Tap "Plan My Day" for a schedule.`,
      url: "/?plan=1",
      dedupeKey: `daily:${now.date}`,
    });
  }

  for (const n of created) await sendPush(user.id, { title: n.title, body: n.body, url: n.url, tag: n.dedupeKey });
  return created.length;
}

export async function runRemindersForAll(at = new Date()) {
  const users = await db.user.findMany({ select: { id: true, timezone: true } });
  let total = 0;
  for (const u of users) {
    try {
      total += await runRemindersForUser(u, at);
    } catch (e) {
      console.error("[reminders] failed for user", u.id, e);
    }
  }
  // Housekeeping: drop old read notifications and stale rate-limit rows.
  await db.notification.deleteMany({ where: { read: true, createdAt: { lt: new Date(Date.now() - 30 * 86_400_000) } } });
  await db.rateLimit.deleteMany({ where: { windowStart: { lt: new Date(Date.now() - 86_400_000) } } });
  await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  await db.aiCache.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return { users: users.length, created: total };
}
