import { CalendarView } from "@/components/calendar-view";
import { isDateStr } from "@/lib/dates";

export const metadata = { title: "Monthly calendar" };

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { date } = await searchParams;
  return <CalendarView initialDate={isDateStr(date) ? date : undefined} />;
}
