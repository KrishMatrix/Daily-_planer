import { Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudMoon, CloudRain, CloudSnow, CloudSun, Moon, Sun, type LucideProps } from "lucide-react";
import { weatherGroup, weatherLabel } from "@/lib/weather-codes";
import { cn } from "@/lib/utils";

const TONE = {
  clear: "text-amber-500",
  partly: "text-amber-500",
  cloudy: "text-slate-400",
  fog: "text-slate-400",
  drizzle: "text-sky-500",
  rain: "text-sky-600 dark:text-sky-400",
  showers: "text-sky-600 dark:text-sky-400",
  snow: "text-cyan-500",
  storm: "text-violet-500",
} as const;

export function WeatherIcon({ code, isDay = true, className, ...props }: { code: number; isDay?: boolean } & LucideProps) {
  const g = weatherGroup(code);
  const Icon =
    g === "clear" ? (isDay ? Sun : Moon)
    : g === "partly" ? (isDay ? CloudSun : CloudMoon)
    : g === "fog" ? CloudFog
    : g === "drizzle" ? CloudDrizzle
    : g === "rain" || g === "showers" ? CloudRain
    : g === "snow" ? CloudSnow
    : g === "storm" ? CloudLightning
    : Cloud;
  return <Icon aria-label={weatherLabel(code, isDay)} role="img" className={cn(TONE[g], !isDay && g === "clear" && "text-indigo-300", className)} {...props} />;
}
