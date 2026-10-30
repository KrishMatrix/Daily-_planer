import { z } from "zod";
import { saveProposal, type ProposalDTO, type StoredAction } from "@/lib/ai/actions";
import { cacheKey, getCachedAnswer, setCachedAnswer } from "@/lib/ai/cache";
import { aiUnavailable, callModel, estimateTokens, getAiConfig, guardCost, modelKey, monthSpendUsd, type ConvItem } from "@/lib/ai/client";
import { compact, describePrefs, loadContext, SAFETY_RULES } from "@/lib/ai/context";
import { quickAnswer } from "@/lib/ai/quick-answers";
import { TOOLS, runTool, WRITE_TOOLS } from "@/lib/ai/tools";
import { addDays } from "@/lib/dates";
import { ApiError, authed, json, parseBody } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { ensureUserSettings } from "@/lib/users";

export const maxDuration = 60;

const bodySchema = z
  .object({
    messages: z
      .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) }).strict())
      .min(1)
      .max(30),
    confirmed: z.boolean().optional(),
  })
  .strict();

// Agent loop limits — the model can never run away with tool calls or spend.
const MAX_ROUNDS = 5;
const MAX_TOOL_CALLS = 10;
const MAX_OUTPUT_TOKENS = 1500; // per round, including hidden reasoning
const HISTORY = 10; // previous messages sent back to the model
const CACHE_MINUTES = 10;

type ChatResponse = { reply: string; proposals: ProposalDTO[]; usage: { costUsd: number; tokens: number }; source: "ai" | "rules" | "cache" };

export const POST = authed(async (req, user) => {
  await rateLimit(`ai:${user.id}`, 60, 3600);
  const body = await parseBody(req, bodySchema);
  const settings = await ensureUserSettings(user.id);
  const ctx = await loadContext(user.id, user.timezone, 8);
  const last = body.messages[body.messages.length - 1];
  if (last.role !== "user") throw new ApiError(400, "The last message must be from the user");

  // 1. Simple look-ups are answered from the database — no tokens spent.
  const quick = quickAnswer(last.content, ctx.upcoming, ctx.today, ctx.nowMinutes);
  if (quick) return json({ reply: quick, proposals: [], usage: { costUsd: 0, tokens: 0 }, source: "rules" } satisfies ChatResponse);

  const unavailable = aiUnavailable(settings);
  if (unavailable) throw new ApiError(503, unavailable, { aiUnavailable: true });

  // 2. Compact snapshot: the next 3 days + open work with near deadlines. The model fetches anything else with tools.
  const snapshot = ctx.upcoming.filter((i) => i.date! <= addDays(ctx.today, 2)).slice(0, 40).map(compact);
  const dueSoon = ctx.open
    .filter((t) => (t.deadlineDate && t.deadlineDate <= addDays(ctx.today, 14)) || (!t.date && (t.priority === "HIGH" || t.priority === "URGENT")))
    .slice(0, 20)
    .map(compact);

  const instructions = `You are the planning assistant inside "AI Life Planner" for a university student who also works at ZeMA.
${SAFETY_RULES}

How to work:
- Answer from the snapshot when it's enough; otherwise call tools (get_calendar_events, get_tasks, find_available_slots, analyze_weekly_workload, get_weather_forecast). Use as few tool calls as possible.
- Before recommending a time, call find_available_slots. Before moving something, call reschedule_task — it reports conflicts deterministically; if it does, explain the conflict and offer its alternative.
- For outdoor activities (runs, walks, sports outside) check get_weather_forecast; it's advice only.
- Keep replies short and concrete: 1–4 sentences or a short bullet list. Use 12-hour times like "3 PM". After queuing changes, tell the user to review the proposal below.
- Item ids look like "abc123" or "abc123@2026-11-02" (one occurrence of a repeating item). Pass them back exactly.`;

  const header = `Now: ${ctx.weekday} ${ctx.today} ${ctx.nowTime} (${ctx.timezone}). Weeks start Monday.
${describePrefs(ctx)}
Categories: ${ctx.categories.join(", ")}.
Schedule today..+2 days (JSON data): ${JSON.stringify(snapshot)}
Open tasks due within 14 days or high priority unscheduled (JSON data): ${JSON.stringify(dueSoon)}`;

  const history = body.messages.slice(-HISTORY).map((m) => ({ role: m.role, content: m.content.slice(0, 1500) }));
  const input: ConvItem[] = [{ role: "user", content: header }, { role: "assistant", content: "Got it." }, ...history];

  // 3. Same question + identical schedule data → reuse the earlier answer (read-only answers only).
  const cfg = getAiConfig(settings);
  const key = body.messages.length === 1 ? cacheKey("chat", modelKey(cfg), { q: last.content.trim().toLowerCase(), header }) : null;
  if (key) {
    const hit = await getCachedAnswer<ChatResponse>(user.id, key);
    if (hit) return json({ ...hit, usage: { costUsd: 0, tokens: 0 }, source: "cache" } satisfies ChatResponse);
  }

  await guardCost({
    userId: user.id,
    settings,
    estimatedInputTokens: estimateTokens(instructions, input, TOOLS),
    expectedOutputTokens: 700,
    rounds: 2,
    confirmed: body.confirmed,
  });

  const toolCtx = { userId: user.id, timezone: user.timezone, today: ctx.today, nowMinutes: ctx.nowMinutes, pending: [] as StoredAction[] };
  const seen = new Map<string, string>(); // identical repeated calls get the earlier result
  const spentBefore = await monthSpendUsd(user.id);
  let cost = 0;
  let tokens = 0;
  let toolCalls = 0;
  let reply = "";
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const allowTools = round < MAX_ROUNDS - 1 && toolCalls < MAX_TOOL_CALLS;
    const res = await callModel({ userId: user.id, settings, feature: "chat", instructions, input, tools: allowTools ? TOOLS : undefined, maxTokens: MAX_OUTPUT_TOKENS });
    cost += res.usage.cost;
    tokens += res.usage.input + res.usage.output;
    if (!res.toolCalls.length || !allowTools) {
      reply = res.text ?? "";
      break;
    }
    input.push(res.replay!);
    for (const call of res.toolCalls) {
      toolCalls++;
      const sig = `${call.name}:${call.arguments}`;
      let output: string;
      if (toolCalls > MAX_TOOL_CALLS) output = JSON.stringify({ error: "Tool call limit reached — answer with what you have." });
      else if (seen.has(sig) && !WRITE_TOOLS.has(call.name)) output = seen.get(sig)!;
      else {
        output = await runTool(call.name, call.arguments, toolCtx);
        seen.set(sig, output);
      }
      input.push({ type: "tool_result", callId: call.id, output });
    }
    // Stop if this request is about to push the user over their monthly limit.
    if (settings.monthlyBudgetUsd > 0 && spentBefore + cost >= settings.monthlyBudgetUsd) {
      reply = "I stopped early because this month's AI budget is used up.";
      break;
    }
  }

  const proposals: ProposalDTO[] = [];
  if (toolCtx.pending.length) {
    const summary = toolCtx.pending.map((a) => `${verb(a.type)} "${a.preview.title}"`).join(" · ");
    proposals.push(await saveProposal(user.id, summary, toolCtx.pending));
  }
  if (!reply) reply = proposals.length ? "I've prepared a proposal — review it below." : "Sorry, I couldn't finish that. Could you rephrase?";
  const response: ChatResponse = { reply, proposals, usage: { costUsd: cost, tokens }, source: "ai" };
  if (key && !proposals.length) await setCachedAnswer(user.id, "chat", key, response, CACHE_MINUTES);
  return json(response);
});

function verb(type: string) {
  return type === "create_task" ? "Add" : type === "delete_task" ? "Delete" : type === "complete_task" ? "Complete" : type === "reschedule_task" ? "Move" : "Update";
}
