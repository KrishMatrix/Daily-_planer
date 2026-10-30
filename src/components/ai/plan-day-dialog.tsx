"use client";

import { useEffect, useState } from "react";
import { AlarmClock, Coffee, Loader2, Lock, RefreshCw, Sparkles, Lightbulb, CalendarX2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToday } from "@/hooks/use-today";
import { formatDateShort, formatTime12 } from "@/lib/dates";
import { api, cn } from "@/lib/utils";
import { usePlannerUI } from "../planner-ui";
import { useConfirm } from "../confirm-dialog";
import { withCostConfirm } from "./cost-confirm";
import { ProposalCard, type Proposal } from "./proposal-card";
import { WeatherIcon } from "../weather/weather-icon";

type Plan = {
  date: string;
  summary: string;
  blocks: { type: "fixed" | "task" | "break"; title: string; startTime: string; endTime: string; taskId?: string }[];
  postponed: { id: string; title: string; reason: string }[];
  highlights: string[];
  tips: string[];
  proposal: Proposal | null;
  source: "ai" | "rules";
  cached?: boolean;
  weather: { summary: string; code: number; dryWindow: string | null } | null;
  aiNote?: string;
};

export function PlanDayDialog() {
  const { planOpen, setPlanOpen, planDate } = usePlannerUI();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { confirm, element } = useConfirm();
  const { today: todayStr } = useToday();

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await withCostConfirm((confirmed) => api<Plan>("/api/ai/plan-day", { method: "POST", body: { confirmed, ...(planDate ? { date: planDate } : {}) } }), confirm);
      if (res) setPlan(res);
      else if (!plan) setPlanOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (planOpen && !plan && !loading) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planOpen]);

  return (
    <Dialog
      open={planOpen}
      onOpenChange={(o) => {
        setPlanOpen(o);
        if (!o) setPlan(null);
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-5 text-violet-500" /> Plan my day{plan && plan.date !== todayStr ? ` — ${formatDateShort(plan.date)}` : planDate && planDate !== todayStr ? ` — ${formatDateShort(planDate)}` : ""}
          </DialogTitle>
          <DialogDescription>A realistic schedule around your fixed commitments, with breaks.</DialogDescription>
        </DialogHeader>

        {loading && !plan && (
          <div className="flex flex-col items-center gap-3 py-12 text-sm text-muted-foreground">
            <Loader2 className="size-6 animate-spin text-violet-500" />
            Analysing today&apos;s calendar, deadlines and free time…
          </div>
        )}
        {error && <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

        {plan && (
          <div className={cn("flex flex-col gap-4", loading && "opacity-60")}>
            <p className="text-sm">{plan.summary}</p>
            {plan.weather && (
              <div className="flex items-center gap-2 rounded-lg bg-sky-500/[0.07] px-3 py-2 text-sm">
                <WeatherIcon code={plan.weather.code} className="size-5 shrink-0" />
                <span>
                  {plan.weather.summary}
                  {plan.weather.dryWindow && <span className="block text-xs text-muted-foreground">{plan.weather.dryWindow}</span>}
                </span>
              </div>
            )}
            {plan.aiNote && <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">{plan.aiNote}</p>}

            {plan.highlights.length > 0 && (
              <div className="flex flex-col gap-1.5">
                {plan.highlights.map((h) => (
                  <div key={h} className="flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2 text-sm">
                    <AlarmClock className="mt-0.5 size-4 shrink-0 text-amber-600" /> {h}
                  </div>
                ))}
              </div>
            )}

            <ol className="relative flex flex-col gap-1.5 border-l-2 border-dashed pl-4">
              {plan.blocks.length === 0 && <li className="text-sm text-muted-foreground">Nothing scheduled — enjoy a free day.</li>}
              {plan.blocks.map((b, i) => (
                <li key={i} className="relative">
                  <span className={cn("absolute top-3 -left-[23px] size-3 rounded-full border-2 border-background", b.type === "fixed" ? "bg-slate-400" : b.type === "break" ? "bg-emerald-400" : "bg-violet-500")} />
                  <div className={cn("flex items-center gap-3 rounded-lg border px-3 py-2", b.type === "break" && "border-dashed bg-emerald-500/5", b.type === "fixed" && "bg-muted/50")}>
                    <span className="w-32 shrink-0 text-xs font-medium text-muted-foreground tabular-nums">
                      {formatTime12(b.startTime)} – {formatTime12(b.endTime)}
                    </span>
                    <span className="flex min-w-0 flex-1 items-center gap-1.5 text-sm font-medium">
                      {b.type === "fixed" && <Lock className="size-3.5 shrink-0 text-muted-foreground" />}
                      {b.type === "break" && <Coffee className="size-3.5 shrink-0 text-emerald-600" />}
                      <span className="truncate">{b.title}</span>
                    </span>
                  </div>
                </li>
              ))}
            </ol>

            {plan.postponed.length > 0 && (
              <div>
                <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  <CalendarX2 className="size-3.5" /> Can be postponed
                </div>
                <ul className="flex flex-col gap-1">
                  {plan.postponed.map((p) => (
                    <li key={p.id} className="text-sm">
                      <span className="font-medium">{p.title}</span> {p.reason && <span className="text-muted-foreground">— {p.reason}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {plan.tips.length > 0 && (
              <ul className="flex flex-col gap-1">
                {plan.tips.map((t) => (
                  <li key={t} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <Lightbulb className="mt-0.5 size-4 shrink-0 text-amber-500" /> {t}
                  </li>
                ))}
              </ul>
            )}

            {plan.proposal && <ProposalCard key={plan.proposal.id} proposal={plan.proposal} />}

            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {plan.source === "ai" ? "Prioritised by AI · times from your calendar" : "Built by the scheduler from your calendar"}
                {plan.cached ? " · reused (schedule unchanged, no AI cost)" : ""}
              </span>
              <Button size="sm" variant="ghost" onClick={run} disabled={loading}>
                <RefreshCw className={cn(loading && "animate-spin")} /> Re-plan
              </Button>
            </div>
          </div>
        )}
        {element}
      </DialogContent>
    </Dialog>
  );
}
