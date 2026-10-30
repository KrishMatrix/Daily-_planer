import { authed, json } from "@/lib/http";
import { runRemindersForUser } from "@/lib/notifications";
import { rateLimit } from "@/lib/rate-limit";

/**
 * While the app is open, the client calls this every minute so reminders
 * appear even if no server cron is configured. Push (app closed) needs the cron.
 */
export const POST = authed(async (_req, user) => {
  await rateLimit(`notif-check:${user.id}`, 20, 60);
  const created = await runRemindersForUser(user);
  return json({ created });
});
