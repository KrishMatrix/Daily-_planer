"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Sparkles, Target } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDateShort, formatTime12 } from "@/lib/dates";
import { api, formatMinutes } from "@/lib/utils";
import { usePlannerUI } from "../planner-ui";
import { useConfirm } from "../confirm-dialog";
import { withCostConfirm } from "./cost-confirm";

type Review = {
  weekStart: string;
  weekEnd: string;
  facts: {
    tasks_planned: number;
    tasks_completed: number;
    tasks_incomplete_on_past_days: number;
    missed_deadlines: { title: string; deadline: string }[];
    per_day: { day: string; date: string; scheduled_minutes: number; tasks: number; completed: number }[];
    scheduling_conflicts: number;
  };
  review: { summary: string; wins: string[]; concerns: string[]; recommendations: string[] };
  source: "ai" | "rules";
  aiNote?: string;
};

export function ReviewWeekDialog() {
  const { reviewOpen, setReviewOpen } = usePlannerUI();
  const [data, setData] = useState<Review | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { confirm, element } = useConfirm();

  useEffect(() => {
    if (!reviewOpen) return;
    setLoading(true);
    setError(null);
    withCostConfirm((confirmed) => api<Review>("/api/ai/review-week", { method: "POST", body: { confirmed } }), confirm)
      .then((r) => (r ? setData(r) : setReviewOpen(false)))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewOpen]);

  const maxMin = Math.max(60, ...(data?.facts.per_day.map((d) => d.scheduled_minutes) ?? [0]));

  return (
    <Dialog
      open={reviewOpen}
      onOpenChange={(o) => {
        setReviewOpen(o);
        if (!o) setData(null);
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-5 text-violet-500" /> Review my week
          </DialogTitle>
          <DialogDescription>{data ? `${formatDateShort(data.weekStart)} – ${formatDateShort(data.weekEnd)}` : "Looking back to plan ahead"}</DialogDescription>
        </DialogHeader>
        {loading && (
          <div className="flex flex-col items-center gap-3 py-12 text-sm text-muted-foreground">
            <Loader2 className="size-6 animate-spin text-violet-500" /> Reviewing completed tasks, deadlines and workload…
          </div>
        )}
        {error && <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
        {data && !loading && (
          <div className="flex flex-col gap-5">
            <p className="text-sm">{data.review.summary}</p>
            {data.aiNote && <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">{data.aiNote}</p>}

            <div className="grid grid-cols-3 gap-2 text-center">
              <Stat label="Completed" value={`${data.facts.tasks_completed}/${data.facts.tasks_planned}`} />
              <Stat label="Missed deadlines" value={String(data.facts.missed_deadlines.length)} />
              <Stat label="Conflicts" value={String(data.facts.scheduling_conflicts)} />
            </div>

            <div>
              <div className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Workload by day (scheduled time)</div>
              <div className="flex h-28 items-end gap-2">
                {data.facts.per_day.map((d) => (
                  <div key={d.date} className="flex flex-1 flex-col items-center gap-1">
                    <span className="text-[10px] text-muted-foreground tabular-nums">{d.scheduled_minutes ? formatMinutes(d.scheduled_minutes) : ""}</span>
                    <div className="w-full rounded-t-md bg-primary/70" style={{ height: `${(d.scheduled_minutes / maxMin) * 72}px`, minHeight: d.scheduled_minutes ? 4 : 0 }} title={`${d.day}: ${formatMinutes(d.scheduled_minutes)}`} />
                    <span className="text-[11px] font-medium text-muted-foreground">{d.day.slice(0, 3)}</span>
                  </div>
                ))}
              </div>
            </div>

            <Section icon={<CheckCircle2 className="size-4 text-success" />} title="Wins" items={data.review.wins} empty="No completed tasks recorded this week." />
            <Section icon={<AlertTriangle className="size-4 text-amber-500" />} title="Watch out" items={data.review.concerns} empty="Nothing concerning." />
            <Section icon={<Target className="size-4 text-violet-500" />} title="Recommendations" items={data.review.recommendations} />
            <p className="text-xs text-muted-foreground">
              {data.source === "ai" ? "Written by AI from the numbers above." : "Rule-based review from your data."} Generated {formatTime12(new Date().toTimeString().slice(0, 5))}.
            </p>
          </div>
        )}
        {element}
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted/60 p-3">
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

function Section({ icon, title, items, empty }: { icon: React.ReactNode; title: string; items: string[]; empty?: string }) {
  if (!items.length && !empty) return null;
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold">
        {icon} {title}
      </div>
      {items.length ? (
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
          {items.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{empty}</p>
      )}
    </div>
  );
}
