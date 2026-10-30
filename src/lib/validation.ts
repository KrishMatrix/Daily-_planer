import { z } from "zod";
import { isDateStr, isTimeStr, toMinutes } from "./dates";

export const dateStr = z.string().refine(isDateStr, "Expected a date (YYYY-MM-DD)");
export const timeStr = z.string().refine(isTimeStr, "Expected a time (HH:mm)");
export const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Expected a hex color like #6366f1");

export const priorityEnum = z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]);
export const kindEnum = z.enum(["TASK", "ASSIGNMENT", "EXAM", "CLASS", "MEETING", "STUDY", "EVENT"]);

export const recurrenceSchema = z
  .object({
    freq: z.enum(["DAILY", "WEEKLY", "MONTHLY"]),
    interval: z.number().int().min(1).max(52).default(1),
    byWeekday: z.array(z.number().int().min(0).max(6)).max(7).optional(),
    until: dateStr.optional(),
    count: z.number().int().min(1).max(500).optional(),
  })
  .strict();

const taskFields = {
  title: z.string().trim().min(1, "Title is required").max(200),
  description: z.string().max(5000),
  notes: z.string().max(20000),
  kind: kindEnum,
  priority: priorityEnum,
  categoryId: z.string().max(40).nullable(),
  subjectId: z.string().max(40).nullable(),
  project: z.string().trim().max(80).nullable(),
  location: z.string().trim().max(200).nullable(),
  outdoor: z.boolean(),
  date: dateStr.nullable(),
  startTime: timeStr.nullable(),
  endTime: timeStr.nullable(),
  deadlineDate: dateStr.nullable(),
  deadlineTime: timeStr.nullable(),
  estimatedMinutes: z.number().int().min(5).max(24 * 60).nullable(),
  completed: z.boolean(),
  recurrence: recurrenceSchema.nullable(),
  reminderMinutes: z.array(z.number().int().min(0).max(7 * 24 * 60)).max(5),
  sortOrder: z.number(),
};

function checkTimes(v: { startTime?: string | null; endTime?: string | null; date?: string | null; recurrence?: unknown }, ctx: z.RefinementCtx) {
  if (v.startTime && v.endTime && toMinutes(v.endTime) <= toMinutes(v.startTime)) {
    ctx.addIssue({ code: "custom", path: ["endTime"], message: "End time must be after start time" });
  }
  if (v.endTime && v.startTime === null) {
    ctx.addIssue({ code: "custom", path: ["startTime"], message: "Set a start time when an end time is given" });
  }
  if (v.recurrence && v.date === null) {
    ctx.addIssue({ code: "custom", path: ["date"], message: "Recurring tasks need a start date" });
  }
}

export const taskCreateSchema = z
  .object({
    ...taskFields,
    description: taskFields.description.default(""),
    notes: taskFields.notes.default(""),
    kind: taskFields.kind.default("TASK"),
    priority: taskFields.priority.default("MEDIUM"),
    categoryId: taskFields.categoryId.optional(),
    subjectId: taskFields.subjectId.optional(),
    project: taskFields.project.optional(),
    location: taskFields.location.optional(),
    outdoor: taskFields.outdoor.optional(),
    date: taskFields.date.optional(),
    startTime: taskFields.startTime.optional(),
    endTime: taskFields.endTime.optional(),
    deadlineDate: taskFields.deadlineDate.optional(),
    deadlineTime: taskFields.deadlineTime.optional(),
    estimatedMinutes: taskFields.estimatedMinutes.optional(),
    completed: taskFields.completed.default(false),
    recurrence: taskFields.recurrence.optional(),
    reminderMinutes: taskFields.reminderMinutes.optional(),
    sortOrder: taskFields.sortOrder.optional(),
  })
  .strict()
  .superRefine(checkTimes);

export const taskUpdateSchema = z
  .object({
    title: taskFields.title.optional(),
    description: taskFields.description.optional(),
    notes: taskFields.notes.optional(),
    kind: taskFields.kind.optional(),
    priority: taskFields.priority.optional(),
    categoryId: taskFields.categoryId.optional(),
    subjectId: taskFields.subjectId.optional(),
    project: taskFields.project.optional(),
    location: taskFields.location.optional(),
    outdoor: taskFields.outdoor.optional(),
    date: taskFields.date.optional(),
    startTime: taskFields.startTime.optional(),
    endTime: taskFields.endTime.optional(),
    deadlineDate: taskFields.deadlineDate.optional(),
    deadlineTime: taskFields.deadlineTime.optional(),
    estimatedMinutes: taskFields.estimatedMinutes.optional(),
    completed: taskFields.completed.optional(),
    recurrence: taskFields.recurrence.optional(),
    reminderMinutes: taskFields.reminderMinutes.optional(),
    sortOrder: taskFields.sortOrder.optional(),
  })
  .strict();

export const taskPatchRequest = z
  .object({
    changes: taskUpdateSchema,
    /** For recurring tasks: change only this occurrence or the whole series. */
    scope: z.enum(["occurrence", "series"]).default("occurrence"),
    /** Optimistic concurrency: the version the client last saw. */
    version: z.number().int().optional(),
  })
  .strict();

export type TaskCreateInput = z.infer<typeof taskCreateSchema>;
export type TaskUpdateInput = z.infer<typeof taskUpdateSchema>;

export const categorySchema = z
  .object({
    name: z.string().trim().min(1).max(40),
    color: hexColor,
    icon: z.string().max(30).optional(),
  })
  .strict();

export const signupSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    email: z.email().max(200).transform((e) => e.toLowerCase()),
    password: z.string().min(8, "Use at least 8 characters").max(200),
    timezone: z.string().max(64).optional(),
  })
  .strict();

export const loginSchema = z
  .object({
    email: z.email().max(200).transform((e) => e.toLowerCase()),
    password: z.string().min(1).max(200),
  })
  .strict();

export const settingsSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    timezone: z.string().max(64),
    dayStart: timeStr,
    dayEnd: timeStr,
    workDays: z.array(z.number().int().min(0).max(6)).max(7),
    workStart: timeStr,
    workEnd: timeStr,
    bufferMinutes: z.number().int().min(0).max(120),
    maxFocusMinutes: z.number().int().min(30).max(480),
    planningNotes: z.string().max(1000),
    defaultReminderMinutes: z.number().int().min(0).max(1440),
    classReminders: z.boolean(),
    meetingReminders: z.boolean(),
    deadlineReminders: z.boolean(),
    overdueAlerts: z.boolean(),
    dailyPlanNotification: z.boolean(),
    dailyPlanTime: timeStr,
    aiEnabled: z.boolean(),
    weatherLabel: z.string().trim().min(1).max(120).nullable(),
    weatherLat: z.number().min(-90).max(90).nullable(),
    weatherLon: z.number().min(-180).max(180).nullable(),
    weatherUnit: z.enum(["celsius", "fahrenheit"]),
    aiProvider: z.enum(["", "openai", "compatible"]),
    aiModel: z.string().regex(/^[\w.\-:/]{0,80}$/, "Invalid model name"),
    inputPricePerMTok: z.number().min(0).max(1000),
    cachedInputPricePerMTok: z.number().min(0).max(1000),
    outputPricePerMTok: z.number().min(0).max(1000),
    monthlyBudgetUsd: z.number().min(0).max(10000),
    confirmAboveUsd: z.number().min(0).max(100),
  })
  .partial()
  .strict();

export const semesterSchema = z
  .object({ name: z.string().trim().min(1).max(80), startDate: dateStr, endDate: dateStr })
  .strict()
  .refine((v) => v.endDate >= v.startDate, { message: "Semester must end after it starts", path: ["endDate"] });

export const subjectSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    code: z.string().trim().max(30).default(""),
    instructor: z.string().trim().max(100).default(""),
    color: hexColor.default("#6366f1"),
    semesterId: z.string().max(40).nullable().optional(),
  })
  .strict();

export const classSessionSchema = z
  .object({
    subjectId: z.string().max(40),
    semesterId: z.string().max(40),
    weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    startTime: timeStr,
    endTime: timeStr,
    location: z.string().trim().max(200).optional(),
    type: z.string().trim().max(40).default("Lecture"),
    reminderMinutes: z.number().int().min(0).max(1440).optional(),
  })
  .strict()
  .refine((v) => toMinutes(v.endTime) > toMinutes(v.startTime), { message: "End time must be after start time", path: ["endTime"] });

export const lectureNoteSchema = z
  .object({
    subjectId: z.string().max(40),
    title: z.string().trim().min(1).max(200),
    content: z.string().max(50000).default(""),
    date: dateStr.nullable().optional(),
  })
  .strict();

export const rangeQuery = z
  .object({ start: dateStr, end: dateStr })
  .refine((v) => v.end >= v.start, "end must be on or after start");
