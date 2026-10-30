// Client-safe shared types.
import type { Recurrence } from "./recurrence";

export type Priority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";
export type TaskKind = "TASK" | "ASSIGNMENT" | "EXAM" | "CLASS" | "MEETING" | "STUDY" | "EVENT";

export type CategoryDTO = { id: string; name: string; color: string; icon: string; key: string | null; sortOrder: number };

/** A task as shown in views. For recurring series, each occurrence gets id = `${taskId}@${date}`. */
export type ScheduleItem = {
  id: string;
  taskId: string;
  occurrenceDate: string | null;
  isRecurring: boolean;
  seriesId: string | null;
  title: string;
  description: string;
  notes: string;
  kind: TaskKind;
  priority: Priority;
  categoryId: string | null;
  category: { id: string; name: string; color: string; key: string | null } | null;
  subjectId: string | null;
  subject: { id: string; name: string; color: string; code: string } | null;
  project: string | null;
  location: string | null;
  outdoor: boolean;
  date: string | null;
  startTime: string | null;
  endTime: string | null;
  deadlineDate: string | null;
  deadlineTime: string | null;
  estimatedMinutes: number | null;
  completed: boolean;
  completedAt: string | null;
  recurrence: Recurrence | null;
  reminderMinutes: number[];
  sortOrder: number;
  version: number;
  attachmentCount: number;
  updatedAt: string;
};

export type Insight = {
  type: "conflict" | "move" | "workload" | "prep" | "weather";
  level: "info" | "warning";
  message: string;
  /** A suggested fix the user can accept with one click. */
  fix?: { itemId: string; changes: Record<string, unknown>; label: string };
  /** A question to hand to the AI assistant for deeper analysis (only sent if the user asks). */
  askAi?: string;
};

export type SettingsDTO = {
  name: string;
  email: string;
  timezone: string;
  dayStart: string;
  dayEnd: string;
  workDays: number[];
  workStart: string;
  workEnd: string;
  bufferMinutes: number;
  maxFocusMinutes: number;
  planningNotes: string;
  defaultReminderMinutes: number;
  classReminders: boolean;
  meetingReminders: boolean;
  deadlineReminders: boolean;
  overdueAlerts: boolean;
  dailyPlanNotification: boolean;
  dailyPlanTime: string;
  weatherLabel: string | null;
  weatherLat: number | null;
  weatherLon: number | null;
  weatherUnit: "celsius" | "fahrenheit";
  aiEnabled: boolean;
  /** "" = follow the server's AI_PROVIDER */
  aiProvider: "" | "openai" | "compatible";
  /** "" = follow the server's OPENAI_MODEL / AI_MODEL */
  aiModel: string;
  inputPricePerMTok: number;
  cachedInputPricePerMTok: number;
  outputPricePerMTok: number;
  monthlyBudgetUsd: number;
  confirmAboveUsd: number;
};

export const PRIORITY_LABEL: Record<Priority, string> = { LOW: "Low", MEDIUM: "Medium", HIGH: "High", URGENT: "Urgent" };
export const KIND_LABEL: Record<TaskKind, string> = {
  TASK: "Task",
  ASSIGNMENT: "Assignment",
  EXAM: "Exam",
  CLASS: "Class",
  MEETING: "Meeting",
  STUDY: "Study session",
  EVENT: "Event",
};
