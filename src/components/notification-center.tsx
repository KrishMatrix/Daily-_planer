"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlarmClock, Bell, BellRing, CalendarCheck, GraduationCap, Users, AlertTriangle, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { api, cn } from "@/lib/utils";

type N = { id: string; type: string; title: string; body: string; url: string | null; read: boolean; createdAt: string };

const ICON: Record<string, typeof Bell> = { CLASS: GraduationCap, MEETING: Users, DEADLINE: AlarmClock, OVERDUE: AlertTriangle, DAILY_PLAN: CalendarCheck };

function timeAgo(iso: string) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function NotificationCenter() {
  const qc = useQueryClient();
  const router = useRouter();
  const seen = useRef<Set<string> | null>(null);

  // While the app is open, ask the server to generate any due reminders (works without a cron).
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      api<{ created: number }>("/api/notifications/check", { method: "POST" })
        .then((r) => {
          if (r.created) qc.invalidateQueries({ queryKey: ["notifications"] });
        })
        .catch(() => {});
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [qc]);

  const { data } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api<{ notifications: N[]; unread: number }>("/api/notifications"),
    refetchInterval: 60_000,
  });

  // Surface brand-new notifications as system notifications when permitted and no push subscription handles it.
  useEffect(() => {
    if (!data) return;
    const ids = new Set(data.notifications.map((n) => n.id));
    if (seen.current) {
      const fresh = data.notifications.filter((n) => !n.read && !seen.current!.has(n.id));
      if (fresh.length && "Notification" in window && Notification.permission === "granted" && localStorage.getItem("lp-push") !== "on") {
        navigator.serviceWorker?.getRegistration().then((reg) => {
          for (const n of fresh.slice(0, 3)) {
            if (reg) reg.showNotification(n.title, { body: n.body, tag: n.id, icon: "/icons/icon-192.png", data: { url: n.url ?? "/" } });
            else new Notification(n.title, { body: n.body, tag: n.id });
          }
        });
      }
    }
    seen.current = ids;
  }, [data]);

  const markRead = useMutation({
    mutationFn: (body: { ids?: string[]; all?: boolean }) => api("/api/notifications", { method: "PATCH", body }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const unread = data?.unread ?? 0;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="relative" aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}>
          {unread ? <BellRing /> : <Bell />}
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <span className="text-sm font-semibold">Notifications</span>
          {unread > 0 && (
            <Button variant="ghost" size="sm" onClick={() => markRead.mutate({ all: true })}>
              <CheckCheck /> Mark all read
            </Button>
          )}
        </div>
        <div className="max-h-[60dvh] overflow-y-auto">
          {!data?.notifications.length ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">
              <Bell className="mx-auto mb-2 size-6 opacity-40" />
              You&apos;re all caught up.
            </div>
          ) : (
            data.notifications.map((n) => {
              const Icon = ICON[n.type] ?? Bell;
              return (
                <button
                  key={n.id}
                  onClick={() => {
                    if (!n.read) markRead.mutate({ ids: [n.id] });
                    if (n.url) router.push(n.url);
                  }}
                  className={cn("flex w-full gap-3 border-b px-4 py-3 text-left transition last:border-0 hover:bg-muted/60", !n.read && "bg-primary/5")}
                >
                  <Icon className={cn("mt-0.5 size-4 shrink-0", n.type === "OVERDUE" ? "text-destructive" : "text-primary")} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{n.title}</div>
                    {n.body && <div className="text-xs text-muted-foreground">{n.body}</div>}
                    <div className="mt-1 text-[11px] text-muted-foreground">{timeAgo(n.createdAt)}</div>
                  </div>
                  {!n.read && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />}
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
