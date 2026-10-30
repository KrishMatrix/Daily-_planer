import { db } from "@/lib/db";
import { ApiError, authed, json, notFound, parseBody } from "@/lib/http";
import { categorySchema } from "@/lib/validation";

export const PATCH = authed<{ id: string }>(async (req, user, { id }) => {
  const body = await parseBody(req, categorySchema.partial());
  const existing = await db.category.findFirst({ where: { id, userId: user.id } });
  if (!existing) throw notFound("Category not found");
  if (body.name && body.name.toLowerCase() !== existing.name.toLowerCase()) {
    const dup = await db.category.findFirst({ where: { userId: user.id, name: { equals: body.name, mode: "insensitive" } } });
    if (dup) throw new ApiError(409, "A category with this name already exists");
  }
  const category = await db.category.update({
    where: { id },
    data: body,
    select: { id: true, name: true, color: true, icon: true, key: true, sortOrder: true },
  });
  return json({ category });
});

// Tasks in a deleted category keep existing and become uncategorised (onDelete: SetNull).
export const DELETE = authed<{ id: string }>(async (_req, user, { id }) => {
  const existing = await db.category.findFirst({ where: { id, userId: user.id } });
  if (!existing) throw notFound("Category not found");
  if (existing.key) throw new ApiError(400, "Built-in categories can be renamed or recoloured but not deleted");
  await db.category.delete({ where: { id } });
  return json({ ok: true });
});
