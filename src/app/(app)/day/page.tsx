import { DayView } from "@/components/day-view";
import { isDateStr } from "@/lib/dates";

export const metadata = { title: "Day" };

export default async function DayPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { date } = await searchParams;
  return <DayView key={date ?? "today"} initialDate={isDateStr(date) ? date : undefined} />;
}
