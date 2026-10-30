import "server-only";
import { z } from "zod";
import { addDays, diffDays, fromMinutes, startOfWeek, toMinutes, weekdayOf } from "../dates";
import { detectConflicts, findFreeSlots, isFixedKind, resolveConflict, scheduledMinutes, suggestSlots } from "../scheduler";
import { getItemsInRange, getOpenTasks, getPreferences, parseItemId, toTimed } from "../tasks";
import { dateStr, priorityEnum, timeStr } from "../validation";
import { getUserForecast } from "../weather";
import { compactForecast, goodOutdoorWindows, hoursDuring, outdoorReason, weatherWarningFor } from "../weather-advice";
import { weatherLabel } from "../weather-codes";
import type { ToolDef } from "./client";
import { compact } from "./context";
import { prepareActions, type StoredAction } from "./actions";

// Tools the assistant can call. Every tool runs for the signed-in user only and reads
// through the same data layer as the app. Write tools never touch the database: they
// validate the change and queue it in a proposal the user must accept.

const KINDS = ["TASK", "ASSIGNMENT", "EXAM", "CLASS", "MEETING", "STUDY", "EVENT"];
const nullableDate = { type: ["string", "null"], description: "YYYY-MM-DD" };
const nullableTime = { type: ["string", "null"], description: "HH:mm (24h)" };
const reason = { type: "string", description: "Short reason shown to the user in the preview" };

export const TOOLS: ToolDef[] = [
  {
    name: "get_tasks",
    description: "List the user's open tasks (assignments, exams, work, personal…) by filter. Use for 'what's urgent', 'what's overdue', 'what can I postpone'.",
    parameters: {
      type: "object",
      properties: {
        filter: { type: "string", enum: ["all_open", "overdue", "due_soon", "unscheduled", "high_priority", "assignments", "exams"] },
        days: { type: "integer", description: "For due_soon: look-ahead in days (default 7)" },
        category: { type: "string", description: "Optional category name or key (university, work, gym, personal, meetings, other)" },
      },
      required: ["filter"],
    },
  },
  {
    name: "get_calendar_events",
    description: "Everything scheduled between two dates inclusive (classes, meetings, tasks, gym, appointments), with ids, times and categories. Max 31 days.",
    parameters: {
      type: "object",
      properties: {
        start_date: { type: "string", description: "YYYY-MM-DD" },
        end_date: { type: "string", description: "YYYY-MM-DD" },
        kinds: { type: "array", items: { type: "string", enum: KINDS }, description: 'Optional filter, e.g. ["CLASS"] or ["MEETING"]' },
      },
      required: ["start_date", "end_date"],
    },
  },
  {
    name: "find_available_slots",
    description:
      "Find free time for a block of work. Returns ranked suggestions (respecting deadline, priority, work hours, buffers) plus raw free slots. Always use this before recommending a time.",
    parameters: {
      type: "object",
      properties: {
        duration_minutes: { type: "integer" },
        start_date: { type: "string", description: "YYYY-MM-DD, default today" },
        end_date: { type: "string", description: "YYYY-MM-DD, default deadline or +7 days" },
        deadline_date: { type: "string", description: "YYYY-MM-DD; slots should finish before it" },
        priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "URGENT"] },
        is_work: { type: "boolean", description: "true for ZeMA work (searches work hours)" },
      },
      required: ["duration_minutes"],
    },
  },
  {
    name: "analyze_weekly_workload",
    description:
      "Per-day load for a week: scheduled hours, free hours, open tasks, overlaps, deadlines and overloaded days. Use for 'is my schedule realistic' and 'organize my week'.",
    parameters: { type: "object", properties: { week_start: { type: "string", description: "Any date in the week (YYYY-MM-DD); default this week" } } },
  },
  {
    name: "get_weather_forecast",
    description:
      "Real forecast for the user's saved location (Open-Meteo, up to ~16 days). Includes rain warnings for outdoor activities and dry windows. Returns available=false if no location is set — never guess weather.",
    parameters: {
      type: "object",
      properties: {
        start_date: { type: "string" },
        end_date: { type: "string" },
        hourly_for_date: { type: "string", description: "Optional single date to include hourly detail for" },
      },
      required: ["start_date", "end_date"],
    },
  },
  {
    name: "create_task",
    description: "Propose a new task/study session/event. Queued for the user's approval — nothing is saved until they accept.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        kind: { type: "string", enum: ["TASK", "ASSIGNMENT", "EXAM", "MEETING", "STUDY", "EVENT"] },
        priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "URGENT"] },
        category: { type: "string", description: "University, ZeMA Work, Gym, Personal, Meetings or Other" },
        date: nullableDate,
        start_time: nullableTime,
        end_time: nullableTime,
        deadline_date: nullableDate,
        estimated_minutes: { type: "integer" },
        description: { type: "string" },
        outdoor: { type: "boolean" },
        reason,
      },
      required: ["title"],
    },
  },
  {
    name: "update_task",
    description: "Propose changing a task's title, priority, deadline, estimate or description (not its time — use reschedule_task). Queued for approval.",
    parameters: {
      type: "object",
      properties: {
        task_id: { type: "string" },
        title: { type: "string" },
        priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "URGENT"] },
        deadline_date: nullableDate,
        estimated_minutes: { type: "integer" },
        description: { type: "string" },
        reason,
      },
      required: ["task_id"],
    },
  },
  {
    name: "reschedule_task",
    description:
      "Propose moving an item to a new date/time. Checks for conflicts first: if the new time overlaps something it is NOT queued and you get the conflict plus an alternative — tell the user and propose the alternative. Set allow_conflict only if the user insists.",
    parameters: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "Exact id; for a repeating item use the occurrence id like abc@2026-11-02" },
        date: nullableDate,
        start_time: nullableTime,
        end_time: nullableTime,
        allow_conflict: { type: "boolean" },
        reason,
      },
      required: ["task_id", "date"],
    },
  },
  {
    name: "delete_task",
    description: "Propose deleting one item (for repeating items: only that occurrence). Only when the user explicitly asks. Queued for approval.",
    parameters: { type: "object", properties: { task_id: { type: "string" }, reason }, required: ["task_id"] },
  },
];

export const WRITE_TOOLS = new Set(["create_task", "update_task", "reschedule_task", "delete_task"]);

const MAX_RESULT_CHARS = 10_000;
const out = (v: unknown) => {
  const s = JSON.stringify(v);
  return s.length > MAX_RESULT_CHARS ? s.slice(0, MAX_RESULT_CHARS) + '…"(truncated)"' : s;
};

const stripNulls = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined));

export type ToolContext = { userId: string; timezone: string; today: string; nowMinutes: number; pending: StoredAction[] };

/** Execute a tool call for this user only. Returns a JSON string for the model. */
export async function runTool(name: string, rawArgs: string, ctx: ToolContext): Promise<string> {
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(rawArgs || "{}");
  } catch {
    return out({ error: "Arguments were not valid JSON" });
  }
  try {
    switch (name) {
      case "get_tasks": {
        const a = z
          .object({
            filter: z.enum(["all_open", "overdue", "due_soon", "unscheduled", "high_priority", "assignments", "exams"]),
            days: z.number().int().min(1).max(60).nullish(),
            category: z.string().max(40).nullish(),
          })
          .parse(args);
        const open = await getOpenTasks(ctx.userId);
        const t = ctx.today;
        const until = addDays(t, a.days ?? 7);
        const cat = a.category?.toLowerCase();
        const filtered = open.filter((i) => {
          if (cat && i.category?.name.toLowerCase() !== cat && i.category?.key !== cat) return false;
          switch (a.filter) {
            case "overdue":
              return (i.deadlineDate && i.deadlineDate < t) || (i.date && i.date < t);
            case "due_soon":
              return i.deadlineDate && i.deadlineDate >= t && i.deadlineDate <= until;
            case "unscheduled":
              return !i.date;
            case "high_priority":
              return i.priority === "HIGH" || i.priority === "URGENT";
            case "assignments":
              return i.kind === "ASSIGNMENT";
            case "exams":
              return i.kind === "EXAM";
            default:
              return true;
          }
        });
        return out({ today: t, count: filtered.length, tasks: filtered.slice(0, 40).map(compact) });
      }

      case "get_calendar_events": {
        const a = z.object({ start_date: dateStr, end_date: dateStr, kinds: z.array(z.string()).max(7).nullish() }).parse(args);
        checkRange(a.start_date, a.end_date, 31);
        const items = await getItemsInRange(ctx.userId, a.start_date, a.end_date);
        const kinds = a.kinds?.length ? new Set(a.kinds.map((k) => k.toUpperCase())) : null;
        return out({ items: items.filter((i) => !kinds || kinds.has(i.kind)).slice(0, 120).map(compact) });
      }

      case "find_available_slots": {
        const a = z
          .object({
            duration_minutes: z.number().int().min(10).max(600),
            start_date: dateStr.nullish(),
            end_date: dateStr.nullish(),
            deadline_date: dateStr.nullish(),
            priority: priorityEnum.nullish(),
            is_work: z.boolean().nullish(),
          })
          .parse(args);
        const start = a.start_date && a.start_date > ctx.today ? a.start_date : ctx.today;
        const end = a.end_date ?? (a.deadline_date && a.deadline_date >= start ? a.deadline_date : addDays(start, 7));
        checkRange(start, end, 31);
        const prefs = await getPreferences(ctx.userId);
        const timed = toTimed(await getItemsInRange(ctx.userId, start, end));
        const ranked = suggestSlots({
          request: { durationMinutes: a.duration_minutes, deadlineDate: a.deadline_date ?? null, priority: a.priority ?? "MEDIUM", isWork: a.is_work ?? false },
          items: timed,
          prefs,
          today: start,
          nowMinutes: start === ctx.today ? ctx.nowMinutes : 0,
          limit: 5,
        }).filter((c) => c.date <= end);
        const slots: { date: string; start: string; end: string; minutes: number }[] = [];
        for (let d = start; d <= end && slots.length < 20; d = addDays(d, 1)) {
          const workDay = prefs.workDays.includes(weekdayOf(d));
          let ws = toMinutes(prefs.dayStart);
          let we = toMinutes(prefs.dayEnd);
          const busy = timed.filter((x) => x.date === d && !x.completed).map((x) => ({ start: toMinutes(x.startTime), end: toMinutes(x.endTime) }));
          if (workDay && a.is_work) {
            ws = Math.max(ws, toMinutes(prefs.workStart));
            we = Math.min(we, toMinutes(prefs.workEnd));
          } else if (workDay && a.is_work === false) busy.push({ start: toMinutes(prefs.workStart), end: toMinutes(prefs.workEnd) });
          if (d === ctx.today) ws = Math.max(ws, Math.ceil((ctx.nowMinutes + 15) / 15) * 15);
          for (const s of findFreeSlots({ windowStart: ws, windowEnd: we, busy, buffer: prefs.bufferMinutes, minDuration: a.duration_minutes })) {
            slots.push({ date: d, start: fromMinutes(s.start), end: fromMinutes(s.end), minutes: s.end - s.start });
          }
        }
        return out({
          best: ranked.map(({ date, startTime, endTime, reasons }) => ({ date, start: startTime, end: endTime, reasons })),
          free_slots: slots,
          note: ranked.length || slots.length ? undefined : "No free block of that length in the range.",
        });
      }

      case "analyze_weekly_workload": {
        const a = z.object({ week_start: dateStr.nullish() }).parse(args);
        const ws = startOfWeek(a.week_start ?? ctx.today);
        const we = addDays(ws, 6);
        const [prefs, items, open] = await Promise.all([getPreferences(ctx.userId), getItemsInRange(ctx.userId, ws, we), getOpenTasks(ctx.userId)]);
        const timed = toTimed(items);
        const active = toMinutes(prefs.dayEnd) - toMinutes(prefs.dayStart);
        const days = [];
        for (let d = ws; d <= we; d = addDays(d, 1)) {
          const dayItems = items.filter((i) => i.date === d);
          const sched = scheduledMinutes(timed, d);
          const untimed = dayItems.filter((i) => !i.startTime && !i.completed).reduce((s, i) => s + (i.estimatedMinutes ?? 30), 0);
          const load = sched + untimed;
          days.push({
            date: d,
            scheduled_min: sched,
            untimed_estimate_min: untimed,
            free_min: Math.max(0, active - load),
            classes: dayItems.filter((i) => i.kind === "CLASS").length,
            meetings: dayItems.filter((i) => i.kind === "MEETING").length,
            open_tasks: dayItems.filter((i) => !i.completed && !isFixedKind(i.kind)).length,
            overloaded: load > active * 0.75,
          });
        }
        const conflicts = detectConflicts(timed).map((c) => ({ date: c.date, a: c.a.title.slice(0, 80), a_id: c.a.id, b: c.b.title.slice(0, 80), b_id: c.b.id, overlap_min: c.overlapMinutes }));
        const deadlines = open.filter((t) => t.deadlineDate && t.deadlineDate >= ws && t.deadlineDate <= we).map(compact);
        const unscheduledDue = open.filter((t) => t.deadlineDate && t.deadlineDate <= addDays(we, 7) && !t.date).map(compact);
        return out({ week: `${ws}..${we}`, active_min_per_day: active, days, conflicts, deadlines_this_week: deadlines, unscheduled_with_deadline: unscheduledDue.slice(0, 15) });
      }

      case "get_weather_forecast": {
        const a = z.object({ start_date: dateStr, end_date: dateStr, hourly_for_date: dateStr.nullish() }).parse(args);
        checkRange(a.start_date, a.end_date, 16);
        const f = await getUserForecast({ id: ctx.userId, timezone: ctx.timezone });
        if (!f) return out({ available: false, reason: "No weather location is set, or the weather service is unavailable. Do not guess the weather." });
        const daily = compactForecast(f.daily, a.start_date, a.end_date);
        const items = await getItemsInRange(ctx.userId, a.start_date, a.end_date);
        const warnings = items.map((i) => weatherWarningFor(i, f)).filter(Boolean);
        // Rain chance during each outdoor activity (hourly), so the model doesn't quote the whole-day maximum.
        const outdoor = items
          .filter((i) => outdoorReason(i) && i.date && i.startTime && !i.completed)
          .map((i) => {
            const hours = hoursDuring(f.hourly, i.date!, i.startTime!, i.endTime ?? i.startTime!);
            return {
              title: i.title.slice(0, 80),
              date: i.date,
              start: i.startTime,
              rain_pct_during: hours.length ? Math.max(...hours.map((h) => h.precipProb ?? 0)) : null,
              cond_during: hours.length ? weatherLabel(hours[0].code, hours[0].isDay) : null,
            };
          });
        const from = a.start_date < ctx.today ? ctx.today : a.start_date;
        return out({
          available: true,
          location: f.location.label,
          unit: f.unit === "fahrenheit" ? "°F" : "°C",
          forecast_through: f.daily.at(-1)?.date ?? null,
          daily,
          missing_dates: daily.length ? undefined : "No forecast exists for these dates (beyond the provider's range).",
          note: "rain_pct in daily is the maximum chance at any time that day; use outdoor_activities.rain_pct_during for specific activities.",
          outdoor_activities: outdoor,
          outdoor_warnings: warnings,
          dry_windows: goodOutdoorWindows(f, from, Math.min(7, Math.max(1, diffDays(from, a.end_date) + 1)), ctx.nowMinutes)
            .slice(0, 4)
            .map((w) => w.message),
          hourly: a.hourly_for_date
            ? f.hourly.filter((h) => h.date === a.hourly_for_date && h.time >= "06:00").map((h) => ({ t: h.time, temp: h.temp, cond: weatherLabel(h.code, h.isDay), rain_pct: h.precipProb }))
            : undefined,
        });
      }

      case "create_task":
      case "update_task":
      case "delete_task": {
        const [stored] = await prepareActions(ctx.userId, [{ type: name, ...stripNulls(args) }]);
        if (!stored) return out({ error: "Nothing to change" });
        ctx.pending.push(stored);
        return out({ status: "queued_for_user_approval", preview: stored.preview });
      }

      case "reschedule_task": {
        const a = z
          .object({
            task_id: z.string().min(1).max(80),
            date: dateStr.nullable(),
            start_time: timeStr.nullish(),
            end_time: timeStr.nullish(),
            allow_conflict: z.boolean().nullish(),
            reason: z.string().max(300).nullish(),
          })
          .parse(args);
        const [stored] = await prepareActions(ctx.userId, [
          { type: "reschedule_task", date: a.date, ...stripNulls({ task_id: a.task_id, start_time: a.start_time, end_time: a.end_time, reason: a.reason }) },
        ]);
        if (!stored) return out({ error: "Nothing to change" });
        // Deterministic conflict check before queueing — no AI needed to spot an overlap.
        const after = stored.preview.after;
        if (after?.date && after.startTime && after.endTime && !a.allow_conflict) {
          const prefs = await getPreferences(ctx.userId);
          const { taskId } = parseItemId(a.task_id);
          const dayItems = toTimed(await getItemsInRange(ctx.userId, after.date, after.date)).filter((i) => parseItemId(i.id).taskId !== taskId && !i.completed);
          const moved = { id: a.task_id, title: after.title, date: after.date, startTime: after.startTime, endTime: after.endTime, completed: false };
          const clashes = detectConflicts([...dayItems, moved]).filter((c) => c.a.id === moved.id || c.b.id === moved.id);
          if (clashes.length) {
            const alt = resolveConflict(moved, [...dayItems, moved], prefs);
            return out({
              status: "not_queued_conflict",
              conflicts: clashes.map((c) => {
                const other = c.a.id === moved.id ? c.b : c.a;
                return { title: other.title, kind: other.kind, start: other.startTime, end: other.endTime };
              }),
              alternative_same_day: alt ? { date: after.date, start: alt.startTime, end: alt.endTime } : null,
              hint: "Tell the user about the conflict and propose the alternative (call reschedule_task again with it) unless they insist.",
            });
          }
        }
        ctx.pending.push(stored);
        return out({ status: "queued_for_user_approval", preview: stored.preview });
      }

      default:
        return out({ error: `Unknown tool ${name}` });
    }
  } catch (e) {
    if (e instanceof z.ZodError) return out({ error: "Invalid arguments", issues: e.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`) });
    return out({ error: e instanceof Error ? e.message : "Tool failed" });
  }
}

function checkRange(start: string, end: string, max: number) {
  const d = diffDays(start, end);
  if (d < 0 || d > max) throw new Error(`Date range must be 0–${max} days`);
}
