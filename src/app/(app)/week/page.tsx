import { WeekBoard } from "@/components/week-board";
import { isDateStr } from "@/lib/dates";

export const metadata = { title: "Weekly planner" };

export default async function WeekPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { date } = await searchParams;
  return <WeekBoard initialDate={isDateStr(date) ? date : undefined} />;
}
