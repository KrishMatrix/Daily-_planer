"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, CalendarRange, ClipboardList, GraduationCap, NotebookPen, Plus, Trash2, FileText, Timer, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { invalidateAll, useCategories, useOpenTasks, useRange } from "@/hooks/use-planner";
import { useToday } from "@/hooks/use-today";
import { addDays, formatDateShort, formatTime12, toMinutes, WEEKDAYS_SHORT } from "@/lib/dates";
import { CATEGORY_PALETTE } from "@/lib/defaults";
import type { Recurrence } from "@/lib/recurrence";
import { api, cn } from "@/lib/utils";
import { usePlannerUI } from "./planner-ui";
import { useConfirm } from "./confirm-dialog";
import { DeadlineBadge, TaskCard } from "./task-card";

type Semester = { id: string; name: string; startDate: string; endDate: string };
type Subject = { id: string; name: string; code: string; instructor: string; color: string; semesterId: string | null; _count: { tasks: number; notes: number } };
type ClassSeries = { id: string; title: string; subject: { id: string; name: string; color: string } | null; startTime: string; endTime: string; location: string | null; recurrence: Recurrence; date: string };
type Note = { id: string; title: string; content: string; date: string | null; subjectId: string; subject: { name: string; color: string } };

export function UniversityView() {
  const { today } = useToday();
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-500">
          <GraduationCap className="size-5" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">University</h1>
          <p className="text-sm text-muted-foreground">Timetable, subjects, assignments, exams, study sessions and notes</p>
        </div>
      </div>
      <Tabs defaultValue="timetable">
        <TabsList>
          <TabsTrigger value="timetable"><CalendarRange /> Timetable</TabsTrigger>
          <TabsTrigger value="assignments"><ClipboardList /> Assignments</TabsTrigger>
          <TabsTrigger value="exams"><FileText /> Exams</TabsTrigger>
          <TabsTrigger value="study"><Timer /> Study</TabsTrigger>
          <TabsTrigger value="subjects"><BookOpen /> Subjects</TabsTrigger>
          <TabsTrigger value="notes"><NotebookPen /> Notes</TabsTrigger>
        </TabsList>
        <TabsContent value="timetable"><Timetable /></TabsContent>
        <TabsContent value="assignments"><KindList kind="ASSIGNMENT" today={today} label="assignment" /></TabsContent>
        <TabsContent value="exams"><KindList kind="EXAM" today={today} label="exam" /></TabsContent>
        <TabsContent value="study"><StudySessions today={today} /></TabsContent>
        <TabsContent value="subjects"><Subjects /></TabsContent>
        <TabsContent value="notes"><Notes today={today} /></TabsContent>
      </Tabs>
    </div>
  );
}

function useUniData() {
  const semesters = useQuery({ queryKey: ["semesters"], queryFn: () => api<{ semesters: Semester[] }>("/api/university/semesters").then((r) => r.semesters) });
  const subjects = useQuery({ queryKey: ["subjects"], queryFn: () => api<{ subjects: Subject[] }>("/api/university/subjects").then((r) => r.subjects) });
  return { semesters: semesters.data ?? [], subjects: subjects.data ?? [], loading: semesters.isLoading || subjects.isLoading };
}

function Timetable() {
  const qc = useQueryClient();
  const { semesters, subjects } = useUniData();
  const { data: classes = [] } = useQuery({ queryKey: ["classes"], queryFn: () => api<{ classes: ClassSeries[] }>("/api/university/classes").then((r) => r.classes) });
  const { confirm, element } = useConfirm();
  const [sem, setSem] = useState({ name: "", startDate: "", endDate: "" });
  const [form, setForm] = useState({ subjectId: "", semesterId: "", weekdays: [] as number[], startTime: "09:00", endTime: "10:30", location: "", type: "Lecture" });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["classes"] });
    qc.invalidateQueries({ queryKey: ["semesters"] });
    invalidateAll(qc);
  };

  const addSemester = useMutation({
    mutationFn: () => api("/api/university/semesters", { method: "POST", body: sem }),
    onSuccess: () => {
      toast.success("Semester added");
      setSem({ name: "", startDate: "", endDate: "" });
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });

  const addClass = useMutation({
    mutationFn: () => api("/api/university/classes", { method: "POST", body: { ...form, semesterId: form.semesterId || semesters[0]?.id, location: form.location || undefined } }),
    onSuccess: () => {
      toast.success("Class added — it repeats every week until the semester ends");
      setForm((f) => ({ ...f, weekdays: [], location: "" }));
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });

  const removeClass = async (c: ClassSeries) => {
    if (!(await confirm({ title: `Remove "${c.title}"?`, description: "All weekly occurrences will be removed from your calendar.", confirmLabel: "Remove", destructive: true }))) return;
    await api(`/api/university/classes/${c.id}`, { method: "DELETE" }).catch((e) => toast.error(e.message));
    refresh();
  };

  const removeSemester = async (s: Semester) => {
    if (!(await confirm({ title: `Delete semester "${s.name}"?`, description: "Subjects stay; their classes keep their current end date.", confirmLabel: "Delete", destructive: true }))) return;
    await api(`/api/university/semesters/${s.id}`, { method: "DELETE" }).catch((e) => toast.error(e.message));
    refresh();
  };

  const grid = useMemo(() => {
    const byDay: { c: ClassSeries; day: number }[][] = Array.from({ length: 7 }, () => []);
    for (const c of classes) for (const d of c.recurrence.byWeekday ?? []) byDay[d].push({ c, day: d });
    byDay.forEach((l) => l.sort((a, b) => toMinutes(a.c.startTime) - toMinutes(b.c.startTime)));
    return byDay;
  }, [classes]);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Weekly timetable</CardTitle>
          <span className="text-xs text-muted-foreground">Classes repeat automatically until the semester ends</span>
        </CardHeader>
        <CardContent>
          {classes.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No classes yet. Add a semester and your first class below.</p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:grid-cols-7">
              {grid.map((list, d) => (
                <div key={d} className={cn("flex flex-col gap-1.5 rounded-xl bg-muted/40 p-2", !list.length && "hidden lg:flex")}>
                  <div className="px-1 text-xs font-semibold text-muted-foreground">{WEEKDAYS_SHORT[d]}</div>
                  {list.map(({ c }) => (
                    <div key={c.id + d} className="group relative rounded-lg border-l-4 bg-card p-2 text-xs shadow-xs" style={{ borderLeftColor: c.subject?.color ?? "#6366f1" }}>
                      <div className="font-medium">{c.title}</div>
                      <div className="text-muted-foreground tabular-nums">
                        {formatTime12(c.startTime)}–{formatTime12(c.endTime)}
                      </div>
                      {c.location && <div className="truncate text-muted-foreground">{c.location}</div>}
                      <div className="text-[10px] text-muted-foreground">until {c.recurrence.until ? formatDateShort(c.recurrence.until) : "—"}</div>
                      <button onClick={() => removeClass(c)} className="absolute top-1.5 right-1.5 rounded p-0.5 text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:text-destructive focus:opacity-100" aria-label="Remove class">
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Add a class</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {!semesters.length || !subjects.length ? (
              <p className="text-sm text-muted-foreground">{!semesters.length ? "Add a semester first (right)." : "Add a subject first (Subjects tab)."}</p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <F label="Subject">
                    <NativeSelect value={form.subjectId} onChange={(e) => setForm({ ...form, subjectId: e.target.value })}>
                      <option value="">Choose…</option>
                      {subjects.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </F>
                  <F label="Semester">
                    <NativeSelect value={form.semesterId || semesters[0]?.id} onChange={(e) => setForm({ ...form, semesterId: e.target.value })}>
                      {semesters.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </F>
                </div>
                <F label="Days">
                  <div className="flex flex-wrap gap-1">
                    {WEEKDAYS_SHORT.map((d, i) => {
                      const on = form.weekdays.includes(i);
                      return (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setForm({ ...form, weekdays: on ? form.weekdays.filter((x) => x !== i) : [...form.weekdays, i] })}
                          className={cn("h-8 w-11 rounded-md border text-xs font-medium", on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent")}
                        >
                          {d}
                        </button>
                      );
                    })}
                  </div>
                </F>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <F label="Start"><Input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} /></F>
                  <F label="End"><Input type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} /></F>
                  <F label="Type">
                    <NativeSelect value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                      {["Lecture", "Tutorial", "Lab", "Seminar", "Exercise"].map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </NativeSelect>
                  </F>
                  <F label="Room"><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="e.g. HS 1" /></F>
                </div>
                <Button onClick={() => addClass.mutate()} disabled={!form.subjectId || !form.weekdays.length || addClass.isPending} className="self-start">
                  <Plus /> Add class
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Semesters</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {semesters.map((s) => (
              <div key={s.id} className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm">
                <span className="flex-1 font-medium">{s.name}</span>
                <span className="text-xs text-muted-foreground">
                  {formatDateShort(s.startDate)} – {formatDateShort(s.endDate)}
                </span>
                <button onClick={() => removeSemester(s)} className="rounded p-1 text-muted-foreground hover:text-destructive" aria-label="Delete semester">
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <F label="Name" className="col-span-2 sm:col-span-1"><Input value={sem.name} onChange={(e) => setSem({ ...sem, name: e.target.value })} placeholder="Winter 2026/27" /></F>
              <F label="Starts"><Input type="date" value={sem.startDate} onChange={(e) => setSem({ ...sem, startDate: e.target.value })} /></F>
              <F label="Ends"><Input type="date" value={sem.endDate} onChange={(e) => setSem({ ...sem, endDate: e.target.value })} /></F>
            </div>
            <Button variant="outline" className="self-start" onClick={() => addSemester.mutate()} disabled={!sem.name || !sem.startDate || !sem.endDate || addSemester.isPending}>
              <Plus /> Add semester
            </Button>
          </CardContent>
        </Card>
      </div>
      {element}
    </div>
  );
}

function KindList({ kind, today, label }: { kind: "ASSIGNMENT" | "EXAM"; today: string; label: string }) {
  const { data: open = [], isLoading } = useOpenTasks();
  const { data: categories = [] } = useCategories();
  const { data: recent = [] } = useRange(addDays(today, -60), addDays(today, 180));
  const { openTask } = usePlannerUI();
  const uni = categories.find((c) => c.key === "university")?.id;
  const pending = open.filter((t) => t.kind === kind);
  const done = recent.filter((t) => t.kind === kind && t.completed);
  const groups = [
    { title: "Overdue", items: pending.filter((t) => t.deadlineDate && t.deadlineDate < today) },
    { title: "This week", items: pending.filter((t) => t.deadlineDate && t.deadlineDate >= today && t.deadlineDate <= addDays(today, 7)) },
    { title: "Later", items: pending.filter((t) => t.deadlineDate && t.deadlineDate > addDays(today, 7)) },
    { title: "No deadline", items: pending.filter((t) => !t.deadlineDate) },
  ].filter((g) => g.items.length);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {pending.length} open {label}
          {pending.length === 1 ? "" : "s"}
        </p>
        <Button size="sm" onClick={() => openTask({ defaults: { kind, categoryId: uni, priority: kind === "EXAM" ? "HIGH" : "MEDIUM" } })}>
          <Plus /> New {label}
        </Button>
      </div>
      {isLoading ? null : !groups.length ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">No open {label}s. Add one with its deadline and the assistant will help you schedule time for it.</CardContent>
        </Card>
      ) : (
        groups.map((g) => (
          <div key={g.title}>
            <div className={cn("mb-2 text-xs font-semibold tracking-wide uppercase", g.title === "Overdue" ? "text-destructive" : "text-muted-foreground")}>{g.title}</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {g.items.map((t) => (
                <TaskCard key={t.id} item={t} today={today} showDate />
              ))}
            </div>
          </div>
        ))
      )}
      {done.length > 0 && (
        <details className="rounded-xl border p-3">
          <summary className="cursor-pointer text-sm font-medium">Completed ({done.length})</summary>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {done.map((t) => (
              <TaskCard key={t.id} item={t} today={today} showDate compact />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function StudySessions({ today }: { today: string }) {
  const { data: items = [] } = useRange(addDays(today, -14), addDays(today, 30));
  const { data: open = [] } = useOpenTasks();
  const { data: categories = [] } = useCategories();
  const { openTask, openChat } = usePlannerUI();
  const uni = categories.find((c) => c.key === "university")?.id;
  const sessions = items.filter((i) => i.kind === "STUDY");
  const upcoming = sessions.filter((s) => s.date! >= today);
  const past = sessions.filter((s) => s.date! < today);
  const needsTime = open.filter((t) => (t.kind === "ASSIGNMENT" || t.kind === "EXAM") && t.deadlineDate && t.deadlineDate >= today).slice(0, 4);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => openTask({ defaults: { kind: "STUDY", categoryId: uni, estimatedMinutes: 90 } })}>
          <Plus /> New study session
        </Button>
        <Button size="sm" variant="secondary" onClick={() => openChat("Find time this week for study sessions for my upcoming assignments and exams, and propose them.")}>
          <Sparkles className="text-violet-500" /> Plan study sessions with AI
        </Button>
      </div>
      {needsTime.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Upcoming deadlines that may need study time</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {needsTime.map((t) => (
              <div key={t.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="flex-1 font-medium">{t.title}</span>
                <DeadlineBadge date={t.deadlineDate!} today={today} />
                <Button size="sm" variant="outline" onClick={() => openTask({ defaults: { title: `Study: ${t.title}`, kind: "STUDY", categoryId: uni, subjectId: t.subjectId, deadlineDate: t.deadlineDate, estimatedMinutes: 90, priority: t.priority } })}>
                  Add session
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      <div>
        <div className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Upcoming</div>
        {upcoming.length ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {upcoming.map((s) => (
              <TaskCard key={s.id} item={s} today={today} showDate />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No study sessions planned. Use “Find best time” when creating one.</p>
        )}
      </div>
      {past.length > 0 && (
        <div>
          <div className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Last two weeks</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {past.map((s) => (
              <TaskCard key={s.id} item={s} today={today} showDate compact />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Subjects() {
  const qc = useQueryClient();
  const { semesters, subjects } = useUniData();
  const { confirm, element } = useConfirm();
  const [f, setF] = useState({ name: "", code: "", instructor: "", color: CATEGORY_PALETTE[0], semesterId: "" });

  const add = useMutation({
    mutationFn: () => api("/api/university/subjects", { method: "POST", body: { ...f, semesterId: f.semesterId || null } }),
    onSuccess: () => {
      toast.success("Subject added");
      setF({ name: "", code: "", instructor: "", color: CATEGORY_PALETTE[(subjects.length + 1) % CATEGORY_PALETTE.length], semesterId: f.semesterId });
      qc.invalidateQueries({ queryKey: ["subjects"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const recolor = async (s: Subject, color: string) => {
    await api(`/api/university/subjects/${s.id}`, { method: "PATCH", body: { color } }).catch((e) => toast.error(e.message));
    qc.invalidateQueries({ queryKey: ["subjects"] });
    invalidateAll(qc);
  };

  const del = async (s: Subject) => {
    if (!(await confirm({ title: `Delete "${s.name}"?`, description: "Its weekly classes and lecture notes will be removed. Assignments and exams are kept.", confirmLabel: "Delete", destructive: true }))) return;
    await api(`/api/university/subjects/${s.id}`, { method: "DELETE" }).catch((e) => toast.error(e.message));
    qc.invalidateQueries({ queryKey: ["subjects"] });
    qc.invalidateQueries({ queryKey: ["classes"] });
    invalidateAll(qc);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
      <div className="grid content-start gap-2 sm:grid-cols-2">
        {subjects.length === 0 && <p className="text-sm text-muted-foreground">No subjects yet.</p>}
        {subjects.map((s) => (
          <Card key={s.id} className="overflow-hidden">
            <div className="h-1.5" style={{ background: s.color }} />
            <CardContent className="flex flex-col gap-2 pt-3">
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <div className="font-medium">{s.name}</div>
                  <div className="text-xs text-muted-foreground">{[s.code, s.instructor].filter(Boolean).join(" · ") || "—"}</div>
                </div>
                <button onClick={() => del(s)} className="rounded p-1 text-muted-foreground hover:text-destructive" aria-label="Delete subject">
                  <Trash2 className="size-3.5" />
                </button>
              </div>
              <div className="text-xs text-muted-foreground">
                {s._count.tasks} items · {s._count.notes} notes
              </div>
              <div className="flex flex-wrap gap-1">
                {CATEGORY_PALETTE.map((c) => (
                  <button key={c} onClick={() => recolor(s, c)} className={cn("size-4 rounded-full ring-offset-2 ring-offset-card", s.color === c && "ring-2 ring-foreground/40")} style={{ background: c }} aria-label={`Colour ${c}`} />
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card className="h-fit">
        <CardHeader>
          <CardTitle>Add subject</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <F label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Mathematics II" /></F>
          <div className="grid grid-cols-2 gap-3">
            <F label="Code"><Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="MATH-102" /></F>
            <F label="Instructor"><Input value={f.instructor} onChange={(e) => setF({ ...f, instructor: e.target.value })} /></F>
          </div>
          <F label="Semester">
            <NativeSelect value={f.semesterId} onChange={(e) => setF({ ...f, semesterId: e.target.value })}>
              <option value="">None</option>
              {semesters.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </NativeSelect>
          </F>
          <F label="Colour">
            <div className="flex flex-wrap gap-1.5">
              {CATEGORY_PALETTE.map((c) => (
                <button key={c} type="button" onClick={() => setF({ ...f, color: c })} className={cn("size-6 rounded-full ring-offset-2 ring-offset-card", f.color === c && "ring-2 ring-foreground/50")} style={{ background: c }} aria-label={`Colour ${c}`} />
              ))}
            </div>
          </F>
          <Button onClick={() => add.mutate()} disabled={!f.name.trim() || add.isPending}>
            <Plus /> Add subject
          </Button>
        </CardContent>
      </Card>
      {element}
    </div>
  );
}

function Notes({ today }: { today: string }) {
  const qc = useQueryClient();
  const { subjects } = useUniData();
  const [subjectId, setSubjectId] = useState("");
  const [editing, setEditing] = useState<Partial<Note> | null>(null);
  const { confirm, element } = useConfirm();
  const { data: notes = [] } = useQuery({
    queryKey: ["notes", subjectId],
    queryFn: () => api<{ notes: Note[] }>(`/api/university/notes${subjectId ? `?subjectId=${subjectId}` : ""}`).then((r) => r.notes),
  });

  const save = async () => {
    if (!editing?.title?.trim() || !(editing.subjectId || subjectId)) return toast.error("Add a title and pick a subject");
    try {
      if (editing.id) await api(`/api/university/notes/${editing.id}`, { method: "PATCH", body: { title: editing.title, content: editing.content ?? "", date: editing.date || null } });
      else await api("/api/university/notes", { method: "POST", body: { subjectId: editing.subjectId || subjectId, title: editing.title, content: editing.content ?? "", date: editing.date || null } });
      toast.success("Note saved");
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["notes"] });
      qc.invalidateQueries({ queryKey: ["subjects"] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const del = async (n: Note) => {
    if (!(await confirm({ title: `Delete "${n.title}"?`, confirmLabel: "Delete", destructive: true }))) return;
    await api(`/api/university/notes/${n.id}`, { method: "DELETE" });
    qc.invalidateQueries({ queryKey: ["notes"] });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
      <div className="flex flex-col gap-2">
        <NativeSelect value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
          <option value="">All subjects</option>
          {subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </NativeSelect>
        <Button size="sm" onClick={() => setEditing({ subjectId: subjectId || subjects[0]?.id, date: today, title: "", content: "" })} disabled={!subjects.length}>
          <Plus /> New note
        </Button>
        <div className="flex flex-col gap-1">
          {notes.map((n) => (
            <button key={n.id} onClick={() => setEditing(n)} className={cn("rounded-lg border-l-4 px-3 py-2 text-left text-sm transition hover:bg-muted", editing?.id === n.id && "bg-muted")} style={{ borderLeftColor: n.subject.color }}>
              <div className="font-medium">{n.title}</div>
              <div className="text-xs text-muted-foreground">
                {n.subject.name}
                {n.date ? ` · ${formatDateShort(n.date)}` : ""}
              </div>
            </button>
          ))}
          {!notes.length && <p className="px-1 text-sm text-muted-foreground">{subjects.length ? "No notes yet." : "Add a subject first."}</p>}
        </div>
      </div>
      {editing ? (
        <Card>
          <CardContent className="flex flex-col gap-3 pt-5">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <F label="Title" className="col-span-2"><Input value={editing.title ?? ""} onChange={(e) => setEditing({ ...editing, title: e.target.value })} placeholder="Lecture 5 — Eigenvalues" /></F>
              <F label="Date"><Input type="date" value={editing.date ?? ""} onChange={(e) => setEditing({ ...editing, date: e.target.value })} /></F>
            </div>
            {!editing.id && (
              <F label="Subject">
                <NativeSelect value={editing.subjectId ?? ""} onChange={(e) => setEditing({ ...editing, subjectId: e.target.value })}>
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </NativeSelect>
              </F>
            )}
            <Textarea value={editing.content ?? ""} onChange={(e) => setEditing({ ...editing, content: e.target.value })} rows={14} placeholder="Your lecture notes…" className="font-mono text-sm" />
            <div className="flex gap-2">
              <Button onClick={save}>Save note</Button>
              <Button variant="outline" onClick={() => setEditing(null)}>Close</Button>
              <div className="flex-1" />
              {editing.id && (
                <Button variant="ghost" className="text-destructive" onClick={() => del(editing as Note)}>
                  <Trash2 /> Delete
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-16 text-center text-sm text-muted-foreground">
            <NotebookPen className="size-8 opacity-40" />
            Select a note or create a new one.
          </CardContent>
        </Card>
      )}
      {element}
    </div>
  );
}

function F({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

