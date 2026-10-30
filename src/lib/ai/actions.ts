import "server-only";
import { z } from "zod";
import { db } from "../db";
import { ApiError, notFound } from "../http";
import { isFixedKind } from "../scheduler";
import { createTask, deleteItem, getItemsInRange, parseItemId, toItem, updateItem } from "../tasks";
import { dateStr, kindEnum, priorityEnum, taskCreateSchema, taskUpdateSchema, timeStr } from "../validation";
import type { ScheduleItem } from "../types";
import { toMinutes } from "../dates";

// Proposed changes from the AI. Nothing here runs until the user presses Accept,
// and every action is re-validated against the user's own data at that moment.

const reason = z.string().max(300).optional();

export const proposedActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("create_task"),
    title: z.string().trim().min(1).max(200),
    kind: kindEnum.optional(),
    priority: priorityEnum.optional(),
    category: z.string().max(40).optional(),
    date: dateStr.optional(),
    start_time: timeStr.optional(),
    end_time: timeStr.optional(),
    deadline_date: dateStr.optional(),
    estimated_minutes: z.number().int().min(5).max(1440).optional(),
    description: z.string().max(1000).optional(),
    outdoor: z.boolean().optional(),
    reason,
  }),
  z.object({
    type: z.literal("update_task"),
    task_id: z.string().min(1).max(80),
    title: z.string().trim().min(1).max(200).optional(),
    date: dateStr.nullable().optional(),
    start_time: timeStr.nullable().optional(),
    end_time: timeStr.nullable().optional(),
    deadline_date: dateStr.nullable().optional(),
    priority: priorityEnum.optional(),
    estimated_minutes: z.number().int().min(5).max(1440).optional(),
    description: z.string().max(1000).optional(),
    reason,
  }),
  z.object({
    type: z.literal("reschedule_task"),
    task_id: z.string().min(1).max(80),
    date: dateStr.nullable(),
    start_time: timeStr.nullable().optional(),
    end_time: timeStr.nullable().optional(),
    reason,
  }),
  z.object({ type: z.literal("complete_task"), task_id: z.string().min(1).max(80), reason }),
  z.object({ type: z.literal("delete_task"), task_id: z.string().min(1).max(80), reason }),
]);

export type ProposedAction = z.infer<typeof proposedActionSchema>;

type Snapshot = { title: string; date: string | null; startTime: string | null; endTime: string | null; deadlineDate: string | null; priority: string; completed: boolean };

export type StoredAction = {
  type: ProposedAction["type"];
  itemId?: string;
  version?: number;
  /** Payload for createTask / updateItem. */
  data: Record<string, unknown>;
  preview: { title: string; before?: Snapshot; after: Snapshot | null; reason?: string; important?: boolean };
};

export type ProposalDTO = { id: string; summary: string; status: string; actions: StoredAction[]; createdAt: string; result?: unknown };

const snap = (i: ScheduleItem): Snapshot => ({
  title: i.title,
  date: i.date,
  startTime: i.startTime,
  endTime: i.endTime,
  deadlineDate: i.deadlineDate,
  priority: i.priority,
  completed: i.completed,
});

async function loadItem(userId: string, itemId: string): Promise<ScheduleItem> {
  const { taskId, occurrenceDate } = parseItemId(itemId);
  if (occurrenceDate) {
    const items = await getItemsInRange(userId, occurrenceDate, occurrenceDate);
    const found = items.find((i) => i.id === itemId);
    if (found) return found;
  }
  const task = await db.task.findFirst({
    where: { id: taskId, userId },
    include: {
      category: { select: { id: true, name: true, color: true, key: true } },
      subject: { select: { id: true, name: true, color: true, code: true } },
      _count: { select: { attachments: true } },
    },
  });
  if (!task) throw new ApiError(400, `Task ${itemId} not found`);
  return toItem(task);
}

const endAfterStart = (s?: string | null, e?: string | null) => !s || !e || toMinutes(e) > toMinutes(s);

export async function createProposal(userId: string, summary: string, rawActions: unknown[]): Promise<ProposalDTO> {
  if (!Array.isArray(rawActions) || rawActions.length === 0) throw new ApiError(400, "No actions proposed");
  if (rawActions.length > 25) throw new ApiError(400, "Too many actions in one proposal (max 25)");
  return saveProposal(userId, summary, await prepareActions(userId, rawActions));
}

export async function saveProposal(userId: string, summary: string, stored: StoredAction[]): Promise<ProposalDTO> {
  if (!stored.length) throw new ApiError(400, "The proposal didn't contain any changes");
  if (stored.length > 25) throw new ApiError(400, "Too many actions in one proposal (max 25)");
  const p = await db.aiProposal.create({ data: { userId, summary: summary.slice(0, 500), actions: stored as unknown as object } });
  return { id: p.id, summary: p.summary, status: p.status, actions: stored, createdAt: p.createdAt.toISOString() };
}

/** Validate proposed actions against the user's own data and build previews. Nothing is written. */
export async function prepareActions(userId: string, rawActions: unknown[]): Promise<StoredAction[]> {
  const categories = await db.category.findMany({ where: { userId }, select: { id: true, name: true, key: true } });
  const findCategory = (name?: string) => {
    if (!name) return null;
    const n = name.toLowerCase();
    return categories.find((c) => c.name.toLowerCase() === n || c.key === n)?.id ?? categories.find((c) => c.key === "other")?.id ?? null;
  };

  if (rawActions.length > 25) throw new ApiError(400, "Too many actions in one proposal (max 25)");
  const stored: StoredAction[] = [];
  for (const raw of rawActions) {
    const a = proposedActionSchema.parse(raw);
    if (a.type === "create_task") {
      if (!endAfterStart(a.start_time, a.end_time)) throw new ApiError(400, `End time must be after start for "${a.title}"`);
      const data = {
        title: a.title,
        kind: a.kind ?? "TASK",
        priority: a.priority ?? "MEDIUM",
        categoryId: findCategory(a.category),
        date: a.date ?? null,
        startTime: a.start_time ?? null,
        endTime: a.start_time
          ? (a.end_time ?? (() => {
              const end = Math.min(toMinutes(a.start_time) + (a.estimated_minutes ?? 60), 23 * 60 + 59);
              return `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
            })())
          : null,
        deadlineDate: a.deadline_date ?? null,
        estimatedMinutes: a.estimated_minutes ?? null,
        description: a.description ?? "",
        outdoor: a.outdoor ?? false,
      };
      stored.push({
        type: a.type,
        data,
        preview: {
          title: a.title,
          reason: a.reason,
          after: { title: a.title, date: data.date, startTime: data.startTime, endTime: data.endTime, deadlineDate: data.deadlineDate, priority: data.priority, completed: false },
        },
      });
    } else {
      const item = await loadItem(userId, a.task_id);
      const before = snap(item);
      const version = item.occurrenceDate ? undefined : item.version;
      if (a.type === "complete_task") {
        stored.push({ type: a.type, itemId: item.id, version, data: { completed: true }, preview: { title: item.title, before, after: { ...before, completed: true }, reason: a.reason } });
        continue;
      }
      if (a.type === "delete_task") {
        // Recurring items: only this occurrence. Classes, meetings and exams are flagged so the user looks twice.
        stored.push({ type: a.type, itemId: item.id, version, data: {}, preview: { title: item.title, before, after: null, reason: a.reason, important: isFixedKind(item.kind) || item.priority === "URGENT" } });
        continue;
      }
      const data: Record<string, unknown> = {};
      if (a.type === "update_task" && a.title !== undefined) data.title = a.title;
      if (a.date !== undefined) data.date = a.date;
      if (a.start_time !== undefined) data.startTime = a.start_time;
      if (a.end_time !== undefined) data.endTime = a.end_time;
      if (a.type === "update_task") {
        if (a.deadline_date !== undefined) data.deadlineDate = a.deadline_date;
        if (a.priority !== undefined) data.priority = a.priority;
        if (a.estimated_minutes !== undefined) data.estimatedMinutes = a.estimated_minutes;
        if (a.description !== undefined) data.description = a.description;
      }
      if (a.type === "reschedule_task" && a.date === null) {
        data.startTime = null;
        data.endTime = null;
      }
      if (data.startTime && !("endTime" in data)) {
        // Keep the existing duration when only the start moves.
        const dur = item.startTime && item.endTime ? toMinutes(item.endTime) - toMinutes(item.startTime) : (item.estimatedMinutes ?? 60);
        const end = Math.min(toMinutes(data.startTime as string) + dur, 23 * 60 + 59);
        data.endTime = `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
      }
      const after: Snapshot = {
        ...before,
        title: (data.title as string) ?? before.title,
        date: "date" in data ? (data.date as string | null) : before.date,
        startTime: "startTime" in data ? (data.startTime as string | null) : before.startTime,
        endTime: "endTime" in data ? (data.endTime as string | null) : before.endTime,
        deadlineDate: "deadlineDate" in data ? (data.deadlineDate as string | null) : before.deadlineDate,
        priority: (data.priority as string) ?? before.priority,
      };
      if (!endAfterStart(after.startTime, after.endTime)) throw new ApiError(400, `End time must be after start for "${item.title}"`);
      if (!Object.keys(data).length) continue;
      if (item.recurrence && item.occurrenceDate === null && ("date" in data || "startTime" in data)) {
        throw new ApiError(400, `"${item.title}" is a repeating series — pass the id of one occurrence (id@YYYY-MM-DD) to move it.`);
      }
      stored.push({ type: a.type, itemId: item.id, version, data, preview: { title: item.title, before, after, reason: a.reason, important: a.type === "reschedule_task" && isFixedKind(item.kind) } });
    }
  }
  return stored;
}

const PROPOSAL_TTL_MS = 24 * 3_600_000;

export async function acceptProposal(userId: string, id: string, selected?: number[]) {
  const p = await db.aiProposal.findFirst({ where: { id, userId } });
  if (!p) throw notFound("Proposal not found");
  if (p.status !== "PENDING") throw new ApiError(409, `This proposal was already ${p.status.toLowerCase()}.`);
  if (Date.now() - p.createdAt.getTime() > PROPOSAL_TTL_MS) throw new ApiError(410, "This proposal has expired. Ask the assistant again for fresh suggestions.");
  // Claim it atomically so a double-click can't apply it twice.
  const claimed = await db.aiProposal.updateMany({ where: { id, userId, status: "PENDING" }, data: { status: "ACCEPTED", resolvedAt: new Date() } });
  if (!claimed.count) throw new ApiError(409, "This proposal was already handled.");

  const actions = p.actions as unknown as StoredAction[];
  const results: { index: number; ok: boolean; message: string }[] = [];
  for (const [index, a] of actions.entries()) {
    if (selected && !selected.includes(index)) {
      results.push({ index, ok: false, message: "Skipped" });
      continue;
    }
    try {
      if (a.type === "create_task") {
        await createTask(userId, taskCreateSchema.parse(a.data));
      } else if (a.type === "delete_task") {
        await deleteItem(userId, a.itemId!, "occurrence");
      } else {
        await updateItem(userId, a.itemId!, taskUpdateSchema.parse(a.data), "occurrence", a.version);
      }
      results.push({ index, ok: true, message: "Applied" });
    } catch (e) {
      const msg = e instanceof ApiError ? (e.status === 409 ? "Changed elsewhere since the suggestion — skipped" : e.message) : "Failed";
      results.push({ index, ok: false, message: msg });
    }
  }
  await db.aiProposal.update({ where: { id }, data: { result: results } });
  return { results };
}

export async function rejectProposal(userId: string, id: string) {
  const res = await db.aiProposal.updateMany({ where: { id, userId, status: "PENDING" }, data: { status: "REJECTED", resolvedAt: new Date() } });
  if (!res.count) throw new ApiError(409, "This proposal was already handled.");
}
