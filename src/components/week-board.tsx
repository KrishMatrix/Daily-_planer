"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { ChevronLeft, ChevronRight, Inbox, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useCategories, useOpenTasks, useRange, useTaskActions } from "@/hooks/use-planner";
import { useToday } from "@/hooks/use-today";
import { addDays, durationMinutes, parseDate, startOfWeek, WEEKDAYS } from "@/lib/dates";
import type { ScheduleItem } from "@/lib/types";
import { cn, formatMinutes } from "@/lib/utils";
import { usePlannerUI } from "./planner-ui";
import { TaskCard } from "./task-card";
import { ViewSwitcher } from "./view-switcher";
import { DayWeatherChip, WeeklyWeather } from "./weather/weekly-weather";

const NONE = "none";

export function WeekBoard({ initialDate }: { initialDate?: string }) {
  const { today } = useToday();
  const [weekStart, setWeekStart] = useState<string | null>(initialDate ? startOfWeek(initialDate) : null);
  useEffect(() => {
    if (!weekStart) setWeekStart(startOfWeek(today));
  }, [today, weekStart]);
  const ws = weekStart ?? startOfWeek(today);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(ws, i)), [ws]);

  const { data: items, isLoading } = useRange(ws, addDays(ws, 6));
  const { data: open = [] } = useOpenTasks();
  const { data: categories = [] } = useCategories();
  const { update, create } = useTaskActions();
  const { setPlanOpen, openChat } = usePlannerUI();
  const [active, setActive] = useState<ScheduleItem | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  // On narrower screens the board scrolls sideways — bring today's column into view.
  useEffect(() => {
    const el = boardRef.current?.querySelector<HTMLElement>(`[data-date="${today}"]`);
    const board = boardRef.current;
    if (el && board && board.scrollWidth > board.clientWidth) board.scrollTo({ left: el.offsetLeft - board.offsetLeft - 16, behavior: "smooth" });
  }, [ws, today, isLoading]);
  const [showInbox, setShowInbox] = useState(true);

  const unscheduled = open.filter((t) => !t.date);
  const byDay = useMemo(() => {
    const map = new Map<string, ScheduleItem[]>(days.map((d) => [d, []]));
    for (const i of items ?? []) map.get(i.date!)?.push(i);
    return map;
  }, [items, days]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // Long-press to drag on touch screens so normal swiping still scrolls the board.
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const onDragStart = (e: DragStartEvent) => {
    setActive((e.active.data.current?.item as ScheduleItem) ?? null);
    navigator.vibrate?.(10);
  };

  const onDragEnd = (e: DragEndEvent) => {
    setActive(null);
    const item = e.active.data.current?.item as ScheduleItem | undefined;
    const over = e.over?.id ? String(e.over.id) : null;
    if (!item || !over) return;
    const target = over.replace(/^day:/, "");
    if (target === NONE) {
      if (!item.date) return;
      if (item.isRecurring) return toast.info("Repeating tasks can't be unscheduled — edit the series instead.");
      update.mutate({ item, changes: { date: null, startTime: null, endTime: null } });
      return;
    }
    if (item.date === target) return;
    update.mutate({ item, changes: { date: target } });
  };

  const label = `${parseDate(ws).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })} – ${parseDate(addDays(ws, 6)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`;
  const defaultCategory = categories.find((c) => c.key === "personal")?.id ?? null;

  return (
    <div className="mx-auto flex max-w-[1800px] flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Weekly planner</h1>
          <p className="text-sm text-muted-foreground">{label}</p>
        </div>
        <div className="flex-1" />
        <ViewSwitcher date={ws <= today && today <= addDays(ws, 6) ? undefined : ws} />
        <div className="flex items-center gap-1 rounded-lg border bg-card p-1 shadow-xs">
          <Button variant="ghost" size="icon-sm" onClick={() => setWeekStart(addDays(ws, -7))} aria-label="Previous week">
            <ChevronLeft />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setWeekStart(startOfWeek(today))} disabled={ws === startOfWeek(today)}>
            This week
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => setWeekStart(addDays(ws, 7))} aria-label="Next week">
            <ChevronRight />
          </Button>
        </div>
        <Button variant="outline" size="sm" onClick={() => setShowInbox((v) => !v)}>
          <Inbox /> Unscheduled{unscheduled.length ? ` (${unscheduled.length})` : ""}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => (ws === startOfWeek(today) ? setPlanOpen(true) : openChat(`Organize my week starting ${ws}.`))}>
          <Sparkles className="text-violet-500" /> {ws === startOfWeek(today) ? "Plan today" : "Organize week"}
        </Button>
      </div>

      <WeeklyWeather days={days} />

      <DndContext
        sensors={sensors}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActive(null)}
        // Only scroll the board when the pointer is right at its edge; the default (20% of the width)
        // covers a whole column and slides the board away while dropping.
        autoScroll={{ threshold: { x: 0.05, y: 0.1 }, acceleration: 8 }}
      >
        {showInbox && (
          <Droppable id={`day:${NONE}`} className="rounded-xl border border-dashed bg-muted/30 p-3">
            {(isOver) => (
              <>
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  <Inbox className="size-3.5" /> Unscheduled
                  <span className="font-normal normal-case">— drag onto a day to schedule</span>
                </div>
                {unscheduled.length === 0 ? (
                  <p className={cn("py-2 text-sm text-muted-foreground", isOver && "text-primary")}>{isOver ? "Drop to unschedule" : "Nothing waiting. Drop a task here to unschedule it."}</p>
                ) : (
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {unscheduled.map((t) => (
                      <Draggable key={t.id} item={t} className="w-60 shrink-0">
                        <TaskCard item={t} today={today} compact />
                      </Draggable>
                    ))}
                  </div>
                )}
              </>
            )}
          </Droppable>
        )}

        <div ref={boardRef} className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6 2xl:mx-0 2xl:grid 2xl:snap-none 2xl:grid-cols-7 2xl:overflow-visible 2xl:px-0">
          {days.map((date, i) => {
            const dayItems = byDay.get(date) ?? [];
            const mins = dayItems.reduce((s, it) => s + (durationMinutes(it.startTime, it.endTime) || (!it.startTime ? (it.estimatedMinutes ?? 0) : 0)), 0);
            const isToday = date === today;
            return (
              <Droppable
                key={date}
                id={`day:${date}`}
                date={date}
                className={cn(
                  "flex w-[82vw] shrink-0 snap-start flex-col rounded-2xl border bg-card/60 sm:w-64 2xl:w-auto 2xl:min-w-0",
                  isToday && "border-primary/40 bg-primary/[0.03] ring-1 ring-primary/20",
                  date < today && "opacity-80",
                )}
              >
                {(isOver) => (
                  <>
                    <div className="flex flex-col gap-1 border-b px-3 py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <Link href={`/day?date=${date}`} className="flex items-center gap-2 rounded-md hover:text-primary" title="Open daily view">
                          <span className={cn("text-sm font-semibold", isToday && "text-primary")}>{WEEKDAYS[i]}</span>
                          <span className={cn("text-sm text-muted-foreground tabular-nums", isToday && "flex size-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground")}>
                            {Number(date.slice(8))}
                          </span>
                        </Link>
                        <DayWeatherChip date={date} />
                      </div>
                      <span className="text-[11px] text-muted-foreground tabular-nums">
                        {dayItems.filter((d) => !d.completed).length} open{mins ? ` · ${formatMinutes(mins)}` : ""}
                      </span>
                    </div>
                    <div className={cn("flex min-h-40 flex-1 flex-col gap-2 p-2 transition-colors", isOver && "rounded-b-2xl bg-primary/5")}>
                      {isLoading && !items ? (
                        <>
                          <Skeleton className="h-14" />
                          <Skeleton className="h-14" />
                        </>
                      ) : (
                        dayItems.map((it) => (
                          <Draggable key={it.id} item={it}>
                            <TaskCard item={it} today={today} />
                          </Draggable>
                        ))
                      )}
                      <InlineAdd onAdd={(title) => create.mutate({ title, date, categoryId: defaultCategory })} />
                    </div>
                  </>
                )}
              </Droppable>
            );
          })}
        </div>

        <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.2, 0, 0, 1)" }}>{active ? <TaskCard item={active} today={today} dragging className="w-64" /> : null}</DragOverlay>
      </DndContext>
    </div>
  );
}

function Droppable({ id, date, className, children }: { id: string; date?: string; className?: string; children: (isOver: boolean) => React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} data-date={date} className={cn("transition-shadow", isOver && "shadow-lg ring-2 ring-primary/40", className)}>
      {children(isOver)}
    </div>
  );
}

function Draggable({ item, children, className }: { item: ScheduleItem; children: React.ReactNode; className?: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: item.id, data: { item } });
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} className={cn("touch-manipulation outline-none", isDragging && "opacity-30", className)}>
      {children}
    </div>
  );
}

function InlineAdd({ onAdd }: { onAdd: (title: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  if (!editing)
    return (
      <button onClick={() => setEditing(true)} className="mt-auto flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground">
        <Plus className="size-4" /> Add task
      </button>
    );
  const submit = () => {
    const v = value.trim();
    if (v) onAdd(v);
    setValue("");
  };
  return (
    <Input
      autoFocus
      value={value}
      placeholder="Task name, then Enter"
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.nativeEvent.isComposing) submit();
        if (e.key === "Escape") setEditing(false);
      }}
      onBlur={() => {
        submit();
        setEditing(false);
      }}
      maxLength={200}
      className="mt-auto h-9 bg-card"
    />
  );
}
