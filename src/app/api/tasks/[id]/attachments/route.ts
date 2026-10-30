import { z } from "zod";
import { db } from "@/lib/db";
import { ApiError, authed, json, notFound } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { parseItemId } from "@/lib/tasks";

const MAX_BYTES = 4 * 1024 * 1024; // stays under Vercel's 4.5 MB request body limit
const ALLOWED = /^(image\/(png|jpeg|gif|webp|heic)|application\/pdf|text\/plain|text\/markdown|text\/csv|application\/(msword|vnd\.openxmlformats-officedocument\.[\w.]+|vnd\.ms-[\w.]+|zip))$/;

const linkSchema = z.object({ url: z.url().max(2000).refine((u) => /^https?:\/\//.test(u), "Only http(s) links"), filename: z.string().trim().min(1).max(200) }).strict();

async function ownedTask(userId: string, id: string) {
  const { taskId } = parseItemId(decodeURIComponent(id));
  const task = await db.task.findFirst({ where: { id: taskId, userId }, select: { id: true } });
  if (!task) throw notFound("Task not found");
  return task;
}

export const GET = authed<{ id: string }>(async (_req, user, { id }) => {
  const task = await ownedTask(user.id, id);
  const attachments = await db.attachment.findMany({
    where: { taskId: task.id, userId: user.id },
    select: { id: true, filename: true, mimeType: true, size: true, url: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  return json({ attachments });
});

export const POST = authed<{ id: string }>(async (req, user, { id }) => {
  await rateLimit(`upload:${user.id}`, 30, 3600);
  const task = await ownedTask(user.id, id);
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const body = linkSchema.parse(await req.json());
    const a = await db.attachment.create({
      data: { userId: user.id, taskId: task.id, filename: body.filename, mimeType: "text/uri-list", size: 0, url: body.url },
      select: { id: true, filename: true, mimeType: true, size: true, url: true, createdAt: true },
    });
    return json({ attachment: a }, { status: 201 });
  }
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new ApiError(400, "No file uploaded");
  if (file.size > MAX_BYTES) throw new ApiError(413, "Files must be 4 MB or smaller");
  if (!ALLOWED.test(file.type)) throw new ApiError(415, "This file type isn't supported");
  const a = await db.attachment.create({
    data: {
      userId: user.id,
      taskId: task.id,
      filename: file.name.slice(0, 200) || "file",
      mimeType: file.type,
      size: file.size,
      data: Buffer.from(await file.arrayBuffer()),
    },
    select: { id: true, filename: true, mimeType: true, size: true, url: true, createdAt: true },
  });
  return json({ attachment: a }, { status: 201 });
});
