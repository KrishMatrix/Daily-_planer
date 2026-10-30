"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Bot, CheckCircle2, CircleAlert, CircleDashed, Loader2, PlugZap, ShieldCheck, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/hooks/use-planner";
import type { SettingsDTO } from "@/lib/types";
import { api, cn, formatUsd } from "@/lib/utils";
import { findModelPrice, OPENAI_MODELS } from "@/lib/ai/models";
import { useSaveSettings } from "./settings-view";

type Status = {
  enabled: boolean;
  configured: boolean;
  provider: "openai" | "compatible";
  model: string;
  api: "responses" | "chat";
  reasoningEffort: string | null;
  serverModel: string | null;
  serverProvider: string;
  baseUrlHost: string | null;
  keyVar: string;
  openaiKeySet: boolean;
  compatibleConfigured: boolean;
  monthSpendUsd: number;
  monthlyBudgetUsd: number;
};

type Usage = {
  month: { requests: number; costUsd: number; promptTokens: number; cachedTokens: number; completionTokens: number };
  byFeature: { feature: string; requests: number; costUsd: number; tokens: number }[];
  recent: { id: string; feature: string; model: string; tokens: number; costUsd: number; createdAt: string }[];
};


export function AiSettingsView() {
  const qc = useQueryClient();
  const { data: settings } = useSettings();
  const save = useSaveSettings();
  const { data: status, refetch: refetchStatus } = useQuery({ queryKey: ["ai-status"], queryFn: () => api<Status>("/api/ai/status") });
  const { data: usage } = useQuery({ queryKey: ["ai-usage"], queryFn: () => api<Usage>("/api/ai/usage") });
  const [f, setF] = useState<SettingsDTO | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string; latencyMs?: number } | null>(null);

  useEffect(() => {
    if (settings && !f) setF(settings);
  }, [settings, f]);

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await api<{ ok: boolean; error?: string; latencyMs?: number }>("/api/ai/status", { method: "POST" });
      setTestResult(r);
      qc.invalidateQueries({ queryKey: ["ai-usage"] });
    } catch (e) {
      setTestResult({ ok: false, error: (e as Error).message });
    } finally {
      setTesting(false);
    }
  };

  const persist = async () => {
    if (!f) return;
    await save.mutateAsync({
      aiEnabled: f.aiEnabled,
      aiProvider: f.aiProvider,
      aiModel: f.aiModel.trim(),
      inputPricePerMTok: f.inputPricePerMTok,
      cachedInputPricePerMTok: f.cachedInputPricePerMTok,
      outputPricePerMTok: f.outputPricePerMTok,
      monthlyBudgetUsd: f.monthlyBudgetUsd,
      confirmAboveUsd: f.confirmAboveUsd,
    }).catch(() => {});
    refetchStatus();
    setTestResult(null);
  };

  const spent = usage?.month.costUsd ?? status?.monthSpendUsd ?? 0;
  // Effective model after the server default is applied, and its published price (if we know it).
  const effectiveModel = f ? f.aiModel.trim() || (status?.serverModel ?? "") : "";
  const published = findModelPrice(effectiveModel);
  const priceMismatch =
    f && published && (f.inputPricePerMTok !== published.input || f.outputPricePerMTok !== published.output || f.cachedInputPricePerMTok !== published.cachedInput);
  const isCustomModel = Boolean(f && f.aiModel && !findModelPrice(f.aiModel));
  const budget = f?.monthlyBudgetUsd ?? status?.monthlyBudgetUsd ?? 0;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl bg-violet-500/10 text-violet-500">
          <Bot className="size-5" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">AI Settings</h1>
          <p className="text-sm text-muted-foreground">Provider, model, spending limits and usage</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><PlugZap className="size-4" /> Connection</CardTitle>
          {status && (
            <span className={cn("flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium", !status.enabled ? "bg-muted text-muted-foreground" : status.configured ? "bg-success/15 text-emerald-700 dark:text-success" : "bg-warning/15 text-amber-700 dark:text-warning")}>
              {!status.enabled ? <CircleDashed className="size-3.5" /> : status.configured ? <CheckCircle2 className="size-3.5" /> : <CircleAlert className="size-3.5" />}
              {!status.enabled ? "Turned off" : status.configured ? "Key configured" : "Not configured"}
            </span>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          {status && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-muted-foreground">Provider</dt>
              <dd>{status.provider === "openai" ? "OpenAI" : "OpenAI-compatible"}{status.baseUrlHost ? ` · ${status.baseUrlHost}` : ""}</dd>
              <dt className="text-muted-foreground">Model</dt>
              <dd>
                <span className="font-mono text-xs">{status.model}</span>
                <span className="text-xs text-muted-foreground">
                  {" "}
                  · {status.api === "responses" ? "Responses API" : "Chat Completions"}
                  {status.reasoningEffort ? ` · reasoning effort ${status.reasoningEffort}` : ""}
                </span>
              </dd>
              <dt className="text-muted-foreground">API key</dt>
              <dd>{status.configured ? <>Set via <code className="text-xs">{status.keyVar}</code> on the server</> : <>Missing — set <code className="text-xs">{status.keyVar}</code>{status.provider === "compatible" ? <> and <code className="text-xs">AI_BASE_URL</code></> : null} in your environment and redeploy</>}</dd>
            </dl>
          )}
          <div className="flex items-start gap-2 rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" />
            The API key is only read from server environment variables. It is never stored in the database, sent to the browser, or kept in browser storage — every AI call is made by the server.
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" size="sm" onClick={test} disabled={testing || !status?.configured || !status.enabled}>
              {testing ? <Loader2 className="animate-spin" /> : <Activity />} Test connection
            </Button>
            <span className="text-xs text-muted-foreground">Sends one tiny request (costs a few tokens).</span>
          </div>
          {testResult && (
            <div className={cn("rounded-lg px-3 py-2 text-sm", testResult.ok ? "bg-success/10 text-emerald-700 dark:text-success" : "bg-destructive/10 text-destructive")}>
              {testResult.ok ? `Connected · responded in ${(testResult.latencyMs! / 1000).toFixed(1)}s` : testResult.error}
            </div>
          )}
        </CardContent>
      </Card>

      {f && (
        <Card>
          <CardHeader>
            <CardTitle>Model & provider</CardTitle>
            <div className="flex items-center gap-2 text-sm">
              <Label htmlFor="ai-on">AI features</Label>
              <Switch id="ai-on" checked={f.aiEnabled} onCheckedChange={(v) => setF({ ...f, aiEnabled: v })} />
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label>Provider</Label>
                <NativeSelect value={f.aiProvider} onChange={(e) => setF({ ...f, aiProvider: e.target.value as SettingsDTO["aiProvider"] })}>
                  <option value="">Server default ({status?.serverProvider === "compatible" ? "OpenAI-compatible" : "OpenAI"})</option>
                  <option value="openai">OpenAI {status?.openaiKeySet ? "(key set)" : "(no key)"}</option>
                  <option value="compatible">OpenAI-compatible {status?.compatibleConfigured ? "(configured)" : "(not configured)"}</option>
                </NativeSelect>
                <span className="text-[11px] text-muted-foreground">Compatible providers (OpenRouter, Groq, Ollama, LM Studio…) use AI_BASE_URL + AI_API_KEY. The model must support tool calling.</span>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Model</Label>
                <NativeSelect
                  value={isCustomModel ? "__custom" : f.aiModel}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "__custom") return setF({ ...f, aiModel: f.aiModel || "my-model" });
                    const p = findModelPrice(v || (status?.serverModel ?? ""));
                    setF({ ...f, aiModel: v, ...(p ? { inputPricePerMTok: p.input, cachedInputPricePerMTok: p.cachedInput, outputPricePerMTok: p.output } : {}) });
                  }}
                >
                  <option value="">Server default ({status?.serverModel ?? "OPENAI_MODEL"})</option>
                  {OPENAI_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label} — ${m.input} in / ${m.output} out{m.note ? ` · ${m.note}` : ""}
                    </option>
                  ))}
                  <option value="__custom">Other model ID…</option>
                </NativeSelect>
                {isCustomModel && <Input value={f.aiModel} onChange={(e) => setF({ ...f, aiModel: e.target.value })} className="font-mono text-sm" maxLength={80} aria-label="Model ID" />}
                <span className="text-[11px] text-muted-foreground">The server default comes from OPENAI_MODEL. GPT-6 Luna is the cheapest model that handled the planner&apos;s tools well in testing. Use “Test connection” after changing.</span>
              </div>
            </div>
            <div>
              <div className="mb-2 flex items-center gap-2 text-sm font-medium"><Wallet className="size-4" /> Pricing & limits</div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Num label="Input $ / 1M tokens" value={f.inputPricePerMTok} onChange={(v) => setF({ ...f, inputPricePerMTok: v })} step={0.01} />
                <Num label="Cached input $ / 1M" value={f.cachedInputPricePerMTok} onChange={(v) => setF({ ...f, cachedInputPricePerMTok: v })} step={0.005} />
                <Num label="Output $ / 1M tokens" value={f.outputPricePerMTok} onChange={(v) => setF({ ...f, outputPricePerMTok: v })} step={0.01} />
                <Num label="Monthly limit ($)" value={f.monthlyBudgetUsd} onChange={(v) => setF({ ...f, monthlyBudgetUsd: v })} step={1} hint="0 = no limit" />
                <Num label="Confirm above ($)" value={f.confirmAboveUsd} onChange={(v) => setF({ ...f, confirmAboveUsd: v })} step={0.01} hint="per request" />
              </div>
              {priceMismatch && published && (
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-warning/10 px-3 py-2 text-xs">
                  <CircleAlert className="size-4 text-amber-600" />
                  <span className="flex-1">
                    These prices don&apos;t match the published price for <code>{published.id}</code> (${published.input} / ${published.cachedInput} cached / ${published.output} per 1M).
                  </span>
                  <Button size="xs" variant="outline" onClick={() => setF({ ...f, inputPricePerMTok: published.input, cachedInputPricePerMTok: published.cachedInput, outputPricePerMTok: published.output })}>
                    Use published prices
                  </Button>
                </div>
              )}
              <p className="mt-2 text-[11px] text-muted-foreground">
                Costs are estimates calculated from the token counts your provider reports and the prices you enter here. Check your provider&apos;s pricing page and billing dashboard for exact figures — API usage is not free.
              </p>
            </div>
            <Button onClick={persist} disabled={save.isPending} className="self-end">
              {save.isPending && <Loader2 className="animate-spin" />} Save AI settings
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Usage this month</CardTitle>
            <CardDescription className="mt-1">Estimated from reported token usage</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Estimated cost" value={formatUsd(spent)} />
            <Stat label="Requests" value={String(usage?.month.requests ?? 0)} />
            <Stat label={`Input tokens (${(usage?.month.cachedTokens ?? 0).toLocaleString()} cached)`} value={(usage?.month.promptTokens ?? 0).toLocaleString()} />
            <Stat label="Output tokens" value={(usage?.month.completionTokens ?? 0).toLocaleString()} />
          </div>
          {budget > 0 && (
            <div>
              <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                <span>Monthly limit</span>
                <span className="tabular-nums">
                  {formatUsd(spent)} / {formatUsd(budget)}
                </span>
              </div>
              <Progress value={Math.min(100, (spent / budget) * 100)} indicatorClassName={spent / budget > 0.8 ? "bg-destructive" : "bg-violet-500"} />
            </div>
          )}
          {usage && usage.byFeature.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-1.5 font-medium">Feature</th>
                  <th className="py-1.5 text-right font-medium">Requests</th>
                  <th className="py-1.5 text-right font-medium">Tokens</th>
                  <th className="py-1.5 text-right font-medium">Est. cost</th>
                </tr>
              </thead>
              <tbody>
                {usage.byFeature.map((r) => (
                  <tr key={r.feature} className="border-b last:border-0">
                    <td className="py-1.5 capitalize">{r.feature.replace("-", " ")}</td>
                    <td className="py-1.5 text-right tabular-nums">{r.requests}</td>
                    <td className="py-1.5 text-right tabular-nums">{r.tokens.toLocaleString()}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatUsd(r.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {usage && !usage.byFeature.length && <p className="text-sm text-muted-foreground">No AI requests this month.</p>}
        </CardContent>
      </Card>
    </div>
  );
}

function Num({ label, value, onChange, step, hint }: { label: string; value: number; onChange: (v: number) => void; step: number; hint?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <Input type="number" min={0} step={step} value={Number.isFinite(value) ? value : 0} onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))} />
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted/60 p-3">
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}
