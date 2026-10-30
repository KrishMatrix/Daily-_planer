import { db } from "@/lib/db";
import { addDays, nowInTz } from "@/lib/dates";
import { authed, json } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { getItemsInRange } from "@/lib/tasks";

const icsEscape = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const icsDate = (d: string, t?: string | null) => (t ? `${d.replace(/-/g, "")}T${t.replace(":", "")}00` : d.replace(/-/g, ""));

/** Full data export: ?format=json (backup) or ?format=ics (calendar, next 6 months). */
export const GET = authed(async (req, user) => {
  await rateLimit(`export:${user.id}`, 20, 3600);
  const format = req.nextUrl.searchParams.get("format") ?? "json";
  const stamp = new Date().toISOString().slice(0, 10);

  if (format === "ics") {
    const today = nowInTz(user.timezone).date;
    const items = await getItemsInRange(user.id, addDays(today, -30), addDays(today, 180));
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//AI Life Planner//EN", "CALSCALE:GREGORIAN"];
    const dtstamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
    for (const i of items) {
      if (!i.date) continue;
      lines.push("BEGIN:VEVENT", `UID:${i.id.replace("@", "-")}@ai-life-planner`, `DTSTAMP:${dtstamp}`);
      if (i.startTime && i.endTime) {
        lines.push(`DTSTART;TZID=${user.timezone}:${icsDate(i.date, i.startTime)}`, `DTEND;TZID=${user.timezone}:${icsDate(i.date, i.endTime)}`);
      } else {
        lines.push(`DTSTART;VALUE=DATE:${icsDate(i.date)}`, `DTEND;VALUE=DATE:${icsDate(addDays(i.date, 1))}`);
      }
      lines.push(`SUMMARY:${icsEscape(i.title)}`);
      if (i.description) lines.push(`DESCRIPTION:${icsEscape(i.description)}`);
      if (i.location) lines.push(`LOCATION:${icsEscape(i.location)}`);
      if (i.category) lines.push(`CATEGORIES:${icsEscape(i.category.name)}`);
      lines.push("END:VEVENT");
    }
    lines.push("END:VCALENDAR");
    return new Response(lines.join("\r\n"), {
      headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename="life-planner-${stamp}.ics"` },
    });
  }

  const [profile, settings, categories, tasks, semesters, subjects, lectureNotes, attachments] = await Promise.all([
    db.user.findUnique({ where: { id: user.id }, select: { email: true, name: true, timezone: true, createdAt: true } }),
    db.userSettings.findUnique({ where: { userId: user.id } }),
    db.category.findMany({ where: { userId: user.id } }),
    db.task.findMany({ where: { userId: user.id } }),
    db.semester.findMany({ where: { userId: user.id } }),
    db.subject.findMany({ where: { userId: user.id } }),
    db.lectureNote.findMany({ where: { userId: user.id } }),
    db.attachment.findMany({ where: { userId: user.id }, select: { id: true, taskId: true, filename: true, mimeType: true, size: true, url: true, createdAt: true } }),
  ]);
  return json(
    { exportedAt: new Date().toISOString(), version: 1, profile, settings, categories, tasks, semesters, subjects, lectureNotes, attachments },
    { headers: { "Content-Disposition": `attachment; filename="life-planner-backup-${stamp}.json"` } },
  );
});
