import { authed, json } from "@/lib/http";
import { duplicateItem } from "@/lib/tasks";

export const POST = authed<{ id: string }>(async (_req, user, { id }) => {
  const item = await duplicateItem(user.id, decodeURIComponent(id));
  return json({ item }, { status: 201 });
});
