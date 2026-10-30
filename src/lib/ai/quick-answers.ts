// Answers simple calendar look-ups straight from the database, without calling a model.
// Deliberately narrow: anything that needs judgement or has an action verb goes to the AI.

import { addDays, formatDateLong, formatTime12, toMinutes } from "../dates";
import type { ScheduleItem } from "../types";

const ACTION_WORDS = /\b(move|schedule|plan|organi[sz]e|find|reschedul\w*|create|add|delete|remove|cancel|should|can i|could|why|how|realistic|postpone|help)\b/i;

const when = (i: ScheduleItem) => `${formatTime12(i.startTime!)}${i.endTime ? `–${formatTime12(i.endTime)}` : ""}`;
const line = (i: ScheduleItem) => `- **${i.title}** · ${i.startTime ? when(i) : "any time"}${i.location ? ` · ${i.location}` : ""}`;

/**
 * Returns a reply for questions like "what is my next class?" or "what meetings do I have tomorrow?",
 * or null if the question should go to the AI. `items` must cover today .. today+7.
 */
export function quickAnswer(question: string, items: ScheduleItem[], today: string, nowMinutes: number): string | null {
  const q = question.trim().toLowerCase().replace(/[?!.]+$/, "");
  if (q.length > 90 || ACTION_WORDS.test(q)) return null;

  const upcoming = (kind: "CLASS" | "MEETING" | "EXAM") =>
    items
      .filter((i) => i.kind === kind && !i.completed && i.date && i.startTime && (i.date > today || (i.date === today && toMinutes(i.startTime) >= nowMinutes)))
      .sort((a, b) => (a.date! + a.startTime!).localeCompare(b.date! + b.startTime!));

  const next = q.match(/^(?:when(?:'s| is)|what(?:'s| is))\s+my\s+next\s+(class|lecture|lab|seminar|meeting|exam)$/);
  if (next) {
    const kind = next[1] === "meeting" ? "MEETING" : next[1] === "exam" ? "EXAM" : "CLASS";
    const n = upcoming(kind)[0];
    const label = kind === "MEETING" ? "meeting" : kind === "EXAM" ? "exam" : "class";
    if (!n) return `I don't see another ${label} in your calendar for the next 7 days.`;
    const day = n.date === today ? "today" : n.date === addDays(today, 1) ? "tomorrow" : formatDateLong(n.date!);
    return `Your next ${label} is **${n.title}** ${day} at ${when(n)}${n.location ? ` in ${n.location}` : ""}.`;
  }

  const list = q.match(/^(?:what|which)\s+(meetings|classes|lectures|exams)\s+(?:do\s+i\s+have|have\s+i\s+got|are\s+there)\s+(today|tomorrow)$/);
  if (list) {
    const kind = list[1] === "meetings" ? "MEETING" : list[1] === "exams" ? "EXAM" : "CLASS";
    const date = list[2] === "today" ? today : addDays(today, 1);
    const found = items.filter((i) => i.kind === kind && i.date === date).sort((a, b) => (a.startTime ?? "").localeCompare(b.startTime ?? ""));
    if (!found.length) return `You have no ${list[1]} ${list[2]}.`;
    return `${list[2] === "today" ? "Today" : "Tomorrow"} you have ${found.length} ${found.length === 1 ? list[1].replace(/e?s$/, "") : list[1]}:\n${found.map(line).join("\n")}`;
  }

  const sched = q.match(/^what(?:'s| is)\s+on\s+my\s+(?:schedule|calendar|plan)\s+(today|tomorrow)$|^what\s+do\s+i\s+have\s+(today|tomorrow)$/);
  if (sched) {
    const which = sched[1] ?? sched[2];
    const date = which === "today" ? today : addDays(today, 1);
    const found = items.filter((i) => i.date === date && !i.completed).sort((a, b) => (a.startTime ?? "99").localeCompare(b.startTime ?? "99"));
    if (!found.length) return `Nothing is scheduled ${which}.`;
    return `${which === "today" ? "Today" : "Tomorrow"} (${formatDateLong(date)}):\n${found.map(line).join("\n")}`;
  }
  return null;
}
