import "server-only";
import type { UserSettings } from "@prisma/client";
import { db } from "../db";
import { ApiError } from "../http";
import { supportsReasoning } from "./models";

// Server-only AI client. OpenAI is called through the Responses API; other
// OpenAI-compatible providers (Ollama, OpenRouter, Groq…) through Chat Completions.
// API keys are read from environment variables at call time and never leave the server.

export type ToolDef = { name: string; description: string; parameters: Record<string, unknown> };
export type ToolCall = { id: string; name: string; arguments: string };

/** Provider-neutral conversation items. */
export type ConvItem =
  | { role: "user" | "assistant"; content: string }
  /** The model's tool-call turn. `raw` holds provider-native items replayed verbatim (incl. encrypted reasoning). */
  | { type: "tool_calls"; calls: ToolCall[]; raw: unknown[] }
  | { type: "tool_result"; callId: string; output: string };

export type Provider = "openai" | "compatible";
export type AiConfig = { configured: boolean; provider: Provider; baseUrl: string; model: string; keyVar: string; api: "responses" | "chat"; reasoningEffort: string | null };

/**
 * Resolve provider and model. Server configuration (AI_PROVIDER, OPENAI_MODEL / AI_MODEL)
 * is the default; a user may override either in AI Settings.
 */
export function getAiConfig(settings: Pick<UserSettings, "aiProvider" | "aiModel">): AiConfig {
  const provider: Provider = (settings.aiProvider || process.env.AI_PROVIDER || "openai") === "compatible" ? "compatible" : "openai";
  if (provider === "compatible") {
    const baseUrl = (process.env.AI_BASE_URL || "").replace(/\/+$/, "");
    const model = settings.aiModel || process.env.AI_MODEL || "llama3.1";
    return { configured: Boolean(baseUrl), provider, baseUrl, model, keyVar: "AI_API_KEY", api: "chat", reasoningEffort: null };
  }
  const model = settings.aiModel || process.env.OPENAI_MODEL || process.env.AI_MODEL || "gpt-5-mini";
  const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
  // Low effort keeps hidden reasoning tokens (billed as output) small. "off" omits the parameter.
  const effort = process.env.OPENAI_REASONING_EFFORT || "low";
  return {
    configured: Boolean(process.env.OPENAI_API_KEY),
    provider,
    baseUrl,
    model,
    keyVar: "OPENAI_API_KEY",
    api: "responses",
    reasoningEffort: supportsReasoning(model) && effort !== "off" ? effort : null,
  };
}

/** Identifies provider + model for cache keys, so answers never leak across providers or models. */
export const modelKey = (cfg: AiConfig) => `${cfg.baseUrl}|${cfg.model}`;

const apiKey = (cfg: AiConfig) => (cfg.provider === "compatible" ? process.env.AI_API_KEY : process.env.OPENAI_API_KEY) || "";

/** Rough token estimate (~4 characters per token for English/JSON). */
export function estimateTokens(instructions: string, input: ConvItem[], tools?: ToolDef[]): number {
  const chars =
    instructions.length +
    input.reduce((n, m) => n + ("content" in m ? m.content.length : "output" in m ? m.output.length : JSON.stringify(m.calls).length), 0) +
    (tools ? JSON.stringify(tools).length : 0);
  return Math.ceil(chars / 4) + input.length * 4;
}

type Prices = Pick<UserSettings, "inputPricePerMTok" | "outputPricePerMTok" | "cachedInputPricePerMTok">;

/** Cost estimate. `input` includes `cached` tokens, which are billed at the cached-input rate. */
export function costUsd(s: Prices, input: number, output: number, cached = 0) {
  const fresh = Math.max(0, input - cached);
  return (fresh * s.inputPricePerMTok + cached * s.cachedInputPricePerMTok + output * s.outputPricePerMTok) / 1_000_000;
}

export async function monthSpendUsd(userId: string): Promise<number> {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const agg = await db.aiUsage.aggregate({ where: { userId, createdAt: { gte: start } }, _sum: { costUsd: true } });
  return agg._sum.costUsd ?? 0;
}

/**
 * Check the monthly budget and, for expensive requests, require explicit confirmation.
 * Throws 428 with an estimate the UI shows in a confirm dialog, or 402 when over budget.
 */
export async function guardCost(opts: {
  userId: string;
  settings: UserSettings;
  estimatedInputTokens: number;
  expectedOutputTokens: number;
  rounds?: number;
  confirmed?: boolean;
}) {
  const estimate = costUsd(opts.settings, opts.estimatedInputTokens * (opts.rounds ?? 1), opts.expectedOutputTokens * (opts.rounds ?? 1));
  const spent = await monthSpendUsd(opts.userId);
  if (opts.settings.monthlyBudgetUsd > 0 && spent + estimate > opts.settings.monthlyBudgetUsd) {
    throw new ApiError(402, `Monthly AI budget reached ($${spent.toFixed(2)} of $${opts.settings.monthlyBudgetUsd.toFixed(2)}). Raise the limit in AI Settings to continue.`, {
      budgetExceeded: true,
    });
  }
  if (!opts.confirmed && estimate > opts.settings.confirmAboveUsd) {
    throw new ApiError(428, "This request may cost more than your confirmation threshold.", {
      needsConfirmation: true,
      estimateUsd: Number(estimate.toFixed(4)),
      estimatedTokens: Math.round((opts.estimatedInputTokens + opts.expectedOutputTokens) * (opts.rounds ?? 1)),
    });
  }
  return estimate;
}

export type ModelResult = {
  text: string | null;
  toolCalls: ToolCall[];
  /** Item to append to the conversation before sending tool results back. */
  replay: ConvItem | null;
  /** True when the reply was cut off by the output-token limit. */
  truncated: boolean;
  usage: { input: number; cached: number; output: number; cost: number };
};

/** Why AI can't be used right now, or null when it can. */
export function aiUnavailable(settings: UserSettings): string | null {
  const cfg = getAiConfig(settings);
  if (!settings.aiEnabled) return "AI features are turned off in AI Settings.";
  if (!cfg.configured) return `AI isn't configured on the server. Set ${cfg.keyVar}${cfg.provider === "compatible" ? " and AI_BASE_URL" : ""} in the environment.`;
  return null;
}

export async function callModel(opts: {
  userId: string;
  settings: UserSettings;
  feature: string;
  instructions: string;
  input: ConvItem[];
  tools?: ToolDef[];
  json?: boolean;
  /** Hard cap on output tokens (reasoning tokens count towards it). */
  maxTokens?: number;
}): Promise<ModelResult> {
  const cfg = getAiConfig(opts.settings);
  const unavailable = aiUnavailable(opts.settings);
  if (unavailable) throw new ApiError(503, unavailable, { aiUnavailable: true });

  const { url, body } = cfg.api === "responses" ? responsesRequest(cfg, opts) : chatRequest(cfg, opts);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey(cfg)}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e) {
    const timeout = e instanceof Error && e.name === "TimeoutError";
    throw new ApiError(504, timeout ? "The AI took too long to respond. Please try again." : "Couldn't reach the AI provider. Check your connection.", {
      aiUnavailable: true,
    });
  }
  if (!res.ok) throw await providerError(res, cfg);

  const data = (await res.json()) as Record<string, unknown>;
  const parsed = cfg.api === "responses" ? parseResponses(data) : parseChat(data);
  const input = parsed.input ?? estimateTokens(opts.instructions, opts.input, opts.tools);
  const output = parsed.output ?? Math.ceil((parsed.text?.length ?? 0) / 4);
  const cached = parsed.cached ?? 0;
  const cost = costUsd(opts.settings, input, output, cached);
  await db.aiUsage.create({
    data: { userId: opts.userId, feature: opts.feature, model: cfg.model, promptTokens: input, cachedTokens: cached, completionTokens: output, costUsd: cost },
  });
  if (!parsed.text && !parsed.toolCalls.length) {
    throw new ApiError(502, parsed.truncated ? "The AI ran out of output tokens before answering. Try a shorter question." : "The AI returned an empty response. Please try again.");
  }
  return {
    text: parsed.text,
    toolCalls: parsed.toolCalls,
    replay: parsed.toolCalls.length ? { type: "tool_calls", calls: parsed.toolCalls, raw: parsed.raw } : null,
    truncated: parsed.truncated,
    usage: { input, cached, output, cost },
  };
}

// ── OpenAI Responses API ────────────────────────────────────────────────

type CallOpts = Parameters<typeof callModel>[0];

function responsesRequest(cfg: AiConfig, opts: CallOpts) {
  const input: unknown[] = [];
  for (const item of opts.input) {
    if ("role" in item) input.push({ role: item.role, content: item.content });
    else if (item.type === "tool_calls") input.push(...item.raw);
    else input.push({ type: "function_call_output", call_id: item.callId, output: item.output });
  }
  const body: Record<string, unknown> = {
    model: cfg.model,
    instructions: opts.instructions,
    input,
    max_output_tokens: opts.maxTokens ?? 2000,
    // Don't keep conversations on OpenAI's side; reasoning is carried between tool rounds encrypted instead.
    store: false,
    // Same prefix per feature → OpenAI's automatic prompt caching bills repeated input at the cached rate.
    prompt_cache_key: `planner-${opts.feature}`,
  };
  if (cfg.reasoningEffort) {
    body.reasoning = { effort: cfg.reasoningEffort };
    body.include = ["reasoning.encrypted_content"];
  }
  if (opts.tools?.length) {
    body.tools = opts.tools.map((t) => ({ type: "function", name: t.name, description: t.description, parameters: t.parameters, strict: false }));
    body.tool_choice = "auto";
  }
  if (opts.json) {
    body.text = { format: { type: "json_object" } };
    // JSON mode requires the word "json" in the input messages themselves (instructions don't count).
    if (!opts.input.some((i) => "content" in i && /json/i.test(i.content))) input.push({ role: "user", content: "Respond with a JSON object." });
  }
  return { url: `${cfg.baseUrl}/responses`, body };
}

type Parsed = { text: string | null; toolCalls: ToolCall[]; raw: unknown[]; truncated: boolean; input?: number; output?: number; cached?: number };

export function parseResponses(data: Record<string, unknown>): Parsed {
  const output = (data.output as { type: string; [k: string]: unknown }[] | undefined) ?? [];
  let text = "";
  const toolCalls: ToolCall[] = [];
  const raw: unknown[] = [];
  for (const item of output) {
    if (item.type === "message") {
      for (const c of (item.content as { type: string; text?: string }[] | undefined) ?? []) if (c.type === "output_text" && c.text) text += c.text;
    } else if (item.type === "function_call") {
      toolCalls.push({ id: String(item.call_id), name: String(item.name), arguments: String(item.arguments ?? "{}") });
      raw.push(item);
    } else if (item.type === "reasoning") {
      raw.push(item);
    }
  }
  const usage = data.usage as { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } } | undefined;
  const truncated = data.status === "incomplete" && (data.incomplete_details as { reason?: string } | undefined)?.reason === "max_output_tokens";
  return {
    text: text || null,
    toolCalls,
    raw: toolCalls.length ? raw : [],
    truncated,
    input: usage?.input_tokens,
    output: usage?.output_tokens,
    cached: usage?.input_tokens_details?.cached_tokens,
  };
}

// ── Chat Completions (OpenAI-compatible providers) ─────────────────────

function chatRequest(cfg: AiConfig, opts: CallOpts) {
  const messages: unknown[] = [{ role: "system", content: opts.instructions }];
  for (const item of opts.input) {
    if ("role" in item) messages.push({ role: item.role, content: item.content });
    else if (item.type === "tool_calls")
      messages.push({ role: "assistant", content: null, tool_calls: item.calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments } })) });
    else messages.push({ role: "tool", tool_call_id: item.callId, content: item.output });
  }
  const body: Record<string, unknown> = { model: cfg.model, messages, max_tokens: opts.maxTokens ?? 2000 };
  if (opts.tools?.length) {
    body.tools = opts.tools.map((t) => ({ type: "function", function: t }));
    body.tool_choice = "auto";
  }
  if (opts.json) body.response_format = { type: "json_object" };
  return { url: `${cfg.baseUrl}/chat/completions`, body };
}

function parseChat(data: Record<string, unknown>): Parsed {
  const choice = (
    data.choices as { message?: { content?: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] }; finish_reason?: string }[] | undefined
  )?.[0];
  const toolCalls = (choice?.message?.tool_calls ?? []).map((c) => ({ id: c.id, name: c.function.name, arguments: c.function.arguments }));
  const usage = data.usage as { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } } | undefined;
  return {
    text: choice?.message?.content || null,
    toolCalls,
    raw: [],
    truncated: choice?.finish_reason === "length",
    input: usage?.prompt_tokens,
    output: usage?.completion_tokens,
    cached: usage?.prompt_tokens_details?.cached_tokens,
  };
}

async function providerError(res: Response, cfg: AiConfig) {
  let code = "";
  let message = "";
  try {
    const err = (await res.json()) as { error?: { message?: string; code?: string; type?: string } };
    code = err.error?.code ?? err.error?.type ?? "";
    message = err.error?.message ?? "";
    console.error("[ai] provider error", res.status, code, message.slice(0, 300));
  } catch {}
  const msg =
    res.status === 401
      ? `The AI provider rejected the API key. Check ${cfg.keyVar}.`
      : res.status === 403
        ? `Your API key isn't allowed to use "${cfg.model}". Check the key's permissions and the project's model access on platform.openai.com.`
        : res.status === 404 || code === "model_not_found"
        ? `Model "${cfg.model}" wasn't found. Pick a different model in AI Settings.`
        : res.status === 429
          ? code === "insufficient_quota"
            ? "Your AI provider account is out of credit."
            : "The AI provider is rate-limiting requests. Try again in a minute."
          : res.status === 400
            ? `The AI provider rejected the request${
                /reasoning|effort/i.test(message)
                  ? " (this model doesn't accept the reasoning setting — set OPENAI_REASONING_EFFORT=off or pick another model)"
                  : /tool|function/i.test(message)
                    ? " (the model may not support tool calling)"
                    : ""
              }.`
            : "The AI provider is having trouble right now. Please try again.";
  return new ApiError(502, msg, { aiUnavailable: true });
}

/** Parse a JSON object from a model reply, tolerating code fences. */
export function parseJsonReply<T = unknown>(content: string | null): T | null {
  if (!content) return null;
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]) as T;
    } catch {
      return null;
    }
  }
}
