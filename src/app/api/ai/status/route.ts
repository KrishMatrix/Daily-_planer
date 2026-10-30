import { callModel, getAiConfig, monthSpendUsd } from "@/lib/ai/client";
import { ApiError, authed, json } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { ensureUserSettings } from "@/lib/users";

/** Connection status. Never returns the key — only whether one is set. */
export const GET = authed(async (_req, user) => {
  const settings = await ensureUserSettings(user.id);
  const cfg = getAiConfig(settings);
  return json({
    enabled: settings.aiEnabled,
    configured: cfg.configured,
    provider: cfg.provider,
    model: cfg.model,
    api: cfg.api,
    reasoningEffort: cfg.reasoningEffort,
    serverModel: cfg.provider === "openai" ? process.env.OPENAI_MODEL || process.env.AI_MODEL || "gpt-5-mini" : process.env.AI_MODEL || null,
    serverProvider: process.env.AI_PROVIDER || "openai",
    baseUrlHost: cfg.baseUrl ? safeHost(cfg.baseUrl) : null,
    keyVar: cfg.keyVar,
    openaiKeySet: Boolean(process.env.OPENAI_API_KEY),
    compatibleConfigured: Boolean(process.env.AI_BASE_URL),
    monthSpendUsd: await monthSpendUsd(user.id),
    monthlyBudgetUsd: settings.monthlyBudgetUsd,
  });
});

/** Send a tiny test request to verify the key and model (costs a few tokens). */
export const POST = authed(async (_req, user) => {
  await rateLimit(`ai-test:${user.id}`, 10, 3600);
  const settings = await ensureUserSettings(user.id);
  const started = Date.now();
  try {
    const { usage } = await callModel({
      userId: user.id,
      settings,
      feature: "connection-test",
      instructions: "You are a connection test.",
      input: [{ role: "user", content: 'Reply with the single word "ok".' }],
      maxTokens: 300,
    });
    return json({ ok: true, latencyMs: Date.now() - started, costUsd: usage.cost });
  } catch (e) {
    return json({ ok: false, error: e instanceof ApiError ? e.message : "Connection failed" });
  }
});

function safeHost(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}
