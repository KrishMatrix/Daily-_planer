import { db } from "@/lib/db";
import { ApiError, authed, json, parseBody } from "@/lib/http";
import { categorySchema } from "@/lib/validation";

export const GET = authed(async (_req, user) => {
  const categories = await db.category.findMany({
    where: { userId: user.id },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true, color: true, icon: true, key: true, sortOrder: true },
  });
  return json({ categories });
});

export const POST = authed(async (req, user) => {
  const body = await parseBody(req, categorySchema);
  const count = await db.category.count({ where: { userId: user.id } });
  if (count >= 40) throw new ApiError(400, "You can have up to 40 categories");
  const dup = await db.category.findFirst({ where: { userId: user.id, name: { equals: body.name, mode: "insensitive" } } });
  if (dup) throw new ApiError(409, "A category with this name already exists");
  const category = await db.category.create({
    data: { ...body, userId: user.id, sortOrder: count },
    select: { id: true, name: true, color: true, icon: true, key: true, sortOrder: true },
  });
  return json({ category }, { status: 201 });
});
