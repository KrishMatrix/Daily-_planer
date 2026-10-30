import "server-only";
import { db } from "./db";
import { DEFAULT_CATEGORIES } from "./defaults";
import type { SettingsDTO } from "./types";

export async function ensureUserSettings(userId: string) {
  return db.userSettings.upsert({ where: { userId }, update: {}, create: { userId } });
}

export async function createUserWithDefaults(data: { email: string; name: string; passwordHash: string; timezone: string }) {
  return db.$transaction(async (tx) => {
    const user = await tx.user.create({ data });
    await tx.userSettings.create({ data: { userId: user.id } });
    await tx.category.createMany({
      data: DEFAULT_CATEGORIES.map((c, i) => ({ ...c, userId: user.id, sortOrder: i })),
    });
    return user;
  });
}

export async function getSettingsDTO(userId: string): Promise<SettingsDTO> {
  const [user, s] = await Promise.all([db.user.findUniqueOrThrow({ where: { id: userId } }), ensureUserSettings(userId)]);
  return {
    name: user.name,
    email: user.email,
    timezone: user.timezone,
    dayStart: s.dayStart,
    dayEnd: s.dayEnd,
    workDays: s.workDays,
    workStart: s.workStart,
    workEnd: s.workEnd,
    bufferMinutes: s.bufferMinutes,
    maxFocusMinutes: s.maxFocusMinutes,
    planningNotes: s.planningNotes,
    defaultReminderMinutes: s.defaultReminderMinutes,
    classReminders: s.classReminders,
    meetingReminders: s.meetingReminders,
    deadlineReminders: s.deadlineReminders,
    overdueAlerts: s.overdueAlerts,
    dailyPlanNotification: s.dailyPlanNotification,
    dailyPlanTime: s.dailyPlanTime,
    weatherLabel: s.weatherLabel,
    weatherLat: s.weatherLat,
    weatherLon: s.weatherLon,
    weatherUnit: s.weatherUnit === "fahrenheit" ? "fahrenheit" : "celsius",
    aiEnabled: s.aiEnabled,
    aiProvider: s.aiProvider === "compatible" || s.aiProvider === "openai" ? s.aiProvider : "",
    aiModel: s.aiModel,
    inputPricePerMTok: s.inputPricePerMTok,
    cachedInputPricePerMTok: s.cachedInputPricePerMTok,
    outputPricePerMTok: s.outputPricePerMTok,
    monthlyBudgetUsd: s.monthlyBudgetUsd,
    confirmAboveUsd: s.confirmAboveUsd,
  };
}
