"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowRight, CalendarCheck2, CalendarDays, Clock, Flame, GraduationCap, Plus, Sparkles, Users, ClipboardList, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useOpenTasks, useRange, useSettings } from "@/hooks/use-planner";
import { useToday } from "@/hooks/use-today";
import { addDays, formatDateLong, formatDateShort, formatTime12, fromMinutes, startOfWeek, toMinutes, WEEKDAYS_SHORT } from "@/lib/dates";
import { detectConflicts, findFreeSlots } from "@/lib/scheduler";
import type { ScheduleItem } from "@/lib/types";
import { cn, formatMinutes } from "@/lib/utils";
import { usePlannerUI } from "./planner-ui";
import { DeadlineBadge, TaskCard } from "./task-card";
import { WeeklyWeather } from "./weather/weekly-weather";

function greeting(minutes: number) {
  if (minutes < 5 * 60) return "Good evening";
  if (minutes < 12 * 60) return "Good morning";
  if (minutes < 18 * 60) return "Good afternoon";
  return "Good evening";
}

const toTimedLocal = (items: ScheduleItem[]) =>
  items.filter((i) => i.date && i.startTime && i.endTime).map((i) => ({ id: i.id, title: i.title, date: i.date!, startTime: i.startTime!, endTime: i.endTime!, kind: i.kind, completed: i.completed }));

export function Dashboard() {
  const { today, minutes, now, timezone } = useToday();
  const { data: settings } = useSettings();
  const weekStart = startOfWeek(today);
  const { data: range, isLoading } = useRange(weekStart, addDays(today, 6));
  const { data: open = [] } = useOpenTasks();
  const { openTask, openChat, setPlanOpen, setReviewOpen } = usePlannerUI();
  const params = useSearchParams();

  useEffect(() => {
    if (params.get("plan") === "1") setPlanOpen(true);
  }, [params, setPlanOpen]);

  const items = useMemo(() => range ?? [], [range]);
  const todayItems = items.filter((i) => i.date === today);
  const timed = todayItems.filter((i) => i.startTime);
  const untimed = todayItems.filter((i) => !i.startTime);
  const meetings = items.filter((i) => i.kind === "MEETING" && i.date! >= today && !(i.date === today && i.endTime && toMinutes(i.endTime) < minutes)).slice(0, 5);
  const deadlines = open.filter((t) => t.deadlineDate && t.deadlineDate <= addDays(today, 14)).slice(0, 7);
  // Today's priorities: what's scheduled today or overdue, plus anything urgent; most important first.
  const priorities = open
    .filter((t) => t.date === today || (t.date && t.date < today) || (t.deadlineDate && t.deadlineDate <= addDays(today, 1)) || t.priority === "URGENT")
    .sort((a, b) => ({ URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 })[a.priority] - ({ URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 })[b.priority])
    .slice(0, 6);
  const nextClass = items.find((i) => i.kind === "CLASS" && i.startTime && (i.date! > today || (i.date === today && toMinutes(i.startTime) >= minutes)));

  const week = Array.from({ length: 7 }, (_, d) => {
    const date = addDays(weekStart, d);
    const dayTasks = items.filter((i) => i.date === date && i.kind !== "CLASS" && i.kind !== "MEETING" && i.kind !== "EVENT");
    return { date, total: dayTasks.length, done: dayTasks.filter((t) => t.completed).length };
  });
  const weekTotal = week.reduce((s, d) => s + d.total, 0);
  const weekDone = week.reduce((s, d) => s + d.done, 0);

  // Data-driven recommendations (no AI call needed).
  const recs = useMemo(() => {
    const out: { icon: typeof Sparkles; text: string; action?: { label: string; onClick: () => void }; tone?: "warn" }[] = [];
    const overdue = open.filter((t) => (t.deadlineDate && t.deadlineDate < today) || (t.date && t.date < today));
    if (overdue.length)
      out.push({ icon: AlertTriangle, tone: "warn", text: `${overdue.length} task${overdue.length > 1 ? "s are" : " is"} overdue.`, action: { label: "Help me reschedule", onClick: () => openChat("Which tasks am I falling behind on? Propose new times for them.") } });
    const conflicts = detectConflicts(toTimedLocal(todayItems));
    for (const c of conflicts.slice(0, 2)) out.push({ icon: AlertTriangle, tone: "warn", text: `"${c.a.title}" overlaps "${c.b.title}" at ${formatTime12(c.b.startTime)}.`, action: { label: "Fix it", onClick: () => openChat(`Today "${c.a.title}" and "${c.b.title}" overlap. Suggest how to resolve it.`) } });
    if (settings) {
      const free = findFreeSlots({
        windowStart: Math.max(toMinutes(settings.dayStart), Math.ceil(minutes / 15) * 15),
        windowEnd: toMinutes(settings.dayEnd),
        busy: toTimedLocal(todayItems).filter((t) => !t.completed).map((t) => ({ start: toMinutes(t.startTime), end: toMinutes(t.endTime) })),
        buffer: settings.bufferMinutes,
        minDuration: 60,
      });
      const biggest = [...free].sort((a, b) => b.end - b.start - (a.end - a.start))[0];
      if (biggest) out.push({ icon: Clock, text: `Your longest free block today is ${formatMinutes(biggest.end - biggest.start)} from ${formatTime12(fromMinutes(biggest.start))}.`, action: { label: "Use it", onClick: () => setPlanOpen(true) } });
    }
    const dueSoon = open.filter((t) => t.deadlineDate && t.deadlineDate >= today && t.deadlineDate <= addDays(today, 2));
    if (dueSoon.length) out.push({ icon: Flame, text: `${dueSoon.length} deadline${dueSoon.length > 1 ? "s" : ""} in the next 48 hours.`, action: { label: "Plan my day", onClick: () => setPlanOpen(true) } });
    if (!out.length) out.push({ icon: Sparkles, text: "Nothing urgent. A great time to get ahead on next week." });
    return out;
  }, [open, today, todayItems, settings, minutes, openChat, setPlanOpen]);

  const clock = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: timezone });

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="animate-in fade-in slide-in-from-bottom-1 duration-500">
          <p className="text-sm font-medium text-muted-foreground">{formatDateLong(today)}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
            {greeting(minutes)}
            {settings?.name ? `, ${settings.name.split(" ")[0]}` : ""}
          </h1>
          <p className="mt-1 text-3xl font-light tracking-tight text-muted-foreground tabular-nums sm:text-4xl">{clock}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setPlanOpen(true)} className="bg-gradient-to-r from-indigo-500 to-violet-600 text-white hover:opacity-95">
            <Sparkles /> Plan my day
          </Button>
          <Button variant="outline" onClick={() => setReviewOpen(true)}>
            <TrendingUp /> Review my week
          </Button>
          <Button variant="outline" onClick={() => openTask({ defaults: { date: today } })}>
            <Plus /> Quick add
          </Button>
        </div>
      </section>

      <WeeklyWeather days={Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2 lg:row-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarDays className="size-4 text-primary" /> Today&apos;s schedule
            </CardTitle>
            <Link href="/calendar" className="text-xs font-medium text-muted-foreground hover:text-foreground">
              Calendar <ArrowRight className="inline size-3" />
            </Link>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex flex-col gap-2">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-14" />
                ))}
              </div>
            ) : todayItems.length === 0 ? (
              <Empty icon={CalendarCheck2} text="Nothing scheduled today." action={<Button size="sm" variant="secondary" onClick={() => openTask({ defaults: { date: today } })}><Plus /> Add something</Button>} />
            ) : (
              <div className="flex flex-col gap-4">
                {timed.length > 0 && (
                  <ol className="flex flex-col gap-2">
                    {timed.map((i) => {
                      const past = i.endTime ? toMinutes(i.endTime) < minutes : false;
                      const current = i.startTime && i.endTime && toMinutes(i.startTime) <= minutes && toMinutes(i.endTime) > minutes;
                      return (
                        <li key={i.id} className={cn("flex gap-3", past && "opacity-55")}>
                          <div className="w-16 shrink-0 pt-2.5 text-right text-xs font-medium text-muted-foreground tabular-nums">{formatTime12(i.startTime!)}</div>
                          <div className="relative flex-1">
                            {current && <span className="absolute -left-2 top-3 size-2 animate-pulse rounded-full bg-destructive" aria-label="Happening now" />}
                            <TaskCard item={i} today={today} />
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
                {untimed.length > 0 && (
                  <div>
                    <div className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Anytime today</div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {untimed.map((i) => (
                        <TaskCard key={i.id} item={i} today={today} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-violet-200/70 bg-gradient-to-br from-violet-50 to-card dark:border-violet-900/50 dark:from-violet-950/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="size-4 text-violet-500" /> Recommendations
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {recs.map((r, idx) => (
              <div key={idx} className="flex gap-2.5 text-sm">
                <r.icon className={cn("mt-0.5 size-4 shrink-0", r.tone === "warn" ? "text-amber-500" : "text-violet-500")} />
                <div className="flex-1">
                  <p>{r.text}</p>
                  {r.action && (
                    <button onClick={r.action.onClick} className="mt-0.5 text-xs font-medium text-violet-600 hover:underline dark:text-violet-400">
                      {r.action.label} →
                    </button>
                  )}
                </div>
              </div>
            ))}
            <div className="mt-1 flex flex-wrap gap-1.5 border-t pt-3">
              {["What should I do today?", "Find two hours for studying", "Am I overloading my schedule?"].map((q) => (
                <button key={q} onClick={() => openChat(q)} className="rounded-full border bg-card px-2.5 py-1 text-[11px] font-medium hover:bg-accent">
                  {q}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="size-4 text-emerald-500" /> This week
            </CardTitle>
            <span className="text-xs text-muted-foreground tabular-nums">
              {weekDone}/{weekTotal} done
            </span>
          </CardHeader>
          <CardContent>
            <Progress value={weekTotal ? (weekDone / weekTotal) * 100 : 0} indicatorClassName="bg-emerald-500" />
            <div className="mt-4 grid grid-cols-7 gap-1.5">
              {week.map((d, i) => (
                <Link href="/week" key={d.date} className="flex flex-col items-center gap-1">
                  <div className="flex h-16 w-full items-end overflow-hidden rounded-md bg-muted">
                    <div className="w-full rounded-md bg-emerald-500/80 transition-all" style={{ height: d.total ? `${Math.max(8, (d.done / d.total) * 100)}%` : "0%" }} />
                  </div>
                  <span className={cn("text-[10px] font-medium text-muted-foreground", d.date === today && "text-primary")}>{WEEKDAYS_SHORT[i]}</span>
                  <span className="text-[10px] text-muted-foreground tabular-nums">{d.total ? `${d.done}/${d.total}` : "–"}</span>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="size-4 text-purple-500" /> Upcoming meetings
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {nextClass && (
              <div className="flex items-center gap-2 rounded-lg bg-indigo-500/10 px-3 py-2 text-sm">
                <GraduationCap className="size-4 text-indigo-500" />
                <span className="flex-1 truncate">
                  Next class: <span className="font-medium">{nextClass.title}</span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {nextClass.date === today ? "Today" : formatDateShort(nextClass.date!)} {formatTime12(nextClass.startTime!)}
                </span>
              </div>
            )}
            {meetings.length ? meetings.map((m) => <TaskCard key={m.id} item={m} today={today} showDate compact />) : <Empty icon={Users} text="No meetings in the next 7 days." />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ClipboardList className="size-4 text-indigo-500" /> Upcoming deadlines
            </CardTitle>
            <Link href="/tasks" className="text-xs font-medium text-muted-foreground hover:text-foreground">
              All <ArrowRight className="inline size-3" />
            </Link>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {deadlines.length ? (
              deadlines.map((a) => (
                <button key={a.id} onClick={() => openTask({ item: a })} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted">
                  <span className="size-2 shrink-0 rounded-full" style={{ background: a.subject?.color ?? a.category?.color ?? "#6366f1" }} />
                  <span className="min-w-0 flex-1 truncate font-medium">{a.title}</span>
                  {a.deadlineDate && <DeadlineBadge date={a.deadlineDate} today={today} />}
                </button>
              ))
            ) : (
              <Empty icon={ClipboardList} text="No deadlines in the next two weeks." />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Flame className="size-4 text-orange-500" /> Today&apos;s priorities
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {priorities.length ? priorities.map((t) => <TaskCard key={t.id} item={t} today={today} showDate compact />) : <Empty icon={Flame} text="Nothing pressing today." />}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Empty({ icon: Icon, text, action }: { icon: typeof Sparkles; text: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 py-6 text-center text-sm text-muted-foreground">
      <Icon className="size-6 opacity-40" />
      {text}
      {action}
    </div>
  );
}
