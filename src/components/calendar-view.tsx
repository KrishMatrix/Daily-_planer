"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

// FullCalendar touches `window`, so render it on the client only.
export const CalendarView = dynamic(() => import("./calendar-inner").then((m) => m.CalendarInner), {
  ssr: false,
  loading: () => <Skeleton className="mx-auto h-[70dvh] max-w-7xl rounded-2xl" />,
});
