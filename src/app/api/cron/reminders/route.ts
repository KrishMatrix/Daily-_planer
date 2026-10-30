import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { runRemindersForAll } from "@/lib/notifications";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Called by Vercel Cron / an external scheduler with `Authorization: Bearer $CRON_SECRET`. */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await runRemindersForAll();
  return NextResponse.json({ ok: true, ...result });
}
