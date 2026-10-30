"use client";

import { useEffect, useState } from "react";
import { nowInTz } from "@/lib/dates";
import { useSettings } from "./use-planner";

/** Today's date and current minute in the user's configured timezone (ticks every 30s). */
export function useToday() {
  const { data: settings } = useSettings();
  const tz = settings?.timezone ?? (typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC");
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  const { date, minutes } = nowInTz(tz, now);
  return { today: date, minutes, now, timezone: tz };
}
