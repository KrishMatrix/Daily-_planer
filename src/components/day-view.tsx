"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlarmClock, AlertTriangle, ChevronLeft, ChevronRight, Clock, CloudRain, GraduationCap, ListTodo, MessageSquare, Plus, Sparkles, Sun, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useOpenTasks, useRange, useSettings } from "@/hooks/use-planner";
import { useToday } from "@/hooks/use-today";
import { useWeather } from "@/hooks/use-weather";
import { addDays, diffDays, formatDateLong, formatTime12, fromMinutes, toMinutes } from "@/lib/dates";
import { detectConflicts, findFreeSlots } from "@/lib/scheduler";
import type { ScheduleItem } from "@/lib/types";
import { goodOutdoorWindows, weatherWarningFor } from "@/lib/weather-advice";
import { cn, formatMinutes } from "@/lib/utils";
import { usePlannerUI } from "./planner-ui";
import { DeadlineBadge, TaskCard } from "./task-card";
import { ViewSwitcher } from "./view-switcher";
import { ATTRIBUTION, WeatherDetail } from "./weather/weekly-weather";

const HOUR_PX = 56;

type Positioned = { item: ScheduleItem; start: number; end: number; col: number; cols: number };

/** Lay out overlapping blocks side by side (greedy column assignment per overlap cluster). */
function layout(items: ScheduleItem[]): Positioned[] {
  const blocks = items
    .filter((i) => i.startTime)
    .map((item) => {
      const start = toMinutes(item.startTime!);
      const end = item.endTime ? Math.max(toMinutes(item.endTime), start + 15) : start + (item.estimatedMinutes ?? 30);
      return { item, start, end, col: 0, cols: 1 };
    })
    .sort((a, b) => a.start - b.start || b.end - a.end);
  let cluster: Positioned[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const cols = Math.max(1, ...cluster.map((c) => c.col + 1));
    cluster.forEach((c) => (c.cols = cols));
    cluster = [];
  };
  for (const b of blocks) {
    if (b.start >= clusterEnd) {
      flush();
      clusterEnd = -1;
    }
    const used = new Set(cluster.filter((c) => c.end > b.start).map((c) => c.col));
    let col = 0;
    while (used.has(col)) col++;
    b.col = col;
    cluster.push(b);
    clusterEnd = Math.max(clusterEnd, b.end);
  }
  flush();
  return blocks;
}

export function DayView({ initialDate }: { initialDate?: string }) {
  const { today, minutes } = useToday();
  const router = useRouter();
  const date = initialDate ?? today;
  const { data: items = [], isLoading } = useRange(date, date);
  const { data: open = [] } = useOpenTasks();
  const { data: settings } = useSettings();
  const weather = useWeather();
  const { openTask, openChat, openPlan } = usePlannerUI();
  const scroller = useRef<HTMLDivElement>(null);

  const go = (d: string) => router.push(d === today ? "/day" : `/day?date=${d}`);
  const isToday = date === today;
  const isPast = date < today;

  const timed = useMemo(() => items.filter((i) => i.startTime), [items]);
  const untimed = items.filter((i) => !i.startTime);
  const deadlines = open.filter((t) => t.deadlineDate === date);
  const classes = items.filter((i) => i.kind === "CLASS");
  const meetings = items.filter((i) => i.kind === "MEETING");
  const tasks = items.filter((i) => i.kind !== "CLASS" && i.kind !== "MEETING");

  const dayStart = settings ? toMinutes(settings.dayStart) : 8 * 60;
  const dayEnd = settings ? toMinutes(settings.dayEnd) : 22 * 60;
  const firstHour = Math.floor(Math.min(dayStart, ...timed.map((i) => toMinutes(i.startTime!))) / 60);
  const lastHour = Math.ceil(Math.max(dayEnd, ...timed.map((i) => (i.endTime ? toMinutes(i.endTime) : toMinutes(i.startTime!) + 30))) / 60);
  const hours = Array.from({ length: Math.max(1, lastHour - firstHour) }, (_, i) => firstHour + i);
  const positioned = useMemo(() => layout(timed), [timed]);

  const busy = timed.filter((i) => !i.completed && i.endTime).map((i) => ({ start: toMinutes(i.startTime!), end: toMinutes(i.endTime!) }));
  const free = isPast
    ? []
    : findFreeSlots({
        windowStart: isToday ? Math.max(dayStart, Math.ceil((minutes + 5) / 15) * 15) : dayStart,
        windowEnd: dayEnd,
        busy,
        buffer: settings?.bufferMinutes ?? 0,
        minDuration: 30,
      });
  const freeTotal = free.reduce((s, f) => s + f.end - f.start, 0);
  const scheduled = busy.reduce((s, b) => s + b.end - b.start, 0);

  // Deterministic recommendations — no AI call needed.
  const recs = useMemo(() => {
    const out: { icon: typeof Sparkles; text: string; tone?: "warn"; action?: { label: string; onClick: () => void } }[] = [];
    const conflicts = detectConflicts(timed.filter((i) => i.endTime).map((i) => ({ id: i.id, title: i.title, date: i.date!, startTime: i.startTime!, endTime: i.endTime!, kind: i.kind, completed: i.completed })));
    for (const c of conflicts.slice(0, 3))
      out.push({
        icon: AlertTriangle,
        tone: "warn",
        text: `"${c.a.title}" overlaps "${c.b.title}" by ${c.overlapMinutes} min.`,
        action: { label: "Ask AI to fix", onClick: () => openChat(`On ${date}, "${c.a.title}" and "${c.b.title}" overlap. Suggest how to resolve it.`) },
      });
    if (weather.forecast) {
      for (const i of timed) {
        const w = weatherWarningFor(i, weather.forecast);
        if (w) out.push({ icon: CloudRain, tone: "warn", text: w.message, action: { label: "Find a drier time", onClick: () => openChat(`${w.message} Suggest a better time or an indoor alternative — use the weather forecast.`) } });
      }
      const outdoorPlanned = timed.some((i) => i.outdoor);
      if (!isPast && !outdoorPlanned) {
        const win = goodOutdoorWindows(weather.forecast, date, 1, isToday ? minutes : 0)[0];
        if (win) out.push({ icon: Sun, text: `${win.message} Good for an outdoor activity.` });
      }
    }
    if (!isPast && settings) {
      const active = dayEnd - dayStart;
      if (scheduled > active * 0.75) out.push({ icon: AlertTriangle, tone: "warn", text: `${formatMinutes(scheduled)} is scheduled — that's over 75% of your active hours. Consider moving something.` });
    }
    const dueSoon = open.filter((t) => t.deadlineDate && t.deadlineDate >= date && diffDays(date, t.deadlineDate) <= 2 && t.date !== date);
    if (dueSoon.length && !isPast)
      out.push({ icon: AlarmClock, text: `${dueSoon.length} deadline${dueSoon.length > 1 ? "s" : ""} within 2 days ${dueSoon.length > 1 ? "aren't" : "isn't"} scheduled on this day.`, action: { label: "Plan this day", onClick: () => openPlan(date) } });
    if (!out.length) out.push({ icon: Sparkles, text: isPast ? "This day is in the past." : "No conflicts or risks detected for this day." });
    return out;
  }, [timed, weather.forecast, open, date, isPast, isToday, minutes, settings, scheduled, dayEnd, dayStart, openChat, openPlan]);

  // Scroll the timeline to "now" (today) or the first item.
  useEffect(() => {
    const target = isToday ? minutes : timed[0] ? toMinutes(timed[0].startTime!) : dayStart;
    scroller.current?.scrollTo({ top: Math.max(0, ((target - firstHour * 60) / 60) * HOUR_PX - 80) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, isLoading]);

  const nowTop = ((minutes - firstHour * 60) / 60) * HOUR_PX;
  const forecastDay = weather.byDate.get(date);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-muted-foreground">{isToday ? "Today" : diffDays(today, date) === 1 ? "Tomorrow" : diffDays(today, date) === -1 ? "Yesterday" : "Daily view"}</p>
          <h1 className="text-2xl font-semibold tracking-tight">{formatDateLong(date)}</h1>
        </div>
        <div className="flex-1" />
        <ViewSwitcher date={isToday ? undefined : date} />
        <div className="flex items-center gap-1 rounded-lg border bg-card p-1 shadow-xs">
          <Button variant="ghost" size="icon-sm" onClick={() => go(addDays(date, -1))} aria-label="Previous day">
            <ChevronLeft />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => go(today)} disabled={isToday}>
            Today
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => go(addDays(date, 1))} aria-label="Next day">
            <ChevronRight />
          </Button>
        </div>
        <Button onClick={() => openPlan(date)} disabled={isPast} className="bg-gradient-to-r from-indigo-500 to-violet-600 text-white hover:opacity-95">
          <Sparkles /> Plan my day
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat icon={GraduationCap} label="Classes" value={classes.length} />
            <Stat icon={Users} label="Meetings" value={meetings.length} />
            <Stat icon={ListTodo} label="Tasks" value={`${tasks.filter((t) => t.completed).length}/${tasks.length}`} />
            <Stat icon={Clock} label="Free time" value={isPast ? "—" : formatMinutes(freeTotal)} />
          </div>

          {untimed.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Any time today</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 sm:grid-cols-2">
                {untimed.map((i) => (
                  <TaskCard key={i.id} item={i} today={today} compact />
                ))}
              </CardContent>
            </Card>
          )}

          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Clock className="size-4 text-primary" /> Hourly schedule
              </CardTitle>
              <Button size="xs" variant="ghost" onClick={() => openTask({ defaults: { date } })}>
                <Plus /> Add
              </Button>
            </CardHeader>
            <div ref={scroller} className="relative max-h-[70dvh] overflow-y-auto border-t">
              {isLoading ? (
                <div className="flex flex-col gap-2 p-4">
                  <Skeleton className="h-12" />
                  <Skeleton className="h-12" />
                </div>
              ) : (
                <div className="relative" style={{ height: hours.length * HOUR_PX }}>
                  {hours.map((h, idx) => (
                    <button
                      key={h}
                      onClick={() => openTask({ defaults: { date, startTime: fromMinutes(h * 60), endTime: fromMinutes(Math.min(h * 60 + 60, 23 * 60 + 59)) } })}
                      className="group absolute inset-x-0 flex border-b border-dashed border-border/60 text-left hover:bg-accent/30"
                      style={{ top: idx * HOUR_PX, height: HOUR_PX }}
                      aria-label={`Add a task at ${formatTime12(fromMinutes(h * 60))}`}
                    >
                      <span className="w-14 shrink-0 -translate-y-2 pr-2 text-right text-[11px] text-muted-foreground tabular-nums">{formatTime12(fromMinutes(h * 60))}</span>
                      <Plus className="mt-2 ml-2 size-3.5 text-muted-foreground opacity-0 group-hover:opacity-100" />
                    </button>
                  ))}
                  {/* Free slots */}
                  {free.map((f) => (
                    <div
                      key={f.start}
                      className="pointer-events-none absolute right-2 left-16 rounded-md border border-dashed border-emerald-500/40 bg-emerald-500/[0.06]"
                      style={{ top: ((f.start - firstHour * 60) / 60) * HOUR_PX + 1, height: ((f.end - f.start) / 60) * HOUR_PX - 2 }}
                    >
                      <span className="absolute top-1 right-2 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">Free · {formatMinutes(f.end - f.start)}</span>
                    </div>
                  ))}
                  {/* Items */}
                  {positioned.map((p) => {
                    const color = p.item.subject?.color ?? p.item.category?.color ?? "#64748b";
                    const top = ((p.start - firstHour * 60) / 60) * HOUR_PX;
                    const height = Math.max(22, ((p.end - p.start) / 60) * HOUR_PX - 2);
                    return (
                      <button
                        key={p.item.id}
                        onClick={() => openTask({ item: p.item })}
                        className={cn("absolute overflow-hidden rounded-md border-l-[3px] px-2 py-1 text-left text-xs shadow-xs transition hover:shadow-md", p.item.completed && "opacity-50 line-through")}
                        style={{
                          top: top + 1,
                          height,
                          left: `calc(4rem + (100% - 4.5rem) * ${p.col / p.cols})`,
                          width: `calc((100% - 4.5rem) / ${p.cols} - 2px)`,
                          borderLeftColor: color,
                          background: `color-mix(in oklab, ${color} 16%, var(--card))`,
                        }}
                      >
                        <div className="truncate font-medium">{p.item.title}</div>
                        {height > 34 && (
                          <div className="truncate text-[11px] text-muted-foreground">
                            {formatTime12(p.item.startTime!)}
                            {p.item.endTime ? ` – ${formatTime12(p.item.endTime)}` : ""}
                            {p.item.location ? ` · ${p.item.location}` : ""}
                          </div>
                        )}
                      </button>
                    );
                  })}
                  {isToday && minutes >= firstHour * 60 && minutes <= lastHour * 60 && (
                    <div className="pointer-events-none absolute right-0 left-14 flex items-center" style={{ top: nowTop }}>
                      <span className="size-2 -translate-x-1 rounded-full bg-red-500" />
                      <span className="h-px flex-1 bg-red-500" />
                    </div>
                  )}
                </div>
              )}
            </div>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Weather</CardTitle>
              {weather.forecast && <span className="truncate text-xs text-muted-foreground">{weather.forecast.location.label}</span>}
            </CardHeader>
            <CardContent>
              {weather.configured === false ? (
                <p className="text-sm text-muted-foreground">
                  <Link href="/settings?tab=weather" className="font-medium text-primary hover:underline">
                    Set a weather location
                  </Link>{" "}
                  to see the forecast here.
                </p>
              ) : weather.forecast ? (
                <>
                  <WeatherDetail date={date} forecast={weather.forecast} day={forecastDay} hourly={weather.hourlyFor(date)} />
                  <p className="mt-2 text-right text-[10px] text-muted-foreground">{ATTRIBUTION}</p>
                </>
              ) : weather.isLoading ? (
                <Skeleton className="h-24" />
              ) : (
                <p className="text-sm text-muted-foreground">{weather.error ?? "Weather unavailable."}</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Sparkles className="size-4 text-violet-500" /> Recommendations
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {recs.map((r, i) => (
                <div key={i} className={cn("flex items-start gap-2.5 rounded-lg px-3 py-2 text-sm", r.tone === "warn" ? "bg-warning/10" : "bg-muted/50")}>
                  <r.icon className={cn("mt-0.5 size-4 shrink-0", r.tone === "warn" ? "text-amber-600" : "text-violet-500")} />
                  <div className="min-w-0 flex-1">
                    {r.text}
                    {r.action && (
                      <button onClick={r.action.onClick} className="mt-1 block text-xs font-medium text-primary hover:underline">
                        {r.action.label}
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {!isPast && (
                <Button size="sm" variant="outline" onClick={() => openChat(`Look at my schedule for ${formatDateLong(date)} (${date}). Is it realistic? What would you change?`)}>
                  <MessageSquare /> Ask AI about this day
                </Button>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <AlarmClock className="size-4 text-red-500" /> Deadlines
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {deadlines.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing due on this day.</p>
              ) : (
                deadlines.map((t) => (
                  <button key={t.id} onClick={() => openTask({ item: t })} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm hover:bg-accent">
                    <span className="min-w-0 flex-1 truncate font-medium">{t.title}</span>
                    <DeadlineBadge date={t.deadlineDate!} today={today} />
                  </button>
                ))
              )}
            </CardContent>
          </Card>

          {!isPast && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Clock className="size-4 text-emerald-600" /> Available time
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-1.5">
                {free.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No free blocks of 30 min or more within your active hours.</p>
                ) : (
                  free.map((f) => (
                    <button
                      key={f.start}
                      onClick={() => openTask({ defaults: { date, startTime: fromMinutes(f.start), endTime: fromMinutes(Math.min(f.end, f.start + 60)) } })}
                      className="flex items-center justify-between rounded-lg bg-emerald-500/[0.07] px-3 py-2 text-sm hover:bg-emerald-500/15"
                    >
                      <span className="tabular-nums">
                        {formatTime12(fromMinutes(f.start))} – {formatTime12(fromMinutes(f.end))}
                      </span>
                      <span className="text-xs text-muted-foreground">{formatMinutes(f.end - f.start)}</span>
                    </button>
                  ))
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: typeof Clock; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card px-3 py-2.5 shadow-xs">
      <Icon className="size-4 text-muted-foreground" />
      <div>
        <div className="text-base leading-tight font-semibold tabular-nums">{value}</div>
        <div className="text-[11px] text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}
