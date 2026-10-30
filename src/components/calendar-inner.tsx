"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin, { type DateClickArg, type EventResizeDoneArg } from "@fullcalendar/interaction";
import type { DateSelectArg, DatesSetArg, DayCellContentArg, DayHeaderContentArg, EventClickArg, EventDropArg, EventInput } from "@fullcalendar/core";
import { toast } from "sonner";
import { useCategories, useOpenTasks, useRange, useTaskActions } from "@/hooks/use-planner";
import { fromMinutes, toMinutes } from "@/lib/dates";
import type { ScheduleItem } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useWeather } from "@/hooks/use-weather";
import { formatDateShort } from "@/lib/dates";
import { weatherLabel } from "@/lib/weather-codes";
import { usePlannerUI } from "./planner-ui";
import { ViewSwitcher } from "./view-switcher";
import { WeatherIcon } from "./weather/weather-icon";

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function CalendarInner({ initialDate }: { initialDate?: string }) {
  const router = useRouter();
  const weather = useWeather();
  const [range, setRange] = useState<{ start: string; end: string } | null>(null);
  const { data: items = [] } = useRange(range?.start ?? "2000-01-01", range?.end ?? "2000-01-01", Boolean(range));
  const { data: open = [] } = useOpenTasks();
  const { data: categories = [] } = useCategories();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const { update } = useTaskActions();
  const { openTask } = usePlannerUI();
  const isMobile = typeof window !== "undefined" && window.innerWidth < 640;

  const events = useMemo<EventInput[]>(() => {
    const visible = (i: ScheduleItem) => !hidden.has(i.categoryId ?? "none");
    const evs: EventInput[] = items.filter(visible).map((i) => {
      const color = i.subject?.color ?? i.category?.color ?? "#64748b";
      const timed = Boolean(i.startTime);
      return {
        id: i.id,
        title: i.title,
        start: timed ? `${i.date}T${i.startTime}` : i.date!,
        end: timed && i.endTime ? `${i.date}T${i.endTime}` : undefined,
        allDay: !timed,
        backgroundColor: i.kind === "CLASS" ? `${color}cc` : color,
        borderColor: color,
        textColor: "#fff",
        classNames: cn(i.completed && "is-done"),
        extendedProps: { item: i },
        durationEditable: timed,
      };
    });
    // Deadlines appear as separate markers on their due date.
    if (range) {
      for (const t of open) {
        if (!t.deadlineDate || t.deadlineDate < range.start || t.deadlineDate > range.end || !visible(t)) continue;
        evs.push({
          id: `deadline:${t.id}`,
          title: `⏰ Due: ${t.title}`,
          start: t.deadlineTime ? `${t.deadlineDate}T${t.deadlineTime}` : t.deadlineDate,
          allDay: !t.deadlineTime,
          editable: false,
          backgroundColor: "transparent",
          borderColor: "#ef4444",
          textColor: "#ef4444",
          classNames: "deadline-marker",
          extendedProps: { item: t, deadline: true },
        });
      }
    }
    return evs;
  }, [items, open, hidden, range]);

  const onDatesSet = (arg: DatesSetArg) => {
    const start = ymd(arg.start);
    const end = ymd(new Date(arg.end.getTime() - 1));
    setRange((r) => (r?.start === start && r?.end === end ? r : { start, end }));
  };

  const changesFromEvent = (e: EventDropArg["event"], item: ScheduleItem) => {
    const start = e.start!;
    const date = ymd(start);
    if (e.allDay) return { date, startTime: null, endTime: null };
    const startTime = hm(start);
    let endTime: string;
    if (e.end) endTime = ymd(e.end) === date ? hm(e.end) : "23:59";
    else {
      const dur = item.startTime && item.endTime ? toMinutes(item.endTime) - toMinutes(item.startTime) : (item.estimatedMinutes ?? 60);
      endTime = fromMinutes(Math.min(toMinutes(startTime) + dur, 23 * 60 + 59));
    }
    return { date, startTime, endTime };
  };

  const onDrop = (arg: EventDropArg) => {
    const item = arg.event.extendedProps.item as ScheduleItem;
    if (arg.event.extendedProps.deadline) return arg.revert();
    update.mutate({ item, changes: changesFromEvent(arg.event, item) });
  };

  const onResize = (arg: EventResizeDoneArg) => {
    const item = arg.event.extendedProps.item as ScheduleItem;
    const c = changesFromEvent(arg.event, item);
    if (c.startTime && c.endTime && toMinutes(c.endTime) <= toMinutes(c.startTime)) {
      arg.revert();
      return toast.error("Events can't end before they start");
    }
    update.mutate({ item, changes: c });
  };

  const onDateClick = (arg: DateClickArg) => {
    const date = ymd(arg.date);
    // Month view: open the day's detailed schedule. Time views: add a task at the tapped time.
    if (arg.view.type === "dayGridMonth") router.push(`/day?date=${date}`);
    else if (arg.allDay) openTask({ defaults: { date } });
    else {
      const startTime = hm(arg.date);
      openTask({ defaults: { date, startTime, endTime: fromMinutes(Math.min(toMinutes(startTime) + 60, 23 * 60 + 59)) } });
    }
  };

  const onSelect = (arg: DateSelectArg) => {
    // Plain taps are handled by dateClick; only react to dragged ranges in time views.
    if (arg.allDay) return;
    const mins = (arg.end.getTime() - arg.start.getTime()) / 60000;
    if (mins <= 30) return;
    const date = ymd(arg.start);
    openTask({ defaults: { date, startTime: hm(arg.start), endTime: ymd(arg.end) === date ? hm(arg.end) : "23:59" } });
  };

  const onEventClick = (arg: EventClickArg) => {
    arg.jsEvent.preventDefault();
    openTask({ item: arg.event.extendedProps.item as ScheduleItem });
  };

  // Weather where the provider has a forecast; nothing is shown (or guessed) for later dates.
  const weatherTitle = (date: string) => {
    const w = weather.byDate.get(date);
    if (w) return `${weatherLabel(w.code)} · High ${w.tMax}° · Low ${w.tMin}°${w.precipProb !== null ? ` · ${w.precipProb}% precipitation` : ""}`;
    return weather.forecast && weather.lastDate && date > weather.lastDate ? "Forecast unavailable" : undefined;
  };
  const dayCell = (arg: DayCellContentArg) => {
    const date = ymd(arg.date);
    const w = weather.byDate.get(date);
    return (
      <span className="flex items-center gap-1.5" title={weatherTitle(date)}>
        {w && (
          <span className="flex items-center gap-0.5 text-[10px] font-normal text-muted-foreground tabular-nums">
            <WeatherIcon code={w.code} className="size-3.5" />
            {w.tMax}°
          </span>
        )}
        <span>{arg.dayNumberText}</span>
      </span>
    );
  };
  const dayHeader = (arg: DayHeaderContentArg) => {
    const date = ymd(arg.date);
    const w = arg.view.type.startsWith("timeGrid") ? weather.byDate.get(date) : undefined;
    return (
      <span className="inline-flex items-center gap-1.5" title={arg.view.type.startsWith("timeGrid") ? weatherTitle(date) : undefined}>
        {arg.text}
        {w && (
          <span className="inline-flex items-center gap-0.5 text-[10px] font-normal text-muted-foreground tabular-nums">
            <WeatherIcon code={w.code} className="size-3.5" />
            {w.tMax}°/{w.tMin}°
          </span>
        )}
      </span>
    );
  };

  const toggle = (id: string) =>
    setHidden((h) => {
      const n = new Set(h);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-2xl font-semibold tracking-tight">Monthly calendar</h1>
        <ViewSwitcher />
        <div className="flex flex-wrap gap-1.5">
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => toggle(c.id)}
              className={cn("flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition", hidden.has(c.id) ? "opacity-40" : "bg-card shadow-xs")}
              aria-pressed={!hidden.has(c.id)}
            >
              <span className="size-2 rounded-full" style={{ background: c.color }} />
              {c.name}
            </button>
          ))}
        </div>
      </div>
      <div className="rounded-2xl border bg-card p-2 shadow-sm sm:p-4">
        <FullCalendar
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          initialDate={initialDate}
          headerToolbar={isMobile ? { left: "prev,next", center: "title", right: "today" } : { left: "prev,next today", center: "title", right: "dayGridMonth,timeGridWeek,timeGridDay,listWeek" }}
          footerToolbar={isMobile ? { center: "dayGridMonth,timeGridWeek,timeGridDay,listWeek" } : undefined}
          buttonText={{ today: "Today", month: "Month", week: "Week", day: "Day", list: "Agenda" }}
          firstDay={1}
          height={isMobile ? "auto" : "calc(100dvh - 12rem)"}
          events={events}
          editable
          eventStartEditable
          eventDurationEditable
          selectable
          selectMirror
          dayMaxEvents={isMobile ? 2 : 4}
          nowIndicator
          scrollTime="07:00:00"
          slotMinTime="05:00:00"
          longPressDelay={300}
          eventLongPressDelay={300}
          snapDuration="00:15:00"
          eventTimeFormat={{ hour: "numeric", minute: "2-digit", meridiem: "short" }}
          datesSet={onDatesSet}
          eventDrop={onDrop}
          eventResize={onResize}
          dateClick={onDateClick}
          select={onSelect}
          eventClick={onEventClick}
          eventDisplay="block"
          dayCellContent={dayCell}
          dayHeaderContent={dayHeader}
        />
      </div>
      <p className="text-center text-xs text-muted-foreground">
        Tap a date for its daily schedule · drag events to move · drag the bottom edge to change duration
        {weather.forecast && weather.lastDate && (
          <>
            <br />
            Weather shown where Open-Meteo has a forecast (through {formatDateShort(weather.lastDate)}); later dates: forecast unavailable.
          </>
        )}
      </p>
    </div>
  );
}
