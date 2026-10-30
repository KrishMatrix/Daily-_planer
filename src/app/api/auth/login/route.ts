import { burnPasswordCheck, createSession, verifyPassword } from "@/lib/auth";
import { db } from "@/lib/db";
import { ApiError, clientIp, json, parseBody, publicRoute } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { loginSchema } from "@/lib/validation";

export const POST = publicRoute(async (req) => {
  const body = await parseBody(req, loginSchema);
  await rateLimit(`login:ip:${clientIp(req)}`, 30, 900);
  await rateLimit(`login:email:${body.email}`, 10, 900);
  const user = await db.user.findUnique({ where: { email: body.email } });
  if (!user) {
    await burnPasswordCheck(body.password);
    throw new ApiError(401, "Incorrect email or password");
  }
  if (!(await verifyPassword(body.password, user.passwordHash))) throw new ApiError(401, "Incorrect email or password");
  await createSession(user.id, req.headers.get("user-agent"));
  return json({ ok: true });
});
