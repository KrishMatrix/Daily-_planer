"use client";

import { useMemo } from "react";
import { CheckCircle2, CloudRain, Dumbbell, Heart, Plus, Repeat, Sparkles, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useCategories, useCategoryTasks, useRange } from "@/hooks/use-planner";
import { useToday } from "@/hooks/use-today";
import { useWeather } from "@/hooks/use-weather";
import { addDays, formatDateShort, startOfWeek } from "@/lib/dates";
import { goodOutdoorWindows, weatherWarningFor } from "@/lib/weather-advice";
import { cn } from "@/lib/utils";
import { usePlannerUI } from "./planner-ui";
import { TaskCard } from "./task-card";

const CONFIG = {
  gym: {
    title: "Gym",
    subtitle: "Workouts, runs and training",
    icon: Dumbbell,
    tone: "bg-orange-500/10 text-orange-500",
    addLabel: "Add workout",
    ask: "Find time for three 1-hour workouts this week that don't clash with classes or work. Use the weather for anything outdoors.",
    askLabel: "Plan my workouts this week",
  },
  personal: {
    title: "Personal",
    subtitle: "Appointments, errands and time for yourself",
    icon: Heart,
    tone: "bg-emerald-500/10 text-emerald-500",
    addLabel: "Add personal task",
    ask: "Look at my personal tasks and appointments. What should I fit in this week, and when?",
    askLabel: "Fit my personal tasks in",
  },
} as const;

/** A focused view of one built-in category (Gym, Personal) using the same shared task data. */
export function CategoryView({ categoryKey }: { categoryKey: keyof typeof CONFIG }) {
  const cfg = CONFIG[categoryKey];
  const { today, minutes } = useToday();
  const { data: categories = [] } = useCategories();
  const category = categories.find((c) => c.key === categoryKey);
  const ws = startOfWeek(today);
  const { data: range = [], isLoading } = useRange(ws, addDays(today, 13));
  const { data: oneOffs = [] } = useCategoryTasks(categoryKey);
  const weather = useWeather();
  const { openTask, openChat } = usePlannerUI();

  const inCat = useMemo(() => range.filter((i) => i.category?.key === categoryKey), [range, categoryKey]);
  const thisWeek = inCat.filter((i) => i.date! <= addDays(ws, 6));
  const done = thisWeek.filter((i) => i.completed).length;
  const upcoming = inCat.filter((i) => i.date! >= today && !i.completed);
  const unscheduled = oneOffs.filter((t) => !t.completed && !t.date);
  const completed = oneOffs.filter((t) => t.completed).sort((a, b) => ((a.completedAt ?? "") < (b.completedAt ?? "") ? 1 : -1)).slice(0, 8);
  const recurring = useMemo(() => {
    const seen = new Map<string, (typeof inCat)[number]>();
    for (const i of inCat) if (i.recurrence && !seen.has(i.taskId)) seen.set(i.taskId, i);
    return [...seen.values()];
  }, [inCat]);

  const warnings = weather.forecast ? upcoming.map((i) => weatherWarningFor(i, weather.forecast!)).filter((w) => w !== null) : [];
  const dry = weather.forecast ? goodOutdoorWindows(weather.forecast, today, 7, minutes).slice(0, 3) : [];
  const add = (extra: Record<string, unknown> = {}) => openTask({ defaults: { categoryId: category?.id, date: today, ...extra } });

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className={cn("flex size-10 items-center justify-center rounded-xl", cfg.tone)}>
          <cfg.icon className="size-5" />
        </span>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">{cfg.title}</h1>
          <p className="text-sm text-muted-foreground">{cfg.subtitle}</p>
        </div>
        <Button variant="outline" onClick={() => openChat(cfg.ask)}>
          <Sparkles className="text-violet-500" /> {cfg.askLabel}
        </Button>
        <Button onClick={() => add()}>
          <Plus /> {cfg.addLabel}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="This week" value={`${done}/${thisWeek.length} done`} />
        <Stat label="Upcoming (2 weeks)" value={String(upcoming.length)} />
        <Stat label="Repeating" value={String(recurring.length)} />
        <Stat label="Unscheduled" value={String(unscheduled.length)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Upcoming</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {isLoading ? (
              <Skeleton className="h-16" />
            ) : upcoming.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
                <cfg.icon className="size-6 opacity-40" />
                Nothing planned in the next two weeks.
                <Button size="sm" variant="secondary" onClick={() => add()}>
                  <Plus /> {cfg.addLabel}
                </Button>
              </div>
            ) : (
              upcoming.slice(0, 20).map((i) => <TaskCard key={i.id} item={i} today={today} showDate />)
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          {categoryKey === "gym" && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sun className="size-4 text-amber-500" /> Outdoor weather
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 text-sm">
                {weather.configured === false ? (
                  <p className="text-muted-foreground">Set a weather location in Settings to get rain warnings for outdoor workouts.</p>
                ) : !weather.forecast ? (
                  <p className="text-muted-foreground">{weather.error ?? "Loading forecast…"}</p>
                ) : (
                  <>
                    {warnings.map((w) => (
                      <div key={w.itemId} className="flex items-start gap-2 rounded-lg bg-sky-500/[0.08] px-3 py-2">
                        <CloudRain className="mt-0.5 size-4 shrink-0 text-sky-600" />
                        <span>
                          {w.message}
                          <button onClick={() => openChat(`${w.message} Suggest a drier time or an indoor alternative.`)} className="ml-1 text-xs font-medium text-primary hover:underline">
                            Ask AI
                          </button>
                        </span>
                      </div>
                    ))}
                    {dry.length ? (
                      dry.map((d) => (
                        <button
                          key={d.date + d.part}
                          onClick={() => add({ date: d.date, startTime: d.part === "morning" ? "09:00" : d.part === "afternoon" ? "15:00" : "17:30", outdoor: true, title: "Outdoor run" })}
                          className="flex items-center gap-2 rounded-lg bg-emerald-500/[0.07] px-3 py-2 text-left hover:bg-emerald-500/15"
                        >
                          <Sun className="size-4 shrink-0 text-amber-500" />
                          <span className="flex-1">{d.message}</span>
                          <Plus className="size-3.5 text-muted-foreground" />
                        </button>
                      ))
                    ) : (
                      <p className="text-muted-foreground">No dry, mild windows in the forecast this week — indoor sessions look like the safer bet.</p>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {recurring.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Repeat className="size-4" /> Routines
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-1.5 text-sm">
                {recurring.map((r) => (
                  <button key={r.taskId} onClick={() => openTask({ item: r })} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-muted">
                    <span className="size-2 rounded-full" style={{ background: r.category?.color }} />
                    <span className="flex-1 truncate font-medium">{r.title}</span>
                    <span className="text-xs text-muted-foreground">{r.startTime ?? "any time"}</span>
                  </button>
                ))}
              </CardContent>
            </Card>
          )}

          {unscheduled.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Unscheduled</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {unscheduled.map((t) => (
                  <TaskCard key={t.id} item={t} today={today} compact />
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle2 className="size-4 text-emerald-500" /> Recently completed
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1 text-sm">
              {completed.length === 0 ? (
                <p className="text-muted-foreground">Nothing completed yet.</p>
              ) : (
                completed.map((t) => (
                  <div key={t.id} className="flex items-center gap-2 text-muted-foreground">
                    <CheckCircle2 className="size-3.5 text-emerald-500" />
                    <span className="flex-1 truncate">{t.title}</span>
                    {t.date && <span className="text-xs">{formatDateShort(t.date)}</span>}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-card px-3 py-2.5 shadow-xs">
      <div className="text-base font-semibold tabular-nums">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}
