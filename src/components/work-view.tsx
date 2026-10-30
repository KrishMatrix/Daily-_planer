"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Briefcase, CheckCircle2, Clock, FolderKanban, Plus, Search, Users, AlarmClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCategories, useCategoryTasks, useRange, useSettings } from "@/hooks/use-planner";
import { useToday } from "@/hooks/use-today";
import { addDays, formatTime12, startOfWeek, WEEKDAYS_SHORT } from "@/lib/dates";
import type { ScheduleItem } from "@/lib/types";
import { cn } from "@/lib/utils";
import { usePlannerUI } from "./planner-ui";
import { TaskCard } from "./task-card";

export function WorkView() {
  const { today } = useToday();
  const { data: tasks = [] } = useCategoryTasks("work");
  const { data: categories = [] } = useCategories();
  const { data: settings } = useSettings();
  const weekStart = startOfWeek(today);
  const { data: week = [] } = useRange(weekStart, addDays(weekStart, 13));
  const { openTask } = usePlannerUI();
  const work = categories.find((c) => c.key === "work");

  const weekWork = useMemo(() => week.filter((i) => i.category?.key === "work"), [week]);
  const open = tasks.filter((t) => !t.completed);
  const completed = tasks.filter((t) => t.completed).sort((a, b) => ((a.completedAt ?? "") < (b.completedAt ?? "") ? 1 : -1));
  const meetings = weekWork.filter((i) => i.kind === "MEETING" && i.date! >= today);
  const deadlines = open.filter((t) => t.deadlineDate).sort((a, b) => (a.deadlineDate! < b.deadlineDate! ? -1 : 1));
  const upcoming = open.filter((t) => t.kind !== "MEETING").sort((a, b) => ((a.date ?? "9999") < (b.date ?? "9999") ? -1 : 1));
  const projects = useMemo(() => {
    const map = new Map<string, ScheduleItem[]>();
    for (const t of tasks) {
      const k = t.project || "General";
      map.set(k, [...(map.get(k) ?? []), t]);
    }
    return [...map.entries()].sort((a, b) => (a[0] === "SEO" ? -1 : b[0] === "SEO" ? 1 : a[0].localeCompare(b[0])));
  }, [tasks]);
  const seo = tasks.filter((t) => t.project?.toLowerCase() === "seo");

  const newTask = (extra: Record<string, unknown> = {}) => openTask({ defaults: { categoryId: work?.id, ...extra } });

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl bg-sky-500/10 text-sky-500">
          <Briefcase className="size-5" />
        </span>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">ZeMA Work</h1>
          <p className="text-sm text-muted-foreground">
            {settings ? `Work hours ${formatTime12(settings.workStart)}–${formatTime12(settings.workEnd)} on ${settings.workDays.map((d) => WEEKDAYS_SHORT[d]).join(", ") || "no days"}` : "Meetings, projects and deadlines"}
            {" · "}
            <Link href="/settings" className="underline-offset-2 hover:underline">
              change
            </Link>
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => newTask({ kind: "MEETING" })}>
          <Users /> Meeting
        </Button>
        <Button size="sm" onClick={() => newTask()}>
          <Plus /> Work task
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi icon={Clock} label="Open tasks" value={open.length} />
        <Kpi icon={Users} label="Meetings (2 wks)" value={meetings.length} />
        <Kpi icon={AlarmClock} label="With deadlines" value={deadlines.length} />
        <Kpi icon={CheckCircle2} label="Done (60 days)" value={completed.length} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Work schedule — next two weeks</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-7 gap-1.5">
            {Array.from({ length: 14 }, (_, i) => addDays(weekStart, i)).map((d, i) => {
              const items = weekWork.filter((w) => w.date === d);
              const isWorkDay = settings?.workDays.includes(i % 7);
              return (
                <div key={d} className={cn("min-h-16 rounded-lg p-1.5 text-[11px]", isWorkDay ? "bg-sky-500/5 ring-1 ring-sky-500/15" : "bg-muted/40", d === today && "ring-2 ring-primary/50")}>
                  <div className="mb-1 font-medium text-muted-foreground">
                    {WEEKDAYS_SHORT[i % 7]} {Number(d.slice(8))}
                  </div>
                  {items.slice(0, 3).map((it) => (
                    <button key={it.id} onClick={() => openTask({ item: it })} className={cn("mb-0.5 block w-full truncate rounded bg-sky-500/15 px-1 text-left text-sky-800 dark:text-sky-200", it.completed && "line-through opacity-60")}>
                      {it.startTime ? `${formatTime12(it.startTime)} ` : ""}
                      {it.title}
                    </button>
                  ))}
                  {items.length > 3 && <div className="text-muted-foreground">+{items.length - 3} more</div>}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="upcoming">
        <TabsList>
          <TabsTrigger value="upcoming"><Clock /> Upcoming</TabsTrigger>
          <TabsTrigger value="meetings"><Users /> Meetings</TabsTrigger>
          <TabsTrigger value="projects"><FolderKanban /> Projects</TabsTrigger>
          <TabsTrigger value="seo"><Search /> SEO</TabsTrigger>
          <TabsTrigger value="deadlines"><AlarmClock /> Deadlines</TabsTrigger>
          <TabsTrigger value="done"><CheckCircle2 /> Completed</TabsTrigger>
        </TabsList>
        <TabsContent value="upcoming"><Grid items={upcoming} today={today} empty="No upcoming work tasks." /></TabsContent>
        <TabsContent value="meetings"><Grid items={meetings} today={today} empty="No work meetings in the next two weeks." /></TabsContent>
        <TabsContent value="projects">
          <div className="flex flex-col gap-4">
            {projects.length === 0 && <p className="text-sm text-muted-foreground">Give work tasks a project (e.g. “SEO”) to group them here.</p>}
            {projects.map(([name, list]) => {
              const done = list.filter((t) => t.completed).length;
              return (
                <Card key={name}>
                  <CardHeader>
                    <CardTitle>{name}</CardTitle>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {done}/{list.length} done
                    </span>
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {list.filter((t) => !t.completed).map((t) => (
                        <TaskCard key={t.id} item={t} today={today} showDate />
                      ))}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>
        <TabsContent value="seo">
          <div className="mb-3 flex justify-end">
            <Button size="sm" variant="outline" onClick={() => newTask({ project: "SEO" })}>
              <Plus /> SEO assignment
            </Button>
          </div>
          <Grid items={seo.filter((t) => !t.completed)} today={today} empty='No open SEO assignments. Set a work task’s project to "SEO".' />
        </TabsContent>
        <TabsContent value="deadlines"><Grid items={deadlines} today={today} empty="No work deadlines." /></TabsContent>
        <TabsContent value="done"><Grid items={completed} today={today} empty="Nothing completed in the last 60 days." compact /></TabsContent>
      </Tabs>
    </div>
  );
}

function Grid({ items, today, empty, compact }: { items: ScheduleItem[]; today: string; empty: string; compact?: boolean }) {
  if (!items.length) return <p className="py-8 text-center text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((t) => (
        <TaskCard key={t.id} item={t} today={today} showDate compact={compact} />
      ))}
    </div>
  );
}

function Kpi({ icon: Icon, label, value }: { icon: typeof Clock; label: string; value: number }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="size-3.5" /> {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </Card>
  );
}
