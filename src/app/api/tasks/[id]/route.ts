import { authed, json, parseBody } from "@/lib/http";
import { computeInsights, deleteItem, updateItem } from "@/lib/tasks";
import { taskPatchRequest } from "@/lib/validation";

type P = { id: string };

export const PATCH = authed<P>(async (req, user, { id }) => {
  const body = await parseBody(req, taskPatchRequest);
  const { item, previousDate } = await updateItem(user.id, decodeURIComponent(id), body.changes, body.scope, body.version);
  const touchesSchedule = ["date", "startTime", "endTime"].some((k) => k in body.changes);
  const insights = touchesSchedule ? await computeInsights(user.id, user.timezone, item, previousDate) : [];
  return json({ item, insights });
});

export const DELETE = authed<P>(async (req, user, { id }) => {
  const scope = req.nextUrl.searchParams.get("scope") === "series" ? "series" : "occurrence";
  await deleteItem(user.id, decodeURIComponent(id), scope);
  return json({ ok: true });
});
