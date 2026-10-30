import { db } from "@/lib/db";
import { isValidTimeZone } from "@/lib/dates";
import { ApiError, authed, json, parseBody } from "@/lib/http";
import { ensureUserSettings, getSettingsDTO } from "@/lib/users";
import { settingsSchema } from "@/lib/validation";

export const GET = authed(async (_req, user) => json({ settings: await getSettingsDTO(user.id) }));

export const PATCH = authed(async (req, user) => {
  const { name, timezone, ...rest } = await parseBody(req, settingsSchema);
  if (timezone !== undefined && !isValidTimeZone(timezone)) throw new ApiError(400, "Unknown timezone");
  if (name !== undefined || timezone !== undefined) {
    await db.user.update({ where: { id: user.id }, data: { name, timezone } });
  }
  if (Object.keys(rest).length) {
    await ensureUserSettings(user.id);
    await db.userSettings.update({ where: { userId: user.id }, data: rest });
  }
  return json({ settings: await getSettingsDTO(user.id) });
});
