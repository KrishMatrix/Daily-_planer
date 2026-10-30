"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Bot, CloudSun, Download, Loader2, Palette, Plus, Smartphone, Trash2, User, Database, Share, MonitorDown, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { invalidateAll, keys, useCategories, useSettings } from "@/hooks/use-planner";
import { WEEKDAYS_SHORT } from "@/lib/dates";
import { CATEGORY_PALETTE } from "@/lib/defaults";
import type { SettingsDTO } from "@/lib/types";
import { api, cn } from "@/lib/utils";
import { useConfirm } from "./confirm-dialog";
import { LocationPicker } from "./weather/location-picker";

export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<SettingsDTO>) => api<{ settings: SettingsDTO }>("/api/settings", { method: "PATCH", body: patch }),
    onSuccess: (r) => {
      qc.setQueryData(keys.settings, r.settings);
      toast.success("Settings saved");
    },
    onError: (e) => toast.error(e.message),
  });
}

export function SettingsView({ initialTab = "general" }: { initialTab?: string }) {
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Preferences sync to every device signed in to your account. AI options live in{" "}
          <Link href="/settings/ai" className="font-medium text-primary hover:underline">
            AI Settings
          </Link>
          .
        </p>
      </div>
      <Tabs defaultValue={initialTab}>
        <TabsList>
          <TabsTrigger value="general"><User /> General</TabsTrigger>
          <TabsTrigger value="categories"><Palette /> Categories</TabsTrigger>
          <TabsTrigger value="weather"><CloudSun /> Weather</TabsTrigger>
          <TabsTrigger value="notifications"><Bell /> Notifications</TabsTrigger>
          <TabsTrigger value="app"><Smartphone /> Install app</TabsTrigger>
          <TabsTrigger value="data"><Database /> Data</TabsTrigger>
        </TabsList>
        <TabsContent value="general"><General /></TabsContent>
        <TabsContent value="categories"><Categories /></TabsContent>
        <TabsContent value="weather"><WeatherSettings /></TabsContent>
        <TabsContent value="notifications"><Notifications /></TabsContent>
        <TabsContent value="app"><InstallApp /></TabsContent>
        <TabsContent value="data"><DataExport /></TabsContent>
      </Tabs>
    </div>
  );
}

function F({ label, hint, children, className }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <Label>{label}</Label>
      {children}
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </div>
  );
}

function General() {
  const { data } = useSettings();
  const save = useSaveSettings();
  const [f, setF] = useState<SettingsDTO | null>(null);
  useEffect(() => {
    if (data && !f) setF(data);
  }, [data, f]);
  if (!f) return <Loader2 className="mx-auto mt-10 animate-spin text-muted-foreground" />;
  const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [f.timezone];

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <F label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></F>
          <F label="Email"><Input value={f.email} disabled /></F>
          <F label="Timezone" hint="Times are shown and reminders are sent in this timezone on every device.">
            <NativeSelect value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })}>
              {zones.map((z) => (
                <option key={z}>{z}</option>
              ))}
            </NativeSelect>
          </F>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Planning preferences</CardTitle>
            <CardDescription className="mt-1">Used for suggestions, conflict fixes and “Plan my day”.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <F label="Day starts"><Input type="time" value={f.dayStart} onChange={(e) => setF({ ...f, dayStart: e.target.value })} /></F>
            <F label="Day ends"><Input type="time" value={f.dayEnd} onChange={(e) => setF({ ...f, dayEnd: e.target.value })} /></F>
            <F label="Break between blocks">
              <NativeSelect value={f.bufferMinutes} onChange={(e) => setF({ ...f, bufferMinutes: Number(e.target.value) })}>
                {[0, 5, 10, 15, 20, 30, 45, 60].map((m) => (
                  <option key={m} value={m}>{m} min</option>
                ))}
              </NativeSelect>
            </F>
            <F label="Longest focus block">
              <NativeSelect value={f.maxFocusMinutes} onChange={(e) => setF({ ...f, maxFocusMinutes: Number(e.target.value) })}>
                {[45, 60, 90, 120, 150, 180, 240].map((m) => (
                  <option key={m} value={m}>{m} min</option>
                ))}
              </NativeSelect>
            </F>
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
            <F label="ZeMA work days">
              <div className="flex flex-wrap gap-1">
                {WEEKDAYS_SHORT.map((d, i) => {
                  const on = f.workDays.includes(i);
                  return (
                    <button key={d} type="button" onClick={() => setF({ ...f, workDays: on ? f.workDays.filter((x) => x !== i) : [...f.workDays, i].sort() })} className={cn("h-9 w-11 rounded-md border text-xs font-medium", on ? "border-sky-500 bg-sky-500 text-white" : "hover:bg-accent")}>
                      {d}
                    </button>
                  );
                })}
              </div>
            </F>
            <F label="Work starts"><Input type="time" value={f.workStart} onChange={(e) => setF({ ...f, workStart: e.target.value })} /></F>
            <F label="Work ends"><Input type="time" value={f.workEnd} onChange={(e) => setF({ ...f, workEnd: e.target.value })} /></F>
          </div>
          <F label="Anything else the assistant should know?" hint="e.g. “I study best in the morning”, “Gym on Mon/Wed/Fri evenings”. Treated as preferences.">
            <Textarea value={f.planningNotes} onChange={(e) => setF({ ...f, planningNotes: e.target.value })} rows={2} maxLength={1000} />
          </F>
        </CardContent>
      </Card>
      <Button
        className="self-end"
        disabled={save.isPending}
        onClick={() =>
          save.mutate({
            name: f.name,
            timezone: f.timezone,
            dayStart: f.dayStart,
            dayEnd: f.dayEnd,
            workDays: f.workDays,
            workStart: f.workStart,
            workEnd: f.workEnd,
            bufferMinutes: f.bufferMinutes,
            maxFocusMinutes: f.maxFocusMinutes,
            planningNotes: f.planningNotes,
          })
        }
      >
        {save.isPending && <Loader2 className="animate-spin" />} Save changes
      </Button>
    </div>
  );
}

function Categories() {
  const qc = useQueryClient();
  const { data: categories = [] } = useCategories();
  const [name, setName] = useState("");
  const [color, setColor] = useState(CATEGORY_PALETTE[6]);
  const { confirm, element } = useConfirm();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: keys.categories });
    invalidateAll(qc);
  };

  const add = async () => {
    try {
      await api("/api/categories", { method: "POST", body: { name: name.trim(), color } });
      setName("");
      refresh();
      toast.success("Category added");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const patch = async (id: string, body: { name?: string; color?: string }) => {
    try {
      await api(`/api/categories/${id}`, { method: "PATCH", body });
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const del = async (id: string, n: string) => {
    if (!(await confirm({ title: `Delete "${n}"?`, description: "Tasks in this category are kept and become uncategorised.", confirmLabel: "Delete", destructive: true }))) return;
    await api(`/api/categories/${id}`, { method: "DELETE" }).catch((e) => toast.error(e.message));
    refresh();
  };

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Categories</CardTitle>
          <CardDescription className="mt-1">Colours are used on the board, calendar and charts.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {categories.map((c) => (
          <div key={c.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-2">
            <span className="size-4 rounded-full" style={{ background: c.color }} />
            <Input defaultValue={c.name} className="h-8 w-44" onBlur={(e) => e.target.value.trim() && e.target.value !== c.name && patch(c.id, { name: e.target.value.trim() })} maxLength={40} />
            <div className="flex flex-1 flex-wrap gap-1">
              {CATEGORY_PALETTE.map((p) => (
                <button key={p} onClick={() => patch(c.id, { color: p })} className={cn("size-5 rounded-full ring-offset-2 ring-offset-card", c.color === p && "ring-2 ring-foreground/40")} style={{ background: p }} aria-label={`Set colour ${p}`} />
              ))}
            </div>
            {c.key ? (
              <span className="text-[11px] text-muted-foreground">built-in</span>
            ) : (
              <Button variant="ghost" size="icon-sm" onClick={() => del(c.id, c.name)} aria-label={`Delete ${c.name}`}>
                <Trash2 />
              </Button>
            )}
          </div>
        ))}
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-dashed p-2">
          <span className="size-4 rounded-full" style={{ background: color }} />
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New category" className="h-8 w-44" maxLength={40} onKeyDown={(e) => e.key === "Enter" && name.trim() && add()} />
          <div className="flex flex-1 flex-wrap gap-1">
            {CATEGORY_PALETTE.map((p) => (
              <button key={p} onClick={() => setColor(p)} className={cn("size-5 rounded-full ring-offset-2 ring-offset-card", color === p && "ring-2 ring-foreground/40")} style={{ background: p }} aria-label={`Colour ${p}`} />
            ))}
          </div>
          <Button size="sm" onClick={add} disabled={!name.trim()}>
            <Plus /> Add
          </Button>
        </div>
      </CardContent>
      {element}
    </Card>
  );
}

function WeatherSettings() {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Weather location</CardTitle>
          <CardDescription className="mt-1">
            Forecasts appear on the weekly planner, calendar and daily view, and help the assistant flag rain during outdoor plans. Forecast data comes from Open-Meteo (about 16 days ahead).
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="max-w-md">
        <LocationPicker />
      </CardContent>
    </Card>
  );
}

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

function Notifications() {
  const { data } = useSettings();
  const save = useSaveSettings();
  const { data: push, refetch } = useQuery({ queryKey: ["push"], queryFn: () => api<{ configured: boolean; devices: number; publicKey: string | null }>("/api/push/subscribe") });
  const [permission, setPermission] = useState<string>("default");
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const supported = typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

  useEffect(() => {
    if (!("Notification" in window)) return setPermission("unsupported");
    setPermission(Notification.permission);
    navigator.serviceWorker?.getRegistration().then((reg) => reg?.pushManager.getSubscription().then((s) => setSubscribed(Boolean(s))));
  }, []);

  const enablePush = async () => {
    if (!push?.publicKey) return;
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") throw new Error("Notification permission was not granted");
      const reg = await Promise.race([navigator.serviceWorker.ready, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("Service worker not active (it only runs in production builds)")), 5000))]);
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(push.publicKey) });
      await api("/api/push/subscribe", { method: "POST", body: sub.toJSON() });
      localStorage.setItem("lp-push", "on");
      setSubscribed(true);
      refetch();
      toast.success("Push notifications enabled on this device");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const disablePush = async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await api("/api/push/subscribe", { method: "DELETE", body: { endpoint: sub.endpoint } }).catch(() => {});
      await sub.unsubscribe();
    }
    localStorage.removeItem("lp-push");
    setSubscribed(false);
    refetch();
  };

  const allowInApp = async () => setPermission(await Notification.requestPermission());

  if (!data) return null;
  const toggle = (k: keyof SettingsDTO, label: string, desc: string) => (
    <div className="flex items-center justify-between gap-4 py-2">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{desc}</div>
      </div>
      <Switch checked={Boolean(data[k])} onCheckedChange={(v) => save.mutate({ [k]: v })} />
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>What to remind me about</CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          {toggle("classReminders", "Class reminders", "Before each lecture or tutorial")}
          {toggle("meetingReminders", "Meeting reminders", "Before each meeting")}
          {toggle("deadlineReminders", "Deadline reminders", "The day before and on the due date")}
          {toggle("overdueAlerts", "Overdue alerts", "When a deadline passes and the task isn't done")}
          {toggle("dailyPlanNotification", "Daily planning nudge", "A morning summary prompting “Plan my day”")}
          <div className="grid grid-cols-2 gap-3 pt-3">
            <F label="Default reminder (classes & meetings)">
              <NativeSelect value={data.defaultReminderMinutes} onChange={(e) => save.mutate({ defaultReminderMinutes: Number(e.target.value) })}>
                {[0, 5, 10, 15, 30, 60].map((m) => (
                  <option key={m} value={m}>{m === 0 ? "At start" : `${m} min before`}</option>
                ))}
              </NativeSelect>
            </F>
            <F label="Daily planning time">
              <Input type="time" defaultValue={data.dailyPlanTime} onBlur={(e) => e.target.value && e.target.value !== data.dailyPlanTime && save.mutate({ dailyPlanTime: e.target.value })} />
            </F>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Delivery on this device</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <div className="rounded-lg bg-muted/60 p-3 text-xs leading-relaxed text-muted-foreground">
            <p>
              <strong className="text-foreground">In-app notification centre</strong> (the bell) always works while the app is open.
            </p>
            <p className="mt-1">
              <strong className="text-foreground">Browser notifications</strong> pop up while the app is open in a tab or window, once you allow them.
            </p>
            <p className="mt-1">
              <strong className="text-foreground">Push notifications</strong> can arrive while the app is closed — only if the server has VAPID keys configured, a scheduled job runs <code>/api/cron/reminders</code>, and this
              browser supports Web Push. On iPhone/iPad this requires iOS 16.4+ and the app installed to the Home Screen.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm">Browser permission: <strong>{permission}</strong></span>
            {permission === "default" && (
              <Button size="sm" variant="outline" onClick={allowInApp}>
                Allow notifications
              </Button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {!supported ? (
              <span className="text-muted-foreground">This browser doesn&apos;t support push notifications{/iPhone|iPad/.test(typeof navigator !== "undefined" ? navigator.userAgent : "") ? " — install the app to your Home Screen first" : ""}.</span>
            ) : !push?.configured ? (
              <span className="text-muted-foreground">Push isn&apos;t configured on the server (set NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY).</span>
            ) : subscribed ? (
              <>
                <span className="flex items-center gap-1.5 font-medium text-success"><Check className="size-4" /> Push enabled on this device</span>
                <Button size="sm" variant="ghost" onClick={disablePush}>Turn off</Button>
              </>
            ) : (
              <Button size="sm" onClick={enablePush} disabled={busy}>
                {busy ? <Loader2 className="animate-spin" /> : <Bell />} Enable push on this device
              </Button>
            )}
            {push?.configured && <span className="text-xs text-muted-foreground">{push.devices} device{push.devices === 1 ? "" : "s"} subscribed</span>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

function InstallApp() {
  const [standalone, setStandalone] = useState(false);
  const [prompt, setPrompt] = useState<BIPEvent | null>(null);
  const [platform, setPlatform] = useState<"ios" | "android" | "desktop">("desktop");

  useEffect(() => {
    setStandalone(window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true);
    const ua = navigator.userAgent;
    setPlatform(/iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1) ? "ios" : /Android/.test(ua) ? "android" : "desktop");
    const w = window as { __lpInstallPrompt?: BIPEvent };
    if (w.__lpInstallPrompt) setPrompt(w.__lpInstallPrompt);
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as BIPEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  const install = async () => {
    if (!prompt) return;
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === "accepted") toast.success("Installed!");
    setPrompt(null);
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Install AI Life Planner</CardTitle>
            <CardDescription className="mt-1">Opens in its own window without browser tabs or an address bar (where the platform supports it).</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          {standalone ? (
            <p className="flex items-center gap-2 font-medium text-success"><Check className="size-4" /> You&apos;re using the installed app.</p>
          ) : prompt ? (
            <Button onClick={install} className="self-start">
              <MonitorDown /> Install app
            </Button>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-3">
            <Steps active={platform === "ios"} title="iPhone & iPad (Safari)" steps={["Open this site in Safari", <>Tap <Share className="inline size-3.5" /> Share</>, "Choose “Add to Home Screen”", "Tap Add"]} />
            <Steps active={platform === "android"} title="Android (Chrome)" steps={["Open the ⋮ menu", "Tap “Install app” or “Add to Home screen”", "Confirm Install"]} />
            <Steps active={platform === "desktop"} title="Windows & macOS (Chrome / Edge)" steps={["Click the install icon in the address bar", "or ⋮ menu → “Install AI Life Planner”", "On macOS Safari 17+: File → Add to Dock"]} />
          </div>
          <p className="text-xs text-muted-foreground">
            Offline: the app shell and the schedule you last viewed stay available without a connection (read-only). Creating or editing tasks needs a connection, so your devices never drift apart.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function Steps({ title, steps, active }: { title: string; steps: React.ReactNode[]; active?: boolean }) {
  return (
    <div className={cn("rounded-xl border p-3", active && "border-primary/50 bg-primary/5")}>
      <div className="mb-2 text-sm font-medium">{title}</div>
      <ol className="list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
        {steps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
    </div>
  );
}

function DataExport() {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Backup & export</CardTitle>
            <CardDescription className="mt-1">Your data lives in the server database and syncs to all your devices. Download a copy any time.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <a href="/api/export?format=json" download>
              <Download /> Full backup (JSON)
            </a>
          </Button>
          <Button asChild variant="outline">
            <a href="/api/export?format=ics" download>
              <Download /> Calendar (.ics)
            </a>
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Bot className="size-4" /> AI & privacy</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          When you use AI features, the relevant parts of your schedule (titles, times, deadlines) are sent to your configured AI provider to generate the answer. Your API key stays on the server and is never sent to the
          browser. AI can only <em>propose</em> changes — nothing is modified until you press Accept.
        </CardContent>
      </Card>
    </div>
  );
}
