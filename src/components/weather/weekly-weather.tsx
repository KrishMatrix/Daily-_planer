"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CloudOff, Droplets, MapPin, Settings2, Sunrise, Sunset, Umbrella, Wind } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { useToday } from "@/hooks/use-today";
import { useWeather } from "@/hooks/use-weather";
import { formatDateLong, formatTime12, parseDate, WEEKDAYS_SHORT, weekdayOf } from "@/lib/dates";
import { tempUnit, weatherLabel, windUnit, type DailyWeather, type Forecast, type HourlyWeather } from "@/lib/weather-codes";
import { cn } from "@/lib/utils";
import { LocationPicker } from "./location-picker";
import { WeatherIcon } from "./weather-icon";

export const ATTRIBUTION = (
  <a href="https://open-meteo.com/" target="_blank" rel="noreferrer" className="hover:underline">
    Weather data by Open-Meteo.com
  </a>
);

/** Seven clickable forecast cards for a week, with a detail panel for the selected day. */
export function WeeklyWeather({ days, defaultOpen = false }: { days: string[]; defaultOpen?: boolean }) {
  const { today } = useToday();
  const w = useWeather();
  // Details open when a day is clicked; clicking the same day again collapses them.
  const [selected, setSelected] = useState<string | null>(defaultOpen ? today : null);
  const sel = selected && days.includes(selected) ? selected : null;
  const strip = useRef<HTMLDivElement>(null);
  // On phones the strip scrolls sideways — start at today rather than Monday.
  useEffect(() => {
    const el = strip.current?.querySelector<HTMLElement>(`[data-day="${today}"]`);
    if (el && strip.current && strip.current.scrollWidth > strip.current.clientWidth) strip.current.scrollLeft = el.offsetLeft - strip.current.offsetLeft - 12;
  }, [today, days, w.isLoading]);

  if (w.isLoading) return <Skeleton className="h-28 rounded-2xl" />;
  if (w.configured === false) return <SetupCard />;

  return (
    <section className="flex flex-col gap-3 rounded-2xl border bg-card p-3 shadow-xs sm:p-4" aria-label="Weekly weather forecast">
      <div className="flex items-center gap-2 text-sm">
        <MapPin className="size-4 text-muted-foreground" />
        <span className="min-w-0 truncate font-medium">{w.forecast?.location.label ?? "Weather"}</span>
        {w.forecast?.stale && <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] text-amber-700 dark:text-warning">Showing last saved forecast</span>}
        <div className="flex-1" />
        <span className="hidden text-[11px] text-muted-foreground sm:inline">Tap a day for hourly details</span>
        <LocationButton />
      </div>
      {w.error && !w.forecast ? (
        <div className="flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-3 text-sm text-muted-foreground">
          <CloudOff className="size-4" /> {w.error} Your planner works normally — weather will reappear when the service is back.
        </div>
      ) : (
        <>
          <div ref={strip} className="-mx-3 flex snap-x gap-2 overflow-x-auto px-3 pb-1 sm:mx-0 sm:grid sm:grid-cols-7 sm:overflow-visible sm:px-0">
            {days.map((d) => (
              <DayCard key={d} date={d} day={w.byDate.get(d)} unit={w.forecast?.unit ?? "celsius"} today={today} active={d === sel} onClick={() => setSelected(d === sel ? null : d)} />
            ))}
          </div>
          {w.forecast && sel && (
            <div className="animate-in duration-200 fade-in-0 slide-in-from-top-1">
              <WeatherDetail date={sel} forecast={w.forecast} day={w.byDate.get(sel)} hourly={w.hourlyFor(sel)} />
            </div>
          )}
          <p className="text-right text-[10px] text-muted-foreground">{ATTRIBUTION}</p>
        </>
      )}
    </section>
  );
}

function DayCard({ date, day, unit, today, active, onClick }: { date: string; day?: DailyWeather; unit: Forecast["unit"]; today: string; active: boolean; onClick: () => void }) {
  const isToday = date === today;
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      data-day={date}
      className={cn(
        "flex w-28 shrink-0 snap-start flex-col items-center gap-1 rounded-xl border px-2 py-2.5 text-center transition hover:border-primary/40 hover:bg-accent/60 sm:w-auto",
        isToday && "border-primary/30",
        active && "border-primary/50 bg-primary/[0.06] ring-1 ring-primary/30",
        date < today && "opacity-70",
      )}
    >
      <span className={cn("text-xs font-semibold", isToday && "text-primary")}>
        {isToday ? "Today" : WEEKDAYS_SHORT[weekdayOf(date)]} <span className="font-normal text-muted-foreground tabular-nums">{Number(date.slice(8))}</span>
      </span>
      {day ? (
        <>
          <WeatherIcon code={day.code} className="my-0.5 size-7" />
          <span className="text-lg leading-none font-semibold tabular-nums">{day.tMax}°</span>
          <span className="line-clamp-1 text-[11px] text-muted-foreground">{weatherLabel(day.code)}</span>
          <span className="text-[11px] text-muted-foreground tabular-nums">
            H {day.tMax}° · L {day.tMin}°{unit === "fahrenheit" ? "F" : ""}
          </span>
        </>
      ) : (
        <span className="flex min-h-[4.75rem] items-center px-1 text-[11px] leading-tight text-muted-foreground">Forecast unavailable</span>
      )}
    </button>
  );
}

/** Detailed weather for one date: summary, hourly strip, sunrise/sunset. */
export function WeatherDetail({ date, forecast, day, hourly }: { date: string; forecast: Forecast; day?: DailyWeather; hourly: HourlyWeather[] }) {
  const { today, minutes } = useToday();
  const scroller = useRef<HTMLDivElement>(null);
  const tu = tempUnit(forecast.unit);
  const nowHour = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:00`;
  const hours = useMemo(() => (date === today ? hourly.filter((h) => h.time >= nowHour) : hourly.filter((h) => h.time >= "06:00")), [hourly, date, today, nowHour]);

  useEffect(() => {
    scroller.current?.scrollTo({ left: 0 });
  }, [date]);

  if (!day) {
    return (
      <div className="rounded-xl bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{formatDateLong(date)}</span> — Forecast unavailable. Open-Meteo forecasts reach about 16 days ahead.
      </div>
    );
  }
  const current = date === today ? forecast.current : null;
  return (
    <div className="flex flex-col gap-3 rounded-xl bg-muted/40 p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <div className="flex items-center gap-3">
          <WeatherIcon code={current?.code ?? day.code} isDay={current?.isDay ?? true} className="size-10" />
          <div>
            <div className="text-xs text-muted-foreground">{formatDateLong(date)}</div>
            <div className="text-base font-semibold">
              {current ? `${current.temp}${tu} now · ` : ""}
              {weatherLabel(current?.code ?? day.code, current?.isDay ?? true)}
            </div>
            <div className="text-xs text-muted-foreground tabular-nums">
              High {day.tMax}
              {tu} · Low {day.tMin}
              {tu}
              {current?.apparent !== undefined && current?.apparent !== null ? ` · Feels like ${current.apparent}${tu}` : ""}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {day.precipProb !== null && (
            <span className="flex items-center gap-1">
              <Umbrella className="size-3.5" /> {day.precipProb}% chance of precipitation
            </span>
          )}
          {day.precipSum !== null && day.precipSum > 0 && (
            <span className="flex items-center gap-1">
              <Droplets className="size-3.5" /> {day.precipSum.toFixed(1)} {forecast.unit === "fahrenheit" ? "in" : "mm"}
            </span>
          )}
          {day.windMax !== null && (
            <span className="flex items-center gap-1">
              <Wind className="size-3.5" /> up to {Math.round(day.windMax)} {windUnit(forecast.unit)}
            </span>
          )}
          {day.sunrise && (
            <span className="flex items-center gap-1">
              <Sunrise className="size-3.5" /> {formatTime12(day.sunrise)}
            </span>
          )}
          {day.sunset && (
            <span className="flex items-center gap-1">
              <Sunset className="size-3.5" /> {formatTime12(day.sunset)}
            </span>
          )}
          {day.uvMax !== null && <span>UV {Math.round(day.uvMax)}</span>}
        </div>
      </div>
      {hours.length > 0 ? (
        <div ref={scroller} className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" aria-label="Hourly forecast">
          {hours.map((h) => (
            <div key={h.time} className="flex w-14 shrink-0 flex-col items-center gap-1 rounded-lg bg-card px-1 py-2 text-center ring-1 ring-border/60">
              <span className="text-[10px] text-muted-foreground tabular-nums">{formatTime12(h.time).replace(":00", "")}</span>
              <WeatherIcon code={h.code} isDay={h.isDay} className="size-4.5" />
              <span className="text-xs font-semibold tabular-nums">{h.temp}°</span>
              <span className={cn("text-[10px] tabular-nums", (h.precipProb ?? 0) >= 50 ? "font-medium text-sky-600 dark:text-sky-400" : "text-muted-foreground")}>
                {h.precipProb !== null ? `${h.precipProb}%` : "—"}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Hourly forecast unavailable for this day.</p>
      )}
    </div>
  );
}

/** Compact icon + high/low for column headers and calendar cells. Renders nothing when there's no data. */
export function DayWeatherChip({ date, className }: { date: string; className?: string }) {
  const w = useWeather();
  const day = w.byDate.get(date);
  if (!day) return null;
  return (
    <span className={cn("inline-flex items-center gap-1 text-[11px] text-muted-foreground tabular-nums", className)} title={`${weatherLabel(day.code)} · High ${day.tMax}° · Low ${day.tMin}°${day.precipProb !== null ? ` · ${day.precipProb}% precipitation` : ""}`}>
      <WeatherIcon code={day.code} className="size-3.5" />
      {day.tMax}°<span className="opacity-60">/{day.tMin}°</span>
    </span>
  );
}

function LocationButton() {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="xs" variant="ghost" aria-label="Change weather location">
          <Settings2 /> Change
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-3">
        <div className="mb-2 text-sm font-semibold">Weather location</div>
        <LocationPicker onSaved={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}

function SetupCard() {
  return (
    <section className="grid gap-4 rounded-2xl border border-dashed bg-card/60 p-4 sm:grid-cols-[1fr_minmax(0,22rem)] sm:items-start">
      <div>
        <div className="flex items-center gap-2 text-sm font-semibold">
          <WeatherIcon code={2} className="size-5" /> Add the weather to your planner
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose a city to see a 7-day forecast here, weather in your calendar, and rain warnings for outdoor plans. No GPS needed.
        </p>
        <p className="mt-2 text-[11px] text-muted-foreground">{ATTRIBUTION} · free, no account required</p>
      </div>
      <LocationPicker compact />
    </section>
  );
}

export function dayLabel(date: string) {
  return parseDate(date).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
}
