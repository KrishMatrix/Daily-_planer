"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, LocateFixed, MapPin, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { keys, useSettings } from "@/hooks/use-planner";
import { weatherKey } from "@/hooks/use-weather";
import type { SettingsDTO } from "@/lib/types";
import { api, cn } from "@/lib/utils";

type Place = { id: number; label: string; lat: number; lon: number };

/** Search for a city (or opt in to device location) and save it as the weather location. */
export function LocationPicker({ onSaved, compact }: { onSaved?: () => void; compact?: boolean }) {
  const qc = useQueryClient();
  const { data: settings } = useSettings();
  const [query, setQuery] = useState("");
  const [places, setPlaces] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Debounced search through our own API (keeps the provider off the client and rate-limited).
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setPlaces([]);
      setSearchError(null);
      return;
    }
    const ctrl = new AbortController();
    const id = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/weather/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        const data = (await res.json()) as { places?: Place[]; error?: string };
        if (!res.ok) throw new Error(data.error ?? "Search failed");
        setPlaces(data.places ?? []);
        setSearchError(data.places?.length ? null : "No matching places");
      } catch (e) {
        if ((e as Error).name !== "AbortError") setSearchError((e as Error).message);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => {
      clearTimeout(id);
      ctrl.abort();
    };
  }, [query]);

  const save = async (patch: Partial<SettingsDTO>, message?: string) => {
    setSaving(true);
    try {
      const res = await api<{ settings: SettingsDTO }>("/api/settings", { method: "PATCH", body: patch });
      qc.setQueryData(keys.settings, res.settings);
      await qc.invalidateQueries({ queryKey: weatherKey });
      if (message) toast.success(message);
      setQuery("");
      setPlaces([]);
      onSaved?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const useDevice = () => {
    if (!("geolocation" in navigator)) return toast.error("This device doesn't support location.");
    setLocating(true);
    // The browser shows its own permission prompt; nothing is requested until the user taps this button.
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const lat = Math.round(pos.coords.latitude * 100) / 100;
        const lon = Math.round(pos.coords.longitude * 100) / 100;
        save({ weatherLat: lat, weatherLon: lon, weatherLabel: `My location (${lat.toFixed(2)}, ${lon.toFixed(2)})` }, "Weather location set from this device");
      },
      (err) => {
        setLocating(false);
        toast.error(err.code === err.PERMISSION_DENIED ? "Location permission was denied. Search for your city instead." : "Couldn't get your location. Search for your city instead.");
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 10 * 60_000 },
    );
  };

  return (
    <div className="flex flex-col gap-3">
      {!compact && settings?.weatherLabel && (
        <div className="flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2 text-sm">
          <MapPin className="size-4 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">{settings.weatherLabel}</span>
          <Button size="xs" variant="ghost" disabled={saving} onClick={() => save({ weatherLat: null, weatherLon: null, weatherLabel: null }, "Weather location removed")}>
            Remove
          </Button>
        </div>
      )}
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search for a city, e.g. Saarbrücken" className="pl-9" maxLength={80} aria-label="Search for a city" />
        {searching && <Loader2 className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
      </div>
      {places.length > 0 && (
        <ul className="flex max-h-56 flex-col overflow-y-auto rounded-lg border" role="listbox">
          {places.map((p) => (
            <li key={p.id}>
              <button
                disabled={saving}
                onClick={() => save({ weatherLat: Math.round(p.lat * 100) / 100, weatherLon: Math.round(p.lon * 100) / 100, weatherLabel: p.label }, `Weather location set to ${p.label}`)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-accent"
              >
                <MapPin className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{p.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {searchError && query.trim().length >= 2 && !searching && <p className="text-xs text-muted-foreground">{searchError}</p>}
      <div className={cn("flex flex-wrap items-center gap-2", compact && "justify-between")}>
        <Button type="button" size="sm" variant="outline" onClick={useDevice} disabled={locating || saving}>
          {locating ? <Loader2 className="animate-spin" /> : <LocateFixed />} Use my location
        </Button>
        {settings && (
          <div className="flex items-center gap-1 rounded-lg border p-0.5 text-xs" role="group" aria-label="Temperature unit">
            {(["celsius", "fahrenheit"] as const).map((u) => (
              <button
                key={u}
                disabled={saving}
                onClick={() => settings.weatherUnit !== u && save({ weatherUnit: u })}
                className={cn("rounded-md px-2 py-1 font-medium", settings.weatherUnit === u ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")}
              >
                {u === "celsius" ? "°C" : "°F"}
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">Device location is optional and only used when you tap the button. Coordinates are rounded to about 1 km.</p>
    </div>
  );
}
