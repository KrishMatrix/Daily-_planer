import { z } from "zod";
import { cacheKey, getCachedAnswer, setCachedAnswer } from "@/lib/ai/cache";
import { aiUnavailable, callModel, estimateTokens, getAiConfig, guardCost, modelKey, parseJsonReply, type ConvItem } from "@/lib/ai/client";
import { SAFETY_RULES } from "@/lib/ai/context";
import { addDays, durationMinutes, nowInTz, startOfWeek, WEEKDAYS } from "@/lib/dates";
import { ApiError, authed, json, parseBody } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { detectConflicts } from "@/lib/scheduler";
import { getItemsInRange, getOpenTasks, toTimed } from "@/lib/tasks";
import { ensureUserSettings } from "@/lib/users";
import { dateStr } from "@/lib/validation";

export const maxDuration = 60;

const bodySchema = z.object({ weekStart: dateStr.optional(), useAi: z.boolean().default(true), confirmed: z.boolean().optional() }).strict();

const counts = (i: { kind: string }) => i.kind !== "CLASS" && i.kind !== "MEETING" && i.kind !== "EVENT";

export const POST = authed(async (req, user) => {
  await rateLimit(`ai:${user.id}`, 60, 3600);
  const body = await parseBody(req, bodySchema);
  const settings = await ensureUserSettings(user.id);
  const today = nowInTz(user.timezone).date;
  const weekStart = startOfWeek(body.weekStart ?? today);
  const weekEnd = addDays(weekStart, 6);
  const [items, nextWeek, open] = await Promise.all([
    getItemsInRange(user.id, weekStart, weekEnd),
    getItemsInRange(user.id, addDays(weekEnd, 1), addDays(weekEnd, 7)),
    getOpenTasks(user.id),
  ]);

  // ── Facts (all computed from data) ──
  const tasks = items.filter(counts);
  const completed = tasks.filter((t) => t.completed);
  const incompletePast = tasks.filter((t) => !t.completed && t.date! < today);
  const missedDeadlines = open.filter((t) => t.deadlineDate && t.deadlineDate >= weekStart && t.deadlineDate <= weekEnd && t.deadlineDate < today);
  const perDay = Array.from({ length: 7 }, (_, d) => {
    const date = addDays(weekStart, d);
    const dayItems = items.filter((i) => i.date === date);
    return {
      day: WEEKDAYS[d],
      date,
      scheduled_minutes: dayItems.reduce((s, i) => s + durationMinutes(i.startTime, i.endTime), 0),
      tasks: dayItems.filter(counts).length,
      completed: dayItems.filter((i) => counts(i) && i.completed).length,
    };
  });
  const byCategory: Record<string, { minutes: number; completed: number; total: number }> = {};
  for (const i of items) {
    const k = i.category?.name ?? "Uncategorised";
    byCategory[k] ??= { minutes: 0, completed: 0, total: 0 };
    byCategory[k].minutes += durationMinutes(i.startTime, i.endTime);
    if (counts(i)) {
      byCategory[k].total++;
      if (i.completed) byCategory[k].completed++;
    }
  }
  const upcoming = [...nextWeek.filter((i) => i.kind === "EXAM" || i.kind === "MEETING" || i.deadlineDate), ...open.filter((t) => t.deadlineDate && t.deadlineDate > weekEnd && t.deadlineDate <= addDays(weekEnd, 7))]
    .slice(0, 15)
    .map((i) => ({ title: i.title.slice(0, 100), kind: i.kind, date: i.date, deadline: i.deadlineDate }));
  const conflicts = detectConflicts(toTimed(items)).length;
  const busiest = [...perDay].sort((a, b) => b.scheduled_minutes - a.scheduled_minutes)[0];

  const facts = {
    week: `${weekStart} to ${weekEnd}`,
    tasks_planned: tasks.length,
    tasks_completed: completed.length,
    tasks_incomplete_on_past_days: incompletePast.length,
    missed_deadlines: missedDeadlines.map((t) => ({ title: t.title.slice(0, 100), deadline: t.deadlineDate })),
    per_day: perDay,
    by_category: byCategory,
    scheduling_conflicts: conflicts,
    next_week_commitments: upcoming,
  };

  // ── Rule-based review (always available) ──
  const recs: string[] = [];
  if (missedDeadlines.length) recs.push(`Reschedule or renegotiate ${missedDeadlines.length} missed deadline${missedDeadlines.length > 1 ? "s" : ""} first.`);
  if (incompletePast.length) recs.push(`Move the ${incompletePast.length} unfinished task${incompletePast.length > 1 ? "s" : ""} from earlier days onto specific days next week.`);
  if (busiest && busiest.scheduled_minutes > 9 * 60) recs.push(`${busiest.day} had ${Math.round(busiest.scheduled_minutes / 60)} h scheduled — spread heavy days out.`);
  if (conflicts) recs.push(`Resolve ${conflicts} overlapping item${conflicts > 1 ? "s" : ""} on your calendar.`);
  if (upcoming.length) recs.push(`Prepare early for next week's ${upcoming.length} commitment${upcoming.length > 1 ? "s" : ""} (exams, meetings and deadlines).`);
  if (!recs.length) recs.push("Your week looks balanced. Keep the same rhythm next week.");
  let review = {
    summary: `You completed ${completed.length} of ${tasks.length} planned task${tasks.length === 1 ? "" : "s"} this week${missedDeadlines.length ? ` and missed ${missedDeadlines.length} deadline${missedDeadlines.length > 1 ? "s" : ""}` : ""}.`,
    wins: completed.slice(0, 5).map((t) => `Completed: ${t.title}`),
    concerns: [
      ...missedDeadlines.slice(0, 3).map((t) => `Missed deadline: ${t.title} (${t.deadlineDate})`),
      ...(incompletePast.length ? [`${incompletePast.length} task(s) left unfinished on past days`] : []),
    ],
    recommendations: recs,
  };
  let source: "ai" | "rules" = "rules";
  let aiNote: string | undefined;

  let cached = false;
  if (body.useAi && !aiUnavailable(settings)) {
    const instructions = `You write a short, supportive weekly review for a student who also works. Use ONLY the facts provided — quote numbers exactly as given and never compute scores or percentages that aren't in the data.
Return JSON: {"summary": string (2-3 sentences), "wins": [strings], "concerns": [strings], "recommendations": [3-5 specific, actionable strings]}.
${SAFETY_RULES}`;
    const input: ConvItem[] = [{ role: "user", content: JSON.stringify(facts) }];
    const key = cacheKey("review-week", modelKey(getAiConfig(settings)), facts);
    try {
      let ai = await getCachedAnswer<typeof review>(user.id, key);
      if (ai) cached = true;
      else {
        await guardCost({ userId: user.id, settings, estimatedInputTokens: estimateTokens(instructions, input), expectedOutputTokens: 900, confirmed: body.confirmed });
        const { text } = await callModel({ userId: user.id, settings, feature: "review-week", instructions, input, json: true, maxTokens: 2000 });
        ai = parseJsonReply<typeof review>(text);
        if (ai?.summary) await setCachedAnswer(user.id, "review-week", key, ai, 12 * 60);
      }
      if (ai?.summary) {
        const list = (v: unknown) => (Array.isArray(v) ? v.slice(0, 6).map((x) => String(x).slice(0, 300)) : []);
        review = { summary: String(ai.summary).slice(0, 800), wins: list(ai.wins), concerns: list(ai.concerns), recommendations: list(ai.recommendations) };
        source = "ai";
      }
    } catch (e) {
      if (e instanceof ApiError && (e.status === 428 || e.status === 402)) throw e;
      aiNote = e instanceof ApiError ? e.message : "AI unavailable — showing a rule-based review.";
    }
  }

  return json({ weekStart, weekEnd, facts, review, source, cached, aiNote });
});
