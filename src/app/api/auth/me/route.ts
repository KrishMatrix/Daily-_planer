import { authed, json } from "@/lib/http";

export const GET = authed(async (_req, user) => json({ user }));
