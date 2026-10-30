import { SettingsView } from "@/components/settings-view";

export const metadata = { title: "Settings" };

const TABS = ["general", "categories", "weather", "notifications", "app", "data"];

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  return <SettingsView initialTab={tab && TABS.includes(tab) ? tab : "general"} />;
}
