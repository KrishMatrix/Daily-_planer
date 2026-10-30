import { db } from "@/lib/db";
import { authed, json, notFound } from "@/lib/http";

export const GET = authed<{ id: string }>(async (_req, user, { id }) => {
  const a = await db.attachment.findFirst({ where: { id, userId: user.id } });
  if (!a || !a.data) throw notFound("Attachment not found");
  return new Response(new Uint8Array(a.data), {
    headers: {
      "Content-Type": a.mimeType,
      "Content-Length": String(a.size),
      // Force download so uploaded HTML/SVG can never execute in our origin.
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(a.filename)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
});

export const DELETE = authed<{ id: string }>(async (_req, user, { id }) => {
  const res = await db.attachment.deleteMany({ where: { id, userId: user.id } });
  if (!res.count) throw notFound("Attachment not found");
  return json({ ok: true });
});
