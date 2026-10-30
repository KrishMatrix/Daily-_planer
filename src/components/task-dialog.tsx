"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Copy, Link2, Loader2, Paperclip, Repeat, Sparkles, Trash2, X, Check, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useCategories, useTaskActions } from "@/hooks/use-planner";
import { durationMinutes, formatDateShort, formatTime12, toMinutes, fromMinutes, weekdayOf, WEEKDAYS_SHORT } from "@/lib/dates";
import type { Recurrence } from "@/lib/recurrence";
import { KIND_LABEL, PRIORITY_LABEL, type Priority, type ScheduleItem, type TaskKind } from "@/lib/types";
import { api, cn, formatMinutes } from "@/lib/utils";
import type { TaskCreateInput, TaskUpdateInput } from "@/lib/validation";
import { usePlannerUI } from "./planner-ui";
import { useConfirm } from "./confirm-dialog";

type FormState = {
  title: string;
  kind: TaskKind;
  priority: Priority;
  categoryId: string;
  subjectId: string;
  project: string;
  location: string;
  outdoor: boolean;
  date: string;
  startTime: string;
  endTime: string;
  deadlineDate: string;
  deadlineTime: string;
  estimatedMinutes: string;
  repeat: "" | Recurrence["freq"];
  interval: string;
  byWeekday: number[];
  until: string;
  reminder: string;
  description: string;
  notes: string;
};

const REMINDERS = [
  { v: "", l: "No reminder" },
  { v: "0", l: "At start time" },
  { v: "5", l: "5 minutes before" },
  { v: "10", l: "10 minutes before" },
  { v: "15", l: "15 minutes before" },
  { v: "30", l: "30 minutes before" },
  { v: "60", l: "1 hour before" },
  { v: "120", l: "2 hours before" },
  { v: "1440", l: "1 day before" },
];

const PRIORITIES: Priority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];
const PRIORITY_STYLE: Record<Priority, string> = {
  LOW: "data-[on=true]:bg-slate-500 data-[on=true]:text-white",
  MEDIUM: "data-[on=true]:bg-sky-500 data-[on=true]:text-white",
  HIGH: "data-[on=true]:bg-orange-500 data-[on=true]:text-white",
  URGENT: "data-[on=true]:bg-red-500 data-[on=true]:text-white",
};

function initialState(item?: ScheduleItem, defaults?: Partial<TaskCreateInput>): FormState {
  const src = item ?? (defaults as Partial<ScheduleItem> | undefined) ?? {};
  const rec = (item?.recurrence ?? defaults?.recurrence ?? null) as Recurrence | null;
  return {
    title: src.title ?? "",
    kind: (src.kind as TaskKind) ?? "TASK",
    priority: (src.priority as Priority) ?? "MEDIUM",
    categoryId: src.categoryId ?? "",
    subjectId: src.subjectId ?? "",
    project: src.project ?? "",
    location: src.location ?? "",
    outdoor: src.outdoor ?? false,
    date: src.date ?? "",
    startTime: src.startTime ?? "",
    endTime: src.endTime ?? "",
    deadlineDate: src.deadlineDate ?? "",
    deadlineTime: src.deadlineTime ?? "",
    estimatedMinutes: src.estimatedMinutes ? String(src.estimatedMinutes) : "",
    repeat: rec?.freq ?? "",
    interval: String(rec?.interval ?? 1),
    byWeekday: rec?.byWeekday ?? [],
    until: rec?.until ?? "",
    reminder: src.reminderMinutes?.length ? String(src.reminderMinutes[0]) : "",
    description: src.description ?? "",
    notes: src.notes ?? "",
  };
}

type Suggestion = {
  suggestion: { date: string; startTime: string; endTime: string } | null;
  alternatives: { date: string; startTime: string; endTime: string; label: string }[];
  message: string;
  source: "ai" | "rules";
  aiNote?: string;
};

export function TaskDialog() {
  const { taskDialog, closeTask } = usePlannerUI();
  const open = taskDialog !== null;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && closeTask()}>
      <DialogContent className="sm:max-w-2xl">
        {open && <TaskForm key={taskDialog?.item?.id ?? "new"} item={taskDialog?.item} defaults={taskDialog?.defaults} onDone={closeTask} />}
      </DialogContent>
    </Dialog>
  );
}

function TaskForm({ item, defaults, onDone }: { item?: ScheduleItem; defaults?: Partial<TaskCreateInput>; onDone: () => void }) {
  const [f, setF] = useState<FormState>(() => initialState(item, defaults));
  const [saving, setSaving] = useState(false);
  const [showMore, setShowMore] = useState(Boolean(item?.description || item?.notes || item?.location || item?.outdoor));
  const [suggesting, setSuggesting] = useState(false);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const { data: categories = [] } = useCategories();
  const { data: subjects = [] } = useQuery({
    queryKey: ["subjects"],
    queryFn: () => api<{ subjects: { id: string; name: string; color: string }[] }>("/api/university/subjects").then((r) => r.subjects),
    staleTime: 60_000,
  });
  const { create, update, remove, duplicate } = useTaskActions();
  const { confirm, element: confirmEl } = useConfirm();
  const qc = useQueryClient();

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));
  const category = categories.find((c) => c.id === f.categoryId);
  const isUni = category?.key === "university" || ["CLASS", "ASSIGNMENT", "EXAM", "STUDY"].includes(f.kind);
  const isWork = category?.key === "work";
  const editing = Boolean(item);
  const isOccurrence = Boolean(item?.occurrenceDate);

  // Default category for new tasks.
  useEffect(() => {
    if (!editing && !f.categoryId && categories.length && !defaults?.categoryId) {
      const fallback = categories.find((c) => c.key === "personal") ?? categories[0];
      setF((s) => ({ ...s, categoryId: s.categoryId || fallback.id }));
    }
  }, [categories, editing, f.categoryId, defaults?.categoryId]);

  const duration = useMemo(() => {
    if (f.startTime && f.endTime) return durationMinutes(f.startTime, f.endTime);
    return Number(f.estimatedMinutes) || 60;
  }, [f.startTime, f.endTime, f.estimatedMinutes]);

  const onStartChange = (v: string) => {
    setF((s) => {
      if (!v) return { ...s, startTime: "", endTime: "" };
      const dur = s.startTime && s.endTime ? durationMinutes(s.startTime, s.endTime) : Number(s.estimatedMinutes) || 60;
      return { ...s, startTime: v, endTime: fromMinutes(Math.min(toMinutes(v) + dur, 23 * 60 + 59)) };
    });
  };

  const buildPayload = (): TaskCreateInput | null => {
    if (!f.title.trim()) {
      toast.error("Give the task a title");
      return null;
    }
    if (f.startTime && f.endTime && toMinutes(f.endTime) <= toMinutes(f.startTime)) {
      toast.error("End time must be after the start time");
      return null;
    }
    let recurrence: Recurrence | null = null;
    if (f.repeat) {
      if (!f.date) {
        toast.error("Pick a start date for a repeating task");
        return null;
      }
      recurrence = {
        freq: f.repeat,
        interval: Math.max(1, Number(f.interval) || 1),
        ...(f.repeat === "WEEKLY" ? { byWeekday: f.byWeekday.length ? [...f.byWeekday].sort() : [weekdayOf(f.date)] } : {}),
        ...(f.until ? { until: f.until } : {}),
      };
    }
    return {
      title: f.title.trim(),
      kind: f.kind,
      priority: f.priority,
      categoryId: f.categoryId || null,
      subjectId: isUni && f.subjectId ? f.subjectId : null,
      project: isWork && f.project.trim() ? f.project.trim() : null,
      location: f.location.trim() || null,
      outdoor: f.outdoor,
      date: f.date || null,
      startTime: f.startTime || null,
      endTime: f.startTime ? f.endTime || null : null,
      deadlineDate: f.deadlineDate || null,
      deadlineTime: f.deadlineDate && f.deadlineTime ? f.deadlineTime : null,
      estimatedMinutes: f.estimatedMinutes ? Number(f.estimatedMinutes) : null,
      recurrence,
      reminderMinutes: f.reminder !== "" ? [Number(f.reminder)] : [],
      description: f.description,
      notes: f.notes,
      completed: item?.completed ?? false,
    };
  };

  const save = async () => {
    const payload = buildPayload();
    if (!payload) return;
    setSaving(true);
    try {
      if (!item) {
        await create.mutateAsync(payload);
      } else {
        let scope: "occurrence" | "series" = "occurrence";
        if (isOccurrence) {
          const choice = await confirm({
            title: "Edit repeating task",
            description: "Apply your changes to this occurrence only, or to every occurrence in the series?",
            choices: [
              { label: "This one", value: "occurrence" },
              { label: "All occurrences", value: "series" },
            ],
          });
          if (!choice) return;
          scope = choice as "occurrence" | "series";
        }
        // Only send fields that changed.
        const before = initialState(item);
        const changes: TaskUpdateInput = {};
        const p = payload as Record<string, unknown>;
        const keysToCheck: (keyof FormState)[] = Object.keys(before) as (keyof FormState)[];
        for (const k of keysToCheck) {
          if (JSON.stringify(before[k]) !== JSON.stringify(f[k])) {
            if (k === "repeat" || k === "interval" || k === "byWeekday" || k === "until") (changes as Record<string, unknown>).recurrence = payload.recurrence;
            else if (k === "reminder") changes.reminderMinutes = payload.reminderMinutes;
            else if (k in p) (changes as Record<string, unknown>)[k] = p[k];
          }
        }
        if (changes.startTime !== undefined || changes.endTime !== undefined) {
          changes.startTime = payload.startTime;
          changes.endTime = payload.endTime;
        }
        if (scope === "occurrence" && isOccurrence) delete changes.recurrence;
        if (Object.keys(changes).length) await update.mutateAsync({ item, changes, scope });
        toast.success("Saved");
      }
      onDone();
    } catch {
      // toast shown by the mutation
    } finally {
      setSaving(false);
    }
  };

  const doDelete = async () => {
    if (!item) return;
    let scope: "occurrence" | "series" = "occurrence";
    if (item.isRecurring) {
      const choice = await confirm({
        title: "Delete repeating task",
        description: "Delete just this occurrence, or the whole series (including every future occurrence)?",
        choices: [
          { label: "This one", value: "occurrence" },
          { label: "Whole series", value: "series" },
        ],
        destructive: true,
      });
      if (!choice) return;
      scope = choice as "occurrence" | "series";
    } else if (!(await confirm({ title: `Delete "${item.title}"?`, description: "This can't be undone.", confirmLabel: "Delete", destructive: true }))) return;
    remove.mutate({ item, scope });
    onDone();
  };

  const findTime = async (confirmed = false) => {
    if (!f.title.trim()) {
      toast.error("Add a title first so the assistant knows what to plan");
      return;
    }
    setSuggesting(true);
    try {
      const res = await api<Suggestion>("/api/ai/suggest", {
        method: "POST",
        body: {
          title: f.title.trim(),
          durationMinutes: Math.max(10, Math.min(duration, 600)),
          deadlineDate: f.deadlineDate || null,
          priority: f.priority,
          categoryId: f.categoryId || null,
          excludeItemId: item?.id,
          confirmed,
        },
      });
      setSuggestion(res);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSuggesting(false);
    }
  };

  const acceptSlot = (s: { date: string; startTime: string; endTime: string }) => {
    setF((x) => ({ ...x, date: s.date, startTime: s.startTime, endTime: s.endTime }));
    setSuggestion(null);
    toast.success(`Scheduled for ${formatDateShort(s.date)}, ${formatTime12(s.startTime)}`);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{editing ? "Edit task" : "New task"}</DialogTitle>
        <DialogDescription className="sr-only">Task details</DialogDescription>
      </DialogHeader>

      {isOccurrence && (
        <div className="flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-xs text-accent-foreground">
          <Repeat className="size-3.5" /> Part of a repeating series. You&apos;ll choose whether changes apply to this occurrence or all of them.
        </div>
      )}

      <div className="flex flex-col gap-4">
        <Input
          autoFocus={!editing}
          value={f.title}
          onChange={(e) => set("title", e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && save()}
          placeholder="What do you need to do?"
          className="h-11 border-0 bg-muted/60 px-3 text-base font-medium shadow-none focus-visible:ring-2 md:text-base"
          maxLength={200}
        />

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_1fr_1.5fr]">
          <Field label="Category">
            <NativeSelect value={f.categoryId} onChange={(e) => set("categoryId", e.target.value)}>
              <option value="">None</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Type">
            <NativeSelect value={f.kind} onChange={(e) => set("kind", e.target.value as TaskKind)}>
              {(Object.keys(KIND_LABEL) as TaskKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Priority" className="col-span-2 sm:col-span-1">
            <div className="grid h-9 grid-cols-4 gap-1 rounded-lg bg-muted p-1">
              {PRIORITIES.map((p) => (
                <button
                  key={p}
                  type="button"
                  data-on={f.priority === p}
                  onClick={() => set("priority", p)}
                  className={cn("rounded-md text-xs font-medium text-muted-foreground transition", PRIORITY_STYLE[p])}
                >
                  {PRIORITY_LABEL[p]}
                </button>
              ))}
            </div>
          </Field>
        </div>

        {/* Schedule */}
        <div className="rounded-xl border p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Schedule</span>
            <Button type="button" size="sm" variant="secondary" onClick={() => findTime()} disabled={suggesting}>
              {suggesting ? <Loader2 className="animate-spin" /> : <Sparkles className="text-violet-500" />}
              Find best time
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Date">
              <Input type="date" value={f.date} onChange={(e) => set("date", e.target.value)} />
            </Field>
            <Field label="Start">
              <Input type="time" value={f.startTime} onChange={(e) => onStartChange(e.target.value)} step={300} />
            </Field>
            <Field label="End">
              <Input type="time" value={f.endTime} onChange={(e) => set("endTime", e.target.value)} disabled={!f.startTime} step={300} />
            </Field>
            <Field label="Estimated">
              <NativeSelect value={f.estimatedMinutes} onChange={(e) => set("estimatedMinutes", e.target.value)}>
                <option value="">—</option>
                {[15, 30, 45, 60, 90, 120, 180, 240, 300, 360, 480].map((m) => (
                  <option key={m} value={m}>
                    {formatMinutes(m)}
                  </option>
                ))}
                {f.estimatedMinutes && ![15, 30, 45, 60, 90, 120, 180, 240, 300, 360, 480].includes(Number(f.estimatedMinutes)) && (
                  <option value={f.estimatedMinutes}>{formatMinutes(Number(f.estimatedMinutes))}</option>
                )}
              </NativeSelect>
            </Field>
          </div>

          {suggestion && (
            <div className="mt-3 rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm animate-in fade-in slide-in-from-top-1 dark:border-violet-900 dark:bg-violet-950/40">
              <div className="flex gap-2">
                <Sparkles className="mt-0.5 size-4 shrink-0 text-violet-500" />
                <div className="flex-1">
                  <p>{suggestion.message}</p>
                  {suggestion.aiNote && <p className="mt-1 text-xs text-muted-foreground">{suggestion.aiNote}</p>}
                  {suggestion.suggestion && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button size="sm" onClick={() => acceptSlot(suggestion.suggestion!)}>
                        <Check /> Accept suggestion
                      </Button>
                      {suggestion.alternatives.map((a) => (
                        <Button key={`${a.date}${a.startTime}`} size="sm" variant="outline" onClick={() => acceptSlot(a)}>
                          {formatDateShort(a.date)} {formatTime12(a.startTime)}
                        </Button>
                      ))}
                      <Button size="sm" variant="ghost" onClick={() => setSuggestion(null)}>
                        Dismiss
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Deadline">
              <Input type="date" value={f.deadlineDate} onChange={(e) => set("deadlineDate", e.target.value)} />
            </Field>
            <Field label="Due at">
              <Input type="time" value={f.deadlineTime} onChange={(e) => set("deadlineTime", e.target.value)} disabled={!f.deadlineDate} />
            </Field>
            <Field label="Reminder" className="col-span-2">
              <NativeSelect value={f.reminder} onChange={(e) => set("reminder", e.target.value)}>
                {REMINDERS.map((r) => (
                  <option key={r.v} value={r.v}>
                    {r.l}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>

          {!isOccurrence && (
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field label="Repeat">
                <NativeSelect value={f.repeat} onChange={(e) => set("repeat", e.target.value as FormState["repeat"])}>
                  <option value="">Never</option>
                  <option value="DAILY">Daily</option>
                  <option value="WEEKLY">Weekly</option>
                  <option value="MONTHLY">Monthly</option>
                </NativeSelect>
              </Field>
              {f.repeat && (
                <>
                  <Field label="Every">
                    <Input type="number" min={1} max={52} value={f.interval} onChange={(e) => set("interval", e.target.value)} />
                  </Field>
                  <Field label="Until" className="col-span-2">
                    <Input type="date" value={f.until} onChange={(e) => set("until", e.target.value)} />
                  </Field>
                </>
              )}
              {f.repeat === "WEEKLY" && (
                <div className="col-span-2 flex flex-wrap gap-1 sm:col-span-4">
                  {WEEKDAYS_SHORT.map((d, i) => {
                    const on = f.byWeekday.includes(i) || (!f.byWeekday.length && f.date && weekdayOf(f.date) === i);
                    return (
                      <button
                        key={d}
                        type="button"
                        onClick={() => set("byWeekday", on ? f.byWeekday.filter((x) => x !== i) : [...f.byWeekday, i])}
                        className={cn("h-8 w-11 rounded-md border text-xs font-medium transition", on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent")}
                      >
                        {d}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {(isUni || isWork) && (
          <div className="grid grid-cols-2 gap-3">
            {isUni && (
              <Field label="Subject">
                <NativeSelect value={f.subjectId} onChange={(e) => set("subjectId", e.target.value)}>
                  <option value="">None</option>
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
            {isWork && (
              <Field label="Project">
                <Input value={f.project} onChange={(e) => set("project", e.target.value)} placeholder="e.g. SEO" list="project-options" maxLength={80} />
                <datalist id="project-options">
                  <option value="SEO" />
                  <option value="Website" />
                  <option value="Reporting" />
                </datalist>
              </Field>
            )}
          </div>
        )}

        <button type="button" onClick={() => setShowMore((v) => !v)} className="flex items-center gap-1 self-start text-xs font-medium text-muted-foreground hover:text-foreground">
          <ChevronDown className={cn("size-3.5 transition", showMore && "rotate-180")} /> {showMore ? "Fewer details" : "Description, notes, location & outdoor"}
        </button>
        {showMore && (
          <div className="flex flex-col gap-3 animate-in fade-in">
            <Field label="Location">
              <Input value={f.location} onChange={(e) => set("location", e.target.value)} placeholder="Room, address or link" maxLength={200} />
            </Field>
            <label className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm">
              <span>
                Outdoor activity
                <span className="block text-xs text-muted-foreground">Warn me if rain is forecast during it</span>
              </span>
              <Switch checked={f.outdoor} onCheckedChange={(v) => set("outdoor", v)} aria-label="Outdoor activity" />
            </label>
            <Field label="Description">
              <Textarea value={f.description} onChange={(e) => set("description", e.target.value)} rows={2} maxLength={5000} />
            </Field>
            <Field label="Notes">
              <Textarea value={f.notes} onChange={(e) => set("notes", e.target.value)} rows={3} maxLength={20000} />
            </Field>
          </div>
        )}

        {item && <Attachments item={item} onChanged={() => qc.invalidateQueries({ queryKey: ["items"] })} />}
      </div>

      <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:items-center">
        {item && (
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={doDelete}>
              <Trash2 /> Delete
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                duplicate.mutate(item);
                onDone();
              }}
            >
              <Copy /> Duplicate
            </Button>
          </div>
        )}
        <div className="flex-1" />
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="animate-spin" /> : <CalendarClock />} {editing ? "Save changes" : "Add task"}
        </Button>
      </div>
      {confirmEl}
    </>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

type AttachmentDTO = { id: string; filename: string; mimeType: string; size: number; url: string | null };

function Attachments({ item, onChanged }: { item: ScheduleItem; onChanged: () => void }) {
  const qc = useQueryClient();
  const key = ["attachments", item.taskId];
  const { data = [] } = useQuery({
    queryKey: key,
    queryFn: () => api<{ attachments: AttachmentDTO[] }>(`/api/tasks/${item.taskId}/attachments`).then((r) => r.attachments),
  });
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState("");
  const refresh = () => {
    qc.invalidateQueries({ queryKey: key });
    onChanged();
  };

  if (item.occurrenceDate) return null; // attachments live on the series itself

  const upload = async (file: File) => {
    if (file.size > 4 * 1024 * 1024) return toast.error("Files must be 4 MB or smaller");
    setBusy(true);
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch(`/api/tasks/${item.taskId}/attachments`, { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Upload failed");
      toast.success("Attached");
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const addLink = async () => {
    const url = link.trim();
    if (!url) return;
    try {
      await api(`/api/tasks/${item.taskId}/attachments`, { method: "POST", body: { url, filename: url.replace(/^https?:\/\//, "").slice(0, 80) } });
      setLink("");
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const del = async (id: string) => {
    await api(`/api/attachments/${id}`, { method: "DELETE" }).catch((e) => toast.error(e.message));
    refresh();
  };

  return (
    <div className="rounded-xl border p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Attachments</span>
        <label className={cn("inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md px-3 text-sm font-medium hover:bg-accent", busy && "pointer-events-none opacity-50")}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />} Upload
          <input type="file" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} accept="image/*,.pdf,.txt,.md,.csv,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip" />
        </label>
      </div>
      {data.length > 0 && (
        <ul className="mb-2 flex flex-col gap-1">
          {data.map((a) => (
            <li key={a.id} className="flex items-center gap-2 rounded-md bg-muted/60 px-2 py-1.5 text-sm">
              {a.url ? <Link2 className="size-3.5 text-muted-foreground" /> : <Paperclip className="size-3.5 text-muted-foreground" />}
              <a href={a.url ?? `/api/attachments/${a.id}`} target={a.url ? "_blank" : undefined} rel="noopener noreferrer" className="min-w-0 flex-1 truncate hover:underline">
                {a.filename}
              </a>
              {!a.url && <span className="text-xs text-muted-foreground">{Math.ceil(a.size / 1024)} KB</span>}
              <button onClick={() => del(a.id)} className="rounded p-0.5 text-muted-foreground hover:text-destructive" aria-label="Remove attachment">
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Paste a link (https://…)" className="h-8" onKeyDown={(e) => e.key === "Enter" && addLink()} />
        <Button size="sm" variant="outline" onClick={addLink} disabled={!link.trim()}>
          Add link
        </Button>
      </div>
    </div>
  );
}
