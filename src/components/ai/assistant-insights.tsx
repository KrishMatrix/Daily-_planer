"use client";

import { useMemo, useState } from "react";
import { AlarmClock, AlertTriangle, ChevronDown, CloudRain, Sun } from "lucide-react";
import { useOpenTasks, useRange } from "@/hooks/use-planner";
import { useToday } from "@/hooks/use-today";
import { useWeather } from "@/hooks/use-weather";
import { addDays, formatTime12, WEEKDAYS, weekdayOf } from "@/lib/dates";
import { detectConflicts } from "@/lib/scheduler";
import { goodOutdoorWindows, weatherWarningFor } from "@/lib/weather-advice";
import { cn } from "@/lib/utils";
import { useChat } from "./chat-panel";

type Alert = { key: string; icon: typeof AlertTriangle; tone: "warn" | "info"; text: string; ask: string };

/**
 * Conflict alerts and recommendations for the next 7 days, computed in the browser from
 * data already loaded (no AI call). "Ask AI" sends a focused question only when tapped.
 */
export function AssistantInsights({ compact }: { compact?: boolean }) {
  const { today, minutes } = useToday();
  const { data: items = [] } = useRange(today, addDays(today, 6));
  const { data: open = [] } = useOpenTasks();
  const weather = useWeather();
  const { send, busy } = useChat();
  const [expanded, setExpanded] = useState(false);

  const alerts = useMemo(() => {
    const out: Alert[] = [];
    const timed = items
      .filter((i) => i.date && i.startTime && i.endTime && !i.completed)
      .map((i) => ({ id: i.id, title: i.title, date: i.date!, startTime: i.startTime!, endTime: i.endTime!, kind: i.kind, completed: false }));
    for (const c of detectConflicts(timed).slice(0, 3)) {
      const day = c.date === today ? "today" : WEEKDAYS[weekdayOf(c.date)];
      out.push({
        key: `c-${c.a.id}-${c.b.id}`,
        icon: AlertTriangle,
        tone: "warn",
        text: `"${c.a.title}" overlaps "${c.b.title}" ${day} at ${formatTime12(c.b.startTime)}.`,
        ask: `On ${c.date}, "${c.a.title}" (${c.a.startTime}–${c.a.endTime}) overlaps "${c.b.title}" (${c.b.startTime}–${c.b.endTime}). How should I resolve it?`,
      });
    }
    const overdue = open.filter((t) => t.deadlineDate && t.deadlineDate < today);
    if (overdue.length)
      out.push({
        key: "overdue",
        icon: AlarmClock,
        tone: "warn",
        text: `${overdue.length} task${overdue.length > 1 ? "s are" : " is"} past the deadline.`,
        ask: "Which of my tasks are overdue, and when should I do them? Propose new times.",
      });
    const due = open.filter((t) => t.deadlineDate && t.deadlineDate >= today && t.deadlineDate <= addDays(today, 2));
    if (due.length)
      out.push({
        key: "due",
        icon: AlarmClock,
        tone: "info",
        text: `${due.length} deadline${due.length > 1 ? "s" : ""} in the next 48 hours${due.some((t) => !t.date) ? " (some not scheduled yet)" : ""}.`,
        ask: "Which assignments and tasks are urgent? Help me schedule the ones due in the next 48 hours.",
      });
    if (weather.forecast) {
      for (const i of items) {
        const w = weatherWarningFor(i, weather.forecast);
        if (w && (w.date > today || (w.date === today && Number(w.startTime.slice(0, 2)) * 60 >= minutes)))
          out.push({ key: `w-${i.id}`, icon: CloudRain, tone: "info", text: w.message, ask: `${w.message} Would it be better to move it or do it indoors? Use the weather forecast.` });
      }
      const dry = goodOutdoorWindows(weather.forecast, today, 7, minutes)[0];
      if (dry && !items.some((i) => i.outdoor && i.date && i.date >= today))
        out.push({ key: "dry", icon: Sun, tone: "info", text: `${dry.message} Good for an outdoor activity.`, ask: `${dry.message} Can I fit an outdoor workout in then without clashing with anything?` });
    }
    return out;
  }, [items, open, weather.forecast, today, minutes]);

  if (!alerts.length) return null;
  const warn = alerts.filter((a) => a.tone === "warn").length;
  const shown = compact && !expanded ? [] : alerts;

  return (
    <section className="rounded-xl border bg-card/80 text-sm shadow-xs" aria-label="Conflict alerts and recommendations">
      <button onClick={() => setExpanded((v) => !v)} className={cn("flex w-full items-center gap-2 px-3 py-2 text-left", !compact && "pointer-events-none")} disabled={!compact}>
        <span className={cn("size-2 rounded-full", warn ? "bg-amber-500" : "bg-violet-500")} />
        <span className="flex-1 text-xs font-semibold">
          {warn ? `${warn} alert${warn > 1 ? "s" : ""}` : "Recommendations"}
          {alerts.length - warn > 0 && warn ? ` · ${alerts.length - warn} tip${alerts.length - warn > 1 ? "s" : ""}` : ""}
        </span>
        {compact && <ChevronDown className={cn("size-3.5 text-muted-foreground transition", expanded && "rotate-180")} />}
      </button>
      {shown.length > 0 && (
        <ul className="flex flex-col gap-1.5 px-2 pb-2">
          {shown.map((a) => (
            <li key={a.key} className={cn("flex items-start gap-2 rounded-lg px-2.5 py-2", a.tone === "warn" ? "bg-warning/10" : "bg-muted/60")}>
              <a.icon className={cn("mt-0.5 size-3.5 shrink-0", a.tone === "warn" ? "text-amber-600" : "text-violet-500")} />
              <div className="min-w-0 flex-1 text-xs leading-relaxed">
                {a.text}
                <button onClick={() => send(a.ask)} disabled={busy} className="ml-1 font-medium text-primary hover:underline disabled:opacity-50">
                  Ask AI
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
