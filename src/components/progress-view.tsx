"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlarmClock, AlertTriangle, BarChart3, CheckCircle2, ListTodo, Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateShort, WEEKDAYS_SHORT } from "@/lib/dates";
import type { Stats } from "@/lib/stats";
import { api, formatMinutes } from "@/lib/utils";

const axis = { stroke: "var(--muted-foreground)", fontSize: 11, tickLine: false, axisLine: false } as const;

function ChartTooltip({ active, payload, label, unit }: { active?: boolean; payload?: { name: string; value: number; color: string; payload: Record<string, unknown> }[]; label?: string; unit?: "min" | "tasks" }) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((p) => p.value);
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 font-medium">{label}</div>
      {rows.map((p) => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="size-2 rounded-sm" style={{ background: p.color }} />
          <span className="text-muted-foreground">{p.name}</span>
          <span className="ml-auto pl-3 font-medium tabular-nums">{unit === "min" ? formatMinutes(p.value) : p.value}</span>
        </div>
      ))}
      {unit === "tasks" && typeof payload[0].payload.total === "number" && <div className="mt-1 text-muted-foreground">of {String(payload[0].payload.total)} planned</div>}
    </div>
  );
}

export function ProgressView() {
  const { data: stats, isLoading } = useQuery({ queryKey: ["stats"], queryFn: () => api<{ stats: Stats }>("/api/stats").then((r) => r.stats) });
  const [table, setTable] = useState(false);

  if (isLoading || !stats)
    return (
      <div className="mx-auto grid max-w-6xl gap-4">
        <Skeleton className="h-24" />
        <Skeleton className="h-72" />
      </div>
    );

  const total = stats.completedThisWeek + stats.remainingThisWeek;
  const categories = Object.keys(stats.categoryColors).filter((c) => stats.days.some((d) => d.minutesByCategory[c]));
  if (stats.days.some((d) => d.minutesByCategory["Uncategorised"])) categories.push("Uncategorised");
  const colorOf = (c: string) => stats.categoryColors[c] ?? "#94a3b8";
  const workload = stats.days.map((d, i) => ({ day: WEEKDAYS_SHORT[i], date: d.date, ...d.minutesByCategory }));
  const trend = stats.trend.map((w) => ({ week: formatDateShort(w.weekStart).replace(/^\w+, /, ""), completed: w.completed, total: w.total }));

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600">
          <BarChart3 className="size-5" />
        </span>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">Progress</h1>
          <p className="text-sm text-muted-foreground">Week of {formatDateShort(stats.weekStart)} · counts exclude classes, meetings and events</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setTable((t) => !t)}>
          {table ? <BarChart3 /> : <Table2 />} {table ? "Charts" : "Table view"}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={CheckCircle2} label="Completed this week" value={stats.completedThisWeek} />
        <Kpi icon={ListTodo} label="Remaining this week" value={stats.remainingThisWeek} />
        <Kpi icon={AlertTriangle} label="Overdue assignments" value={stats.overdueAssignments.length} warn={stats.overdueAssignments.length > 0} />
        <Kpi icon={AlarmClock} label="Deadlines (14 days)" value={stats.upcomingDeadlines.length} />
      </div>

      <Card>
        <CardContent className="pt-5">
          <div className="mb-2 flex items-baseline justify-between text-sm">
            <span className="font-medium">Weekly completion</span>
            <span className="text-muted-foreground tabular-nums">
              {stats.completedThisWeek} of {total} tasks
            </span>
          </div>
          <Progress value={total ? (stats.completedThisWeek / total) * 100 : 0} className="h-3" indicatorClassName="bg-emerald-500" />
        </CardContent>
      </Card>

      {table ? (
        <Card>
          <CardHeader>
            <CardTitle>Data</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-6 overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="mb-2 text-left text-xs font-medium text-muted-foreground">Scheduled time per day this week</caption>
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-1.5 pr-3 font-medium">Day</th>
                  {categories.map((c) => (
                    <th key={c} className="py-1.5 pr-3 font-medium">{c}</th>
                  ))}
                  <th className="py-1.5 font-medium">Tasks done</th>
                </tr>
              </thead>
              <tbody>
                {stats.days.map((d, i) => (
                  <tr key={d.date} className="border-b last:border-0">
                    <td className="py-1.5 pr-3">{WEEKDAYS_SHORT[i]} {Number(d.date.slice(8))}</td>
                    {categories.map((c) => (
                      <td key={c} className="py-1.5 pr-3 tabular-nums">{d.minutesByCategory[c] ? formatMinutes(d.minutesByCategory[c]) : "–"}</td>
                    ))}
                    <td className="py-1.5 tabular-nums">{d.completed}/{d.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <table className="w-full text-sm">
              <caption className="mb-2 text-left text-xs font-medium text-muted-foreground">Tasks completed per week</caption>
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-1.5 pr-3 font-medium">Week of</th>
                  <th className="py-1.5 pr-3 font-medium">Completed</th>
                  <th className="py-1.5 font-medium">Planned</th>
                </tr>
              </thead>
              <tbody>
                {trend.map((w) => (
                  <tr key={w.week} className="border-b last:border-0">
                    <td className="py-1.5 pr-3">{w.week}</td>
                    <td className="py-1.5 pr-3 tabular-nums">{w.completed}</td>
                    <td className="py-1.5 tabular-nums">{w.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Weekly workload by category</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={workload} margin={{ top: 8, right: 4, left: -16, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--border)" />
                    <XAxis dataKey="day" {...axis} />
                    <YAxis {...axis} tickFormatter={(v: number) => (v >= 60 ? `${Math.round(v / 60)}h` : `${v}m`)} />
                    <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.6 }} content={<ChartTooltip unit="min" />} />
                    {categories.map((c, i) => (
                      <Bar key={c} dataKey={c} name={c} stackId="a" fill={colorOf(c)} maxBarSize={24} stroke="var(--card)" strokeWidth={2} radius={i === categories.length - 1 ? [4, 4, 0, 0] : 0} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {categories.length ? (
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
                  {categories.map((c) => (
                    <span key={c} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="size-2.5 rounded-sm" style={{ background: colorOf(c) }} />
                      {c}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-center text-xs text-muted-foreground">No timed items this week yet.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Tasks completed per week</CardTitle>
              <span className="text-xs text-muted-foreground">last 8 weeks</span>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={trend} margin={{ top: 8, right: 4, left: -16, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--border)" />
                    <XAxis dataKey="week" {...axis} />
                    <YAxis {...axis} allowDecimals={false} />
                    <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.6 }} content={<ChartTooltip unit="tasks" />} />
                    <Bar dataKey="completed" name="Completed" fill="#10b981" maxBarSize={24} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <ListCard title="Overdue" empty="Nothing overdue. Nice." items={stats.overdue} danger />
        <ListCard title="Upcoming deadlines" empty="No deadlines in the next two weeks." items={stats.upcomingDeadlines} />
      </div>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, warn }: { icon: typeof CheckCircle2; label: string; value: number; warn?: boolean }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className={warn ? "size-3.5 text-destructive" : "size-3.5"} /> {label}
      </div>
      <div className="mt-1 text-3xl font-semibold tabular-nums">{value}</div>
    </Card>
  );
}

function ListCard({ title, items, empty, danger }: { title: string; items: Stats["overdue"]; empty: string; danger?: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <span className="text-xs text-muted-foreground tabular-nums">{items.length}</span>
      </CardHeader>
      <CardContent className="flex flex-col gap-1.5">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{empty}</p>
        ) : (
          items.slice(0, 10).map((t) => (
            <div key={t.id} className="flex items-center gap-2 text-sm">
              <span className="size-2 shrink-0 rounded-full" style={{ background: t.color ?? "#94a3b8" }} />
              <span className="min-w-0 flex-1 truncate">{t.title}</span>
              <span className={danger ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>{t.deadlineDate ? formatDateShort(t.deadlineDate) : t.date ? formatDateShort(t.date) : ""}</span>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
