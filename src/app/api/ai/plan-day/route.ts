import { z } from "zod";
import { createProposal, type ProposalDTO } from "@/lib/ai/actions";
import { cacheKey, getCachedAnswer, setCachedAnswer } from "@/lib/ai/cache";
import { aiUnavailable, callModel, estimateTokens, getAiConfig, guardCost, modelKey, parseJsonReply, type ConvItem } from "@/lib/ai/client";
import { compact, describePrefs, loadContext, SAFETY_RULES } from "@/lib/ai/context";
import { diffDays, formatDateLong, toMinutes } from "@/lib/dates";
import { ApiError, authed, json, parseBody } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { isFixedKind, planDay, urgencyScore, type FlexibleTask, type PlanBlock } from "@/lib/scheduler";
import { getItemsInRange, toTimed } from "@/lib/tasks";
import { getUserForecast } from "@/lib/weather";
import { goodOutdoorWindows, weatherWarningFor } from "@/lib/weather-advice";
import { weatherLabel } from "@/lib/weather-codes";
import { dateStr } from "@/lib/validation";
import { ensureUserSettings } from "@/lib/users";

export const maxDuration = 60;

const bodySchema = z.object({ date: dateStr.optional(), useAi: z.boolean().default(true), confirmed: z.boolean().optional() }).strict();

type AiPlan = { summary?: string; order?: string[]; postpone?: { id: string; reason: string }[]; highlights?: string[]; tips?: string[] };

export const POST = authed(async (req, user) => {
  await rateLimit(`ai:${user.id}`, 60, 3600);
  const body = await parseBody(req, bodySchema);
  const settings = await ensureUserSettings(user.id);
  const ctx = await loadContext(user.id, user.timezone, 3);
  const realToday = ctx.today;
  const today = body.date ?? realToday; // the day being planned
  if (today < realToday) throw new ApiError(400, "Past days can't be planned.");
  if (diffDays(realToday, today) > 13) throw new ApiError(400, "You can plan up to two weeks ahead.");
  const isToday = today === realToday;

  // 1. Analyse the day's calendar: fixed commitments and already-timed tasks stay put.
  const todayItems = isToday ? ctx.upcoming.filter((i) => i.date === today) : await getItemsInRange(user.id, today, today);
  const fixed = toTimed(todayItems).filter((i) => !i.completed);

  // 2. Identify flexible work worth doing today.
  const flexible: FlexibleTask[] = ctx.open
    .filter((t) => !isFixedKind(t.kind) && t.kind !== "EVENT" && !t.startTime)
    .filter(
      (t) =>
        t.date === today ||
        (isToday && t.date && t.date < today) ||
        (t.deadlineDate && t.deadlineDate <= addDaysLocal(today, 5)) ||
        (!t.date && (t.priority === "HIGH" || t.priority === "URGENT")),
    )
    .map((t) => ({ id: t.id, title: t.title, priority: t.priority, estimatedMinutes: t.estimatedMinutes, deadlineDate: t.deadlineDate, isWork: t.category?.key === "work" }))
    .sort((a, b) => urgencyScore(b, today) - urgencyScore(a, today))
    .slice(0, 15);

  const startFrom = isToday ? Math.ceil((ctx.nowMinutes + 10) / 15) * 15 : toMinutes(ctx.prefs.dayStart);
  let plan = planDay({ date: today, fixed, flexible, prefs: ctx.prefs, startFrom });
  let summary = buildRuleSummary(plan.blocks, plan.postponed.length, fixed.length, isToday ? "Today" : formatDateLong(today));
  let highlights: string[] = deadlineHighlights(ctx.open, today);

  // Weather is supporting information: warn about outdoor plans, never move fixed commitments for it.
  const forecast = await getUserForecast(user);
  const dayWeather = forecast?.daily.find((d) => d.date === today);
  const weatherWarnings = forecast ? todayItems.map((i) => weatherWarningFor(i, forecast)).filter((w) => w !== null) : [];
  const dryWindow = forecast ? goodOutdoorWindows(forecast, today, 1, isToday ? ctx.nowMinutes : 0)[0] : undefined;
  highlights = [...weatherWarnings.map((w) => w.message), ...highlights];
  const weather = dayWeather
    ? {
        summary: `${weatherLabel(dayWeather.code)}, ${dayWeather.tMin}–${dayWeather.tMax}${forecast!.unit === "fahrenheit" ? "°F" : "°C"}${dayWeather.precipProb !== null ? `, ${dayWeather.precipProb}% chance of precipitation` : ""}`,
        code: dayWeather.code,
        dryWindow: dryWindow?.message ?? null,
      }
    : null;
  let tips: string[] = [];
  let postponeReasons: Record<string, string> = Object.fromEntries(plan.postponed.map((p) => [p.id, "Not enough free time today"]));
  let source: "ai" | "rules" = "rules";
  let aiNote: string | undefined;

  // 3. Optionally let the model re-prioritise and explain — but times always come from the scheduler.
  let cached = false;
  if (body.useAi && !aiUnavailable(settings)) {
    const instructions = `You help plan the user's day. You receive the day's fixed commitments, a list of flexible tasks and a draft plan produced by a scheduler.
Return JSON: {"summary": string (2-3 sentences), "order": [task ids in the order they should be done — include only tasks worth doing that day], "postpone": [{"id": task id, "reason": short string}], "highlights": [short strings about deadlines], "tips": [up to 3 short practical tips, e.g. about breaks]}.
Only use ids from the flexible list. Be realistic: don't overload the day. Weather is supporting information: mention outdoor warnings or a dry window in a tip if relevant; never invent weather.
${describePrefs(ctx)}
${SAFETY_RULES}`;
    const facts = {
      plan_date: today,
      weather: weather ? { summary: weather.summary, outdoor_warnings: weatherWarnings.map((w) => w.message), dry_window: weather.dryWindow } : "unavailable",
      fixed: todayItems.filter((i) => i.startTime).map(compact),
      flexible: flexible.map((f) => ({ id: f.id, title: f.title.slice(0, 120), priority: f.priority, est_min: f.estimatedMinutes, deadline: f.deadlineDate })),
    };
    const input: ConvItem[] = [
      {
        role: "user",
        content: JSON.stringify({
          ...facts,
          now: isToday ? ctx.nowTime : null,
          draft: plan.blocks.map((b) => ({ type: b.type, title: b.title.slice(0, 80), start: b.startTime, end: b.endTime })),
          draft_postponed: plan.postponed.map((p) => p.id),
        }),
      },
    ];
    // Unchanged commitments and tasks (within the same hour) reuse the earlier answer at no cost.
    const key = cacheKey("plan-day", modelKey(getAiConfig(settings)), { ...facts, hour: isToday ? Math.floor(ctx.nowMinutes / 60) : null });
    try {
      let ai = await getCachedAnswer<AiPlan>(user.id, key);
      if (ai) cached = true;
      else {
        await guardCost({ userId: user.id, settings, estimatedInputTokens: estimateTokens(instructions, input), expectedOutputTokens: 900, confirmed: body.confirmed });
        const { text } = await callModel({ userId: user.id, settings, feature: "plan-day", instructions, input, json: true, maxTokens: 2500 });
        ai = parseJsonReply<AiPlan>(text);
        if (ai) await setCachedAnswer(user.id, "plan-day", key, ai, 6 * 60);
      }
      if (ai) {
        const ids = new Set(flexible.map((f) => f.id));
        const order = (ai.order ?? []).filter((id) => ids.has(id));
        const postponeIds = new Set((ai.postpone ?? []).map((p) => p.id).filter((id) => ids.has(id) && !order.includes(id)));
        if (order.length) {
          // Re-run the scheduler with the model's ordering so times stay conflict-free.
          // Equal urgency for all → planDay's stable sort keeps the model's order.
          const ordered = order.map((id) => flexible.find((f) => f.id === id)!);
          const replanned = planDay({
            date: today,
            fixed,
            flexible: ordered.map((f) => ({ ...f, priority: "URGENT" as const, deadlineDate: null })),
            prefs: ctx.prefs,
            startFrom,
          });
          const leftover = flexible.filter((f) => !order.includes(f.id));
          plan = {
            blocks: replanned.blocks,
            postponed: [...replanned.postponed.map((p) => flexible.find((f) => f.id === p.id)!), ...leftover],
          };
        }
        postponeReasons = Object.fromEntries(plan.postponed.map((p) => [p.id, ai.postpone?.find((x) => x.id === p.id)?.reason?.slice(0, 200) ?? (postponeIds.has(p.id) ? "Can wait" : "Not enough free time today")]));
        if (ai.summary) summary = String(ai.summary).slice(0, 600);
        if (Array.isArray(ai.highlights) && ai.highlights.length) highlights = ai.highlights.slice(0, 5).map((h) => String(h).slice(0, 200));
        if (Array.isArray(ai.tips)) tips = ai.tips.slice(0, 3).map((t) => String(t).slice(0, 200));
        source = "ai";
      }
    } catch (e) {
      if (e instanceof ApiError && (e.status === 428 || e.status === 402)) throw e;
      aiNote = e instanceof ApiError ? e.message : "AI unavailable — showing the scheduler's plan.";
    }
  }

  // 4. A one-click proposal to put the planned tasks on the calendar.
  let proposal: ProposalDTO | null = null;
  const taskBlocks = plan.blocks.filter((b) => b.type === "task" && b.taskId);
  if (taskBlocks.length) {
    proposal = await createProposal(
      user.id,
      `Schedule ${taskBlocks.length} task${taskBlocks.length > 1 ? "s" : ""} for ${isToday ? "today" : today}`,
      taskBlocks.map((b) => ({ type: "update_task", task_id: b.taskId!, date: today, start_time: b.startTime, end_time: b.endTime })),
    );
  }

  return json({
    date: today,
    summary,
    blocks: plan.blocks,
    postponed: plan.postponed.map((p) => ({ id: p.id, title: p.title, reason: postponeReasons[p.id] ?? "" })),
    highlights,
    tips,
    proposal,
    source,
    cached,
    weather,
    aiNote,
  });
});

function addDaysLocal(d: string, n: number) {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}

function buildRuleSummary(blocks: PlanBlock[], postponed: number, fixedCount: number, label: string) {
  const tasks = blocks.filter((b) => b.type === "task");
  const mins = tasks.reduce((s, b) => s + toMinutes(b.endTime) - toMinutes(b.startTime), 0);
  if (!tasks.length && !fixedCount) return `Nothing urgent is planned for ${label === "Today" ? "today" : label}. A good day to get ahead or rest.`;
  const parts = [`${fixedCount} fixed commitment${fixedCount === 1 ? "" : "s"}`];
  if (tasks.length) parts.push(`${tasks.length} focus block${tasks.length === 1 ? "" : "s"} (${Math.round((mins / 60) * 10) / 10} h)`);
  return `${label}: ${parts.join(" and ")}.${postponed ? ` ${postponed} task${postponed === 1 ? "" : "s"} didn't fit and can move to another day.` : ""}`;
}

function deadlineHighlights(open: { title: string; deadlineDate: string | null; completed: boolean }[], today: string) {
  return open
    .filter((t) => t.deadlineDate && t.deadlineDate <= addDaysLocal(today, 3))
    .sort((a, b) => (a.deadlineDate! < b.deadlineDate! ? -1 : 1))
    .slice(0, 5)
    .map((t) => (t.deadlineDate! < today ? `Overdue: ${t.title} (was due ${t.deadlineDate})` : t.deadlineDate === today ? `Due today: ${t.title}` : `Due ${t.deadlineDate}: ${t.title}`));
}
