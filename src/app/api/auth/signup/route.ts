import { createSession, hashPassword } from "@/lib/auth";
import { db } from "@/lib/db";
import { isValidTimeZone } from "@/lib/dates";
import { ApiError, clientIp, json, parseBody, publicRoute } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { createUserWithDefaults } from "@/lib/users";
import { signupSchema } from "@/lib/validation";

export const POST = publicRoute(async (req) => {
  if (process.env.ALLOW_SIGNUP === "false") throw new ApiError(403, "Sign-ups are closed on this deployment.");
  await rateLimit(`signup:${clientIp(req)}`, 5, 3600);
  const body = await parseBody(req, signupSchema);
  const existing = await db.user.findUnique({ where: { email: body.email }, select: { id: true } });
  if (existing) throw new ApiError(409, "An account with this email already exists. Try signing in.");
  const user = await createUserWithDefaults({
    email: body.email,
    name: body.name,
    passwordHash: await hashPassword(body.password),
    timezone: body.timezone && isValidTimeZone(body.timezone) ? body.timezone : "Europe/Berlin",
  });
  await createSession(user.id, req.headers.get("user-agent"));
  return json({ ok: true }, { status: 201 });
});
