import { authed, json, parseBody } from "@/lib/http";
import { computeInsights, createTask, getCategoryTasks, getCompletedTasks, getItemsInRange, getOpenTasks } from "@/lib/tasks";
import { rangeQuery, taskCreateSchema } from "@/lib/validation";

export const GET = authed(async (req, user) => {
  const params = req.nextUrl.searchParams;
  if (params.get("view") === "open") return json({ items: await getOpenTasks(user.id) });
  if (params.get("view") === "completed") return json({ items: await getCompletedTasks(user.id) });
  if (params.get("view") === "category") {
    const key = params.get("key") ?? "";
    if (!/^[a-z]{1,20}$/.test(key)) return json({ error: "Invalid category key" }, { status: 400 });
    return json({ items: await getCategoryTasks(user.id, key) });
  }
  const { start, end } = rangeQuery.parse({ start: params.get("start"), end: params.get("end") });
  return json({ items: await getItemsInRange(user.id, start, end) });
});

export const POST = authed(async (req, user) => {
  const input = await parseBody(req, taskCreateSchema);
  const item = await createTask(user.id, input);
  const insights = await computeInsights(user.id, user.timezone, item, null);
  return json({ item, insights }, { status: 201 });
});
