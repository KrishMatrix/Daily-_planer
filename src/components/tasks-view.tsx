"use client";

import { useMemo, useState } from "react";
import { ListTodo, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { useCategories, useCompletedTasks, useOpenTasks } from "@/hooks/use-planner";
import { useToday } from "@/hooks/use-today";
import { addDays } from "@/lib/dates";
import { PRIORITY_WEIGHT } from "@/lib/scheduler";
import type { ScheduleItem } from "@/lib/types";
import { cn } from "@/lib/utils";
import { usePlannerUI } from "./planner-ui";
import { TaskCard } from "./task-card";

const FILTERS = [
  { key: "open", label: "All open" },
  { key: "today", label: "Today" },
  { key: "overdue", label: "Overdue" },
  { key: "deadlines", label: "Due in 7 days" },
  { key: "unscheduled", label: "Unscheduled" },
  { key: "completed", label: "Completed" },
] as const;
type FilterKey = (typeof FILTERS)[number]["key"];

/** Every one-off task in one list (repeating classes live in the calendar views). */
export function TasksView() {
  const { today } = useToday();
  const { data: open = [], isLoading } = useOpenTasks();
  const [filter, setFilter] = useState<FilterKey>("open");
  const { data: completed = [] } = useCompletedTasks(filter === "completed");
  const { data: categories = [] } = useCategories();
  const { openTask } = usePlannerUI();
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState<"due" | "priority" | "date">("due");
  const [q, setQ] = useState("");

  const counts = useMemo(
    () => ({
      open: open.length,
      today: open.filter((t) => t.date === today).length,
      overdue: open.filter((t) => (t.deadlineDate && t.deadlineDate < today) || (t.date && t.date < today)).length,
      deadlines: open.filter((t) => t.deadlineDate && t.deadlineDate >= today && t.deadlineDate <= addDays(today, 7)).length,
      unscheduled: open.filter((t) => !t.date).length,
      completed: completed.length,
    }),
    [open, completed, today],
  );

  const list = useMemo(() => {
    const base: ScheduleItem[] =
      filter === "completed"
        ? completed
        : open.filter((t) => {
            if (filter === "today") return t.date === today;
            if (filter === "overdue") return (t.deadlineDate && t.deadlineDate < today) || (t.date && t.date < today);
            if (filter === "deadlines") return t.deadlineDate && t.deadlineDate >= today && t.deadlineDate <= addDays(today, 7);
            if (filter === "unscheduled") return !t.date;
            return true;
          });
    const needle = q.trim().toLowerCase();
    const filtered = base.filter((t) => (!category || t.categoryId === category) && (!needle || t.title.toLowerCase().includes(needle) || t.description.toLowerCase().includes(needle)));
    if (filter === "completed") return filtered;
    const key = (t: ScheduleItem) => (sort === "due" ? (t.deadlineDate ?? "9999") + (t.date ?? "9999") : sort === "date" ? (t.date ?? "9999") + (t.startTime ?? "") : String(9 - PRIORITY_WEIGHT[t.priority]) + (t.deadlineDate ?? "9999"));
    return [...filtered].sort((a, b) => key(a).localeCompare(key(b)));
  }, [filter, open, completed, today, category, q, sort]);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <ListTodo className="size-5" />
        </span>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">Tasks</h1>
          <p className="text-sm text-muted-foreground">Assignments, work, personal to-dos and appointments in one list</p>
        </div>
        <Button onClick={() => openTask()}>
          <Plus /> New task
        </Button>
      </div>

      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0" role="tablist">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            role="tab"
            aria-selected={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition",
              filter === f.key ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-accent",
              f.key === "overdue" && counts.overdue > 0 && filter !== f.key && "border-destructive/40 text-destructive",
            )}
          >
            {f.label}
            {f.key !== "completed" || filter === "completed" ? <span className="ml-1 opacity-70 tabular-nums">{counts[f.key]}</span> : null}
          </button>
        ))}
      </div>

      <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tasks" className="pl-9" aria-label="Search tasks" />
        </div>
        <NativeSelect value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filter by category">
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort" disabled={filter === "completed"}>
          <option value="due">Sort: deadline</option>
          <option value="priority">Sort: priority</option>
          <option value="date">Sort: scheduled date</option>
        </NativeSelect>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed py-12 text-center text-sm text-muted-foreground">
          <ListTodo className="size-6 opacity-40" />
          {filter === "overdue" ? "Nothing overdue — nice." : filter === "completed" ? "No tasks completed in the last 60 days." : "No tasks here."}
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {list.map((t) => (
            <TaskCard key={t.id} item={t} today={today} showDate />
          ))}
        </div>
      )}
    </div>
  );
}
