import { authed, json } from "@/lib/http";
import { computeStats } from "@/lib/stats";

export const GET = authed(async (_req, user) => json({ stats: await computeStats(user.id, user.timezone) }));
