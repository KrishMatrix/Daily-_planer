import { destroySession } from "@/lib/auth";
import { json, publicRoute } from "@/lib/http";

export const POST = publicRoute(async () => {
  await destroySession();
  return json({ ok: true });
});
