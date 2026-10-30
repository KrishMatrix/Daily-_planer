"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/utils";
import type { DailyWeather, Forecast, HourlyWeather, WeatherResponse } from "@/lib/weather-codes";

export const weatherKey = ["weather"] as const;

/** The saved location's forecast. Server-cached for 30 min; refreshed here every 30 min while open. */
export function useWeather() {
  const q = useQuery({
    queryKey: weatherKey,
    queryFn: () => api<WeatherResponse>("/api/weather"),
    staleTime: 15 * 60_000,
    refetchInterval: 30 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  const forecast: Forecast | null = q.data && q.data.configured && !("error" in q.data) ? q.data : null;
  const byDate = useMemo(() => new Map<string, DailyWeather>((forecast?.daily ?? []).map((d) => [d.date, d])), [forecast]);
  const hourlyFor = useMemo(() => {
    const map = new Map<string, HourlyWeather[]>();
    for (const h of forecast?.hourly ?? []) {
      const list = map.get(h.date) ?? [];
      list.push(h);
      map.set(h.date, list);
    }
    return (date: string) => map.get(date) ?? [];
  }, [forecast]);
  return {
    ...q,
    configured: q.data ? q.data.configured : undefined,
    error: q.data && q.data.configured && "error" in q.data ? q.data.error : q.error ? (q.error as Error).message : null,
    forecast,
    byDate,
    hourlyFor,
    /** Last date the provider returned a forecast for. Later dates have no forecast. */
    lastDate: forecast?.daily.at(-1)?.date ?? null,
  };
}
