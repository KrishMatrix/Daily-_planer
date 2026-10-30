"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import {
  BarChart3,
  Briefcase,
  CalendarDays,
  CalendarRange,
  Columns3,
  Dumbbell,
  GraduationCap,
  Heart,
  LayoutDashboard,
  ListTodo,
  LogOut,
  Menu,
  Moon,
  PanelRightOpen,
  Plus,
  Settings,
  Sparkles,
  Sun,
  WifiOff,
  Bot,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn, api } from "@/lib/utils";
import { PlannerUIProvider, usePlannerUI } from "./planner-ui";
import { TaskDialog } from "./task-dialog";
import { AssistantDock, ChatPanel, ChatPromptBridge, ChatProvider } from "./ai/chat-panel";
import { PlanDayDialog } from "./ai/plan-day-dialog";
import { ReviewWeekDialog } from "./ai/review-week-dialog";
import { NotificationCenter } from "./notification-center";

type NavItem = { href: string; label: string; short?: string; icon: typeof LayoutDashboard; group?: string };

const NAV: NavItem[] = [
  { href: "/", label: "Dashboard", short: "Home", icon: LayoutDashboard },
  { href: "/week", label: "Weekly Planner", short: "Week", icon: Columns3 },
  { href: "/calendar", label: "Monthly Calendar", short: "Month", icon: CalendarDays },
  { href: "/today", label: "Today", icon: CalendarRange },
  { href: "/tasks", label: "Tasks", icon: ListTodo },
  { href: "/university", label: "University", icon: GraduationCap, group: "Areas" },
  { href: "/work", label: "ZeMA Work", icon: Briefcase },
  { href: "/gym", label: "Gym", icon: Dumbbell },
  { href: "/personal", label: "Personal", icon: Heart },
  { href: "/assistant", label: "AI Assistant", icon: Sparkles, group: "More" },
  { href: "/progress", label: "Progress", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: Settings },
];

const MOBILE_NAV = [NAV[0], NAV[1], NAV[2], NAV[3]];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (href === "/today") return pathname === "/today" || pathname.startsWith("/day");
  return pathname === href || pathname.startsWith(href + "/");
}

type User = { name: string; email: string };

export function AppShell({ user, children }: { user: User; children: React.ReactNode }) {
  return (
    <PlannerUIProvider>
      <ChatProvider>
        <ChatPromptBridge />
        <Shell user={user}>{children}</Shell>
      </ChatProvider>
    </PlannerUIProvider>
  );
}

function Shell({ user, children }: { user: User; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { openTask, openChat, dockOpen, setDockOpen } = usePlannerUI();
  const showDock = dockOpen && pathname !== "/assistant";
  const [moreOpen, setMoreOpen] = useState(false);
  const online = useOnline();

  const logout = async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    // Don't leave cached schedule data behind on shared devices.
    if ("caches" in window) await caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("data-") || k.startsWith("pages-")).map((k) => caches.delete(k)))).catch(() => {});
    sessionStorage.removeItem("lp-chat");
    router.replace("/login");
    router.refresh();
  };

  return (
    <div className="flex min-h-dvh">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r bg-sidebar px-3 py-4 lg:flex">
        <Link href="/" className="mb-6 flex items-center gap-2.5 px-2">
          <Logo />
          <span className="font-semibold tracking-tight">Life Planner</span>
        </Link>
        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto" aria-label="Main">
          {NAV.map((n) => (
            <div key={n.href} className="contents">
              {n.group && <div className="mt-4 mb-1 px-3 text-[10px] font-semibold tracking-wider text-muted-foreground/70 uppercase">{n.group}</div>}
              <Link
                href={n.href}
                aria-current={isActive(pathname, n.href) ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                  isActive(pathname, n.href) && "bg-card text-foreground shadow-sm ring-1 ring-border",
                )}
              >
                <n.icon className="size-4" />
                {n.label}
              </Link>
            </div>
          ))}
        </nav>
        <button
          onClick={() => openChat()}
          className="group mt-4 flex shrink-0 items-center gap-3 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 px-3 py-3 text-left text-sm font-medium text-white shadow-md transition hover:shadow-lg"
        >
          <Sparkles className="size-4 transition group-hover:rotate-12" />
          <span>
            Ask your assistant
            <span className="block text-xs font-normal text-white/75">Plan, find time, reschedule</span>
          </span>
        </button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="pt-safe sticky top-0 z-30 border-b bg-background/80 backdrop-blur-xl">
          <div className="flex h-14 items-center gap-2 px-4 sm:px-6">
            <Link href="/" className="flex items-center gap-2 lg:hidden">
              <Logo />
            </Link>
            <div className="flex-1" />
            {!online && (
              <span className="flex items-center gap-1.5 rounded-full bg-warning/15 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-warning">
                <WifiOff className="size-3.5" /> Offline — viewing saved data
              </span>
            )}
            <Button size="sm" onClick={() => openTask()} className="hidden sm:inline-flex">
              <Plus /> Quick add
            </Button>
            <Button size="icon-sm" onClick={() => openTask()} className="sm:hidden" aria-label="Quick add task">
              <Plus />
            </Button>
            <NotificationCenter />
            <ThemeToggle />
            {!showDock && (
              <Button variant="ghost" size="icon-sm" className="hidden xl:inline-flex" onClick={() => setDockOpen(true)} aria-label="Show assistant panel" title="Show assistant panel">
                <PanelRightOpen />
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-indigo-400 to-violet-500 text-xs font-semibold text-white" aria-label="Account">
                  {user.name.slice(0, 1).toUpperCase()}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div className="text-sm font-medium text-foreground">{user.name}</div>
                  <div className="truncate text-xs">{user.email}</div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => router.push("/settings")}>
                  <Settings /> Settings
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => router.push("/settings?tab=weather")}>
                  <Sun /> Weather location
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => router.push("/settings/ai")}>
                  <Bot /> AI Settings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={logout}>
                  <LogOut /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main className="min-w-0 flex-1 px-4 pt-5 pb-28 sm:px-6 lg:pb-10">{children}</main>
      </div>

      {/* Right panel: AI assistant (wide screens) */}
      {showDock && <AssistantDock />}

      {/* Floating AI button (smaller screens, or when the panel is hidden) */}
      {pathname !== "/assistant" && (
        <button
          onClick={() => openChat()}
          aria-label="Open AI assistant"
          className={cn(
            "fixed right-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-40 flex size-13 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-lg shadow-indigo-500/30 transition hover:scale-105 active:scale-95 lg:right-6 lg:bottom-6",
            showDock && "xl:hidden",
          )}
        >
          <Sparkles className="size-5" />
        </button>
      )}

      {/* Mobile bottom navigation */}
      <nav className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t bg-background/90 backdrop-blur-xl lg:hidden">
        <div className="grid h-16 grid-cols-5">
          {MOBILE_NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={cn("flex flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground", isActive(pathname, n.href) && "text-primary")}
            >
              <n.icon className="size-5" />
              {n.short ?? n.label}
            </Link>
          ))}
          <button onClick={() => setMoreOpen(true)} className="flex flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground">
            <Menu className="size-5" />
            More
          </button>
        </div>
      </nav>
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="right" className="pt-safe p-4">
          <SheetTitle className="mt-2 mb-4 px-2 text-lg font-semibold">Menu</SheetTitle>
          <div className="flex flex-col gap-1 overflow-y-auto">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                onClick={() => setMoreOpen(false)}
                className={cn("flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium hover:bg-accent", isActive(pathname, n.href) && "bg-accent text-accent-foreground")}
              >
                <n.icon className="size-5 text-muted-foreground" />
                {n.label}
              </Link>
            ))}
            <button onClick={logout} className="mt-4 flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-destructive hover:bg-destructive/10">
              <LogOut className="size-5" /> Sign out
            </button>
          </div>
        </SheetContent>
      </Sheet>

      <TaskDialog />
      <ChatPanel />
      <PlanDayDialog />
      <ReviewWeekDialog />
    </div>
  );
}

export function Logo() {
  return (
    <span className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-sm">
      <svg viewBox="0 0 24 24" className="size-4.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4.5" width="18" height="16" rx="3" />
        <path d="M3 9.5h18M8 2.5v4M16 2.5v4" />
        <path d="m8.5 14.5 2.2 2.2 4.8-4.7" />
      </svg>
    </span>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <Button variant="ghost" size="icon-sm" aria-label="Toggle dark mode" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
      <Sun className="hidden dark:block" />
      <Moon className="dark:hidden" />
    </Button>
  );
}

function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}
