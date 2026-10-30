"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, Check, CheckCircle2, Loader2, Plus, Pencil, Trash2, X, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { invalidateAll } from "@/hooks/use-planner";
import { formatDateShort, formatTime12 } from "@/lib/dates";
import { api, cn } from "@/lib/utils";

type Snapshot = { title: string; date: string | null; startTime: string | null; endTime: string | null; deadlineDate: string | null; priority: string; completed: boolean };
export type Proposal = {
  id: string;
  summary: string;
  status: string;
  actions: {
    type: "create_task" | "update_task" | "reschedule_task" | "complete_task" | "delete_task";
    preview: { title: string; before?: Snapshot; after: Snapshot | null; reason?: string; important?: boolean };
  }[];
};

const when = (s?: Snapshot) => {
  if (!s) return "";
  if (!s.date) return "Unscheduled";
  return `${formatDateShort(s.date)}${s.startTime ? ` · ${formatTime12(s.startTime)}${s.endTime ? `–${formatTime12(s.endTime)}` : ""}` : ""}`;
};

function diffLines(before: Snapshot | undefined, after: Snapshot | null): string[] {
  if (!after) return before ? [`Delete · ${when(before)}`] : ["Delete"];
  if (!before) {
    const parts = [when(after)];
    if (after.deadlineDate) parts.push(`due ${formatDateShort(after.deadlineDate)}`);
    if (after.priority !== "MEDIUM") parts.push(`${after.priority.toLowerCase()} priority`);
    return [parts.join(" · ")];
  }
  const lines: string[] = [];
  if (before.date !== after.date || before.startTime !== after.startTime || before.endTime !== after.endTime) lines.push(`${when(before)} → ${when(after)}`);
  if (before.deadlineDate !== after.deadlineDate) lines.push(`Deadline: ${before.deadlineDate ? formatDateShort(before.deadlineDate) : "none"} → ${after.deadlineDate ? formatDateShort(after.deadlineDate) : "none"}`);
  if (before.priority !== after.priority) lines.push(`Priority: ${before.priority.toLowerCase()} → ${after.priority.toLowerCase()}`);
  if (before.title !== after.title) lines.push(`Rename → "${after.title}"`);
  if (!before.completed && after.completed) lines.push("Mark as complete");
  return lines;
}

/** Clear preview of AI-proposed changes. Nothing is applied until the user presses Accept. */
export function ProposalCard({ proposal, onResolved }: { proposal: Proposal; onResolved?: (status: "ACCEPTED" | "REJECTED") => void }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState(proposal.status);
  const [busy, setBusy] = useState<"accept" | "reject" | null>(null);
  // Deleting a class, exam, meeting or urgent item starts unticked: the user has to opt in explicitly.
  const [selected, setSelected] = useState<number[]>(() => proposal.actions.flatMap((a, i) => (a.type === "delete_task" && a.preview.important ? [] : [i])));
  const [results, setResults] = useState<{ index: number; ok: boolean; message: string }[] | null>(null);

  const decide = async (decision: "accept" | "reject") => {
    setBusy(decision);
    try {
      const res = await api<{ status: string; results?: typeof results }>(`/api/ai/proposals/${proposal.id}`, {
        method: "POST",
        body: { decision, selected: decision === "accept" ? selected : undefined },
      });
      setStatus(res.status);
      if (res.results) {
        setResults(res.results);
        const ok = res.results.filter((r) => r.ok).length;
        const failed = res.results.filter((r) => !r.ok && r.message !== "Skipped");
        if (failed.length) toast.warning(`Applied ${ok} change${ok === 1 ? "" : "s"}; ${failed.length} couldn't be applied.`);
        else toast.success(`Applied ${ok} change${ok === 1 ? "" : "s"}`);
      }
      invalidateAll(qc);
      onResolved?.(res.status as "ACCEPTED" | "REJECTED");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const pending = status === "PENDING";
  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="flex items-start gap-2 border-b bg-muted/40 px-3 py-2.5">
        <span className="mt-0.5 text-[10px] font-semibold tracking-wider text-violet-600 uppercase dark:text-violet-400">Proposal</span>
        <p className="flex-1 text-sm font-medium">{proposal.summary}</p>
      </div>
      <ul className="divide-y">
        {proposal.actions.map((a, i) => {
          const res = results?.find((r) => r.index === i);
          const on = selected.includes(i);
          const Icon = a.type === "create_task" ? Plus : a.type === "complete_task" ? Check : a.type === "delete_task" ? Trash2 : a.type === "reschedule_task" ? CalendarClock : Pencil;
          const label = { create_task: "New", complete_task: "Complete", delete_task: "Delete", reschedule_task: "Move", update_task: "Change" }[a.type];
          return (
            <li key={i} className={cn("flex gap-2.5 px-3 py-2.5", !on && pending && "opacity-50", a.type === "delete_task" && "bg-destructive/[0.04]")}>
              {pending ? (
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => setSelected((s) => (on ? s.filter((x) => x !== i) : [...s, i]))}
                  className="mt-1 size-4 accent-[var(--primary)]"
                  aria-label={`Include ${a.preview.title}`}
                />
              ) : res ? (
                res.ok ? <CheckCircle2 className="mt-0.5 size-4 text-success" /> : <XCircle className="mt-0.5 size-4 text-muted-foreground" />
              ) : (
                <Icon className="mt-0.5 size-4 text-muted-foreground" />
              )}
              <div className="min-w-0 flex-1 text-sm">
                <div className="font-medium">
                  <span className={cn("mr-1.5 text-xs font-normal text-muted-foreground", a.type === "delete_task" && "font-medium text-destructive")}>{label}</span>
                  {a.preview.title}
                </div>
                {a.preview.important && (
                  <div className="mt-0.5 flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-warning">
                    <AlertTriangle className="size-3.5" /> Important commitment — double-check before accepting
                  </div>
                )}
                {diffLines(a.preview.before, a.preview.after).map((l) => (
                  <div key={l} className="text-xs text-muted-foreground">
                    {l}
                  </div>
                ))}
                {a.preview.reason && <div className="mt-0.5 text-xs text-muted-foreground italic">{a.preview.reason}</div>}
                {res && !res.ok && <div className="mt-0.5 text-xs text-destructive">{res.message}</div>}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="flex items-center justify-end gap-2 border-t px-3 py-2.5">
        {pending ? (
          <>
            <Button size="sm" variant="ghost" onClick={() => decide("reject")} disabled={!!busy}>
              {busy === "reject" ? <Loader2 className="animate-spin" /> : <X />} Reject
            </Button>
            <Button size="sm" onClick={() => decide("accept")} disabled={!!busy || !selected.length}>
              {busy === "accept" ? <Loader2 className="animate-spin" /> : <Check />} Accept{selected.length !== proposal.actions.length ? ` ${selected.length}` : ""}
            </Button>
          </>
        ) : (
          <span className="text-xs font-medium text-muted-foreground">{status === "ACCEPTED" ? "Accepted" : "Rejected"}</span>
        )}
      </div>
    </div>
  );
}
