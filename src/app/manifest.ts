import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "AI Life Planner",
    short_name: "Life Planner",
    description: "Weekly planner, monthly calendar, weather and an AI planning assistant.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["window-controls-overlay", "standalone"],
    orientation: "any",
    background_color: "#f8f8fc",
    theme_color: "#6366f1",
    categories: ["productivity", "education"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Today", url: "/today", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Weekly planner", url: "/week", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Monthly calendar", url: "/calendar", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "AI assistant", url: "/assistant", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
