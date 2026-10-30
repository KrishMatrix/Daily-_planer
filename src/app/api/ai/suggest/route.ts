import { z } from "zod";
import { cacheKey, getCachedAnswer, setCachedAnswer } from "@/lib/ai/cache";
import { aiUnavailable, callModel, getAiConfig, guardCost, modelKey, parseJsonReply } from "@/lib/ai/client";
import { SAFETY_RULES } from "@/lib/ai/context";
import { db } from "@/lib/db";
import { addDays, formatDateLong, formatTime12, nowInTz } from "@/lib/dates";
import { ApiError, authed, json, parseBody } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { suggestSlots } from "@/lib/scheduler";
import { getItemsInRange, getPreferences, toTimed } from "@/lib/tasks";
import { ensureUserSettings } from "@/lib/users";
import { dateStr, priorityEnum } from "@/lib/validation";

const bodySchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    durationMinutes: z.number().int().min(10).max(600),
    deadlineDate: dateStr.nullable().optional(),
    priority: priorityEnum.default("MEDIUM"),
    categoryId: z.string().max(40).nullable().optional(),
    excludeItemId: z.string().max(80).optional(),
    useAi: z.boolean().default(true),
    confirmed: z.boolean().optional(),
  })
  .strict();

/**
 * Recommend the best time for a task. Candidates always come from the
 * deterministic scheduler; the model (if available) only picks one and explains why.
 */
export const POST = authed(async (req, user) => {
  await rateLimit(`suggest:${user.id}`, 120, 3600);
  const body = await parseBody(req, bodySchema);
  const now = nowInTz(user.timezone);
  const [prefs, settings, category] = await Promise.all([
    getPreferences(user.id),
    ensureUserSettings(user.id),
    body.categoryId ? db.category.findFirst({ where: { id: body.categoryId, userId: user.id } }) : null,
  ]);
  const horizonEnd = body.deadlineDate && body.deadlineDate > now.date ? body.deadlineDate : addDays(now.date, 13);
  const items = toTimed(await getItemsInRange(user.id, now.date, horizonEnd)).filter((i) => i.id !== body.excludeItemId);
  const candidates = suggestSlots({
    request: { durationMinutes: body.durationMinutes, deadlineDate: body.deadlineDate, priority: body.priority, isWork: category?.key === "work" },
    items,
    prefs,
    today: now.date,
    nowMinutes: now.minutes,
    limit: 6,
  });
  if (!candidates.length) {
    return json({
      suggestion: null,
      alternatives: [],
      source: "rules",
      message: body.deadlineDate
        ? "I couldn't find a free block of that length before the deadline. Consider splitting the task or freeing up time."
        : "I couldn't find a free block of that length in the next two weeks.",
    });
  }

  const describe = (c: (typeof candidates)[number]) => `${formatDateLong(c.date)}, ${formatTime12(c.startTime)}–${formatTime12(c.endTime)}`;
  const ruleMessage = (c: (typeof candidates)[number]) =>
    `You have free time on ${describe(c)}. I recommend scheduling "${body.title}" then${c.reasons.length ? ` — ${c.reasons.slice(0, 2).join(", ")}` : ""}.`;

  let chosen = candidates[0];
  let message = ruleMessage(chosen);
  let source: "ai" | "rules" = "rules";
  let aiNote: string | undefined;

  if (body.useAi && !aiUnavailable(settings)) {
    try {
      const instructions = `You pick the best time slot for a task from a fixed list of candidates and explain the choice in one or two friendly sentences addressed to the user. Respond as JSON: {"index": number, "message": string}.\n${SAFETY_RULES}`;
      const payload = {
        today: now.date,
        task: { title: body.title, minutes: body.durationMinutes, deadline: body.deadlineDate ?? null, priority: body.priority, category: category?.name ?? null },
        candidates: candidates.map((c, i) => ({ index: i, when: describe(c), notes: c.reasons })),
      };
      const key = cacheKey("suggest", modelKey(getAiConfig(settings)), payload);
      let parsed = await getCachedAnswer<{ index?: number; message?: string }>(user.id, key);
      if (!parsed) {
        await guardCost({ userId: user.id, settings, estimatedInputTokens: 600, expectedOutputTokens: 400, confirmed: true });
        const { text } = await callModel({ userId: user.id, settings, feature: "suggest", instructions, input: [{ role: "user", content: JSON.stringify(payload) }], json: true, maxTokens: 1000 });
        parsed = parseJsonReply<{ index?: number; message?: string }>(text);
        if (parsed) await setCachedAnswer(user.id, "suggest", key, parsed, 60);
      }
      if (parsed && Number.isInteger(parsed.index) && candidates[parsed.index!]) {
        chosen = candidates[parsed.index!];
        message = typeof parsed.message === "string" && parsed.message.trim() ? parsed.message.trim().slice(0, 400) : ruleMessage(chosen);
        source = "ai";
      }
    } catch (e) {
      // Fall back to the rule-based suggestion; tell the user why AI wasn't used.
      aiNote = e instanceof ApiError ? e.message : "AI unavailable — showing the scheduler's best slot.";
    }
  }

  return json({
    suggestion: { date: chosen.date, startTime: chosen.startTime, endTime: chosen.endTime },
    alternatives: candidates.filter((c) => c !== chosen).slice(0, 3).map((c) => ({ date: c.date, startTime: c.startTime, endTime: c.endTime, label: describe(c) })),
    message,
    source,
    aiNote,
  });
});
