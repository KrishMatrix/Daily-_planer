"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, CalendarRange, Columns3 } from "lucide-react";
import { cn } from "@/lib/utils";

const VIEWS = [
  { href: "/day", label: "Day", icon: CalendarRange, match: (p: string) => p.startsWith("/day") || p === "/today" },
  { href: "/week", label: "Week", icon: Columns3, match: (p: string) => p.startsWith("/week") },
  { href: "/calendar", label: "Month", icon: CalendarDays, match: (p: string) => p.startsWith("/calendar") },
];

/** Switch between the daily, weekly and monthly views (all share the same task data). */
export function ViewSwitcher({ date }: { date?: string }) {
  const pathname = usePathname();
  return (
    <div className="flex items-center gap-0.5 rounded-lg border bg-card p-0.5 shadow-xs" role="tablist" aria-label="Calendar view">
      {VIEWS.map((v) => {
        const active = v.match(pathname);
        const href = date ? `${v.href}?date=${date}` : v.href;
        return (
          <Link
            key={v.href}
            href={href}
            role="tab"
            aria-selected={active}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:text-foreground",
              active && "bg-primary text-primary-foreground shadow-sm hover:text-primary-foreground",
            )}
          >
            <v.icon className="size-3.5" />
            {v.label}
          </Link>
        );
      })}
    </div>
  );
}
