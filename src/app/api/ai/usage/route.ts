import { db } from "@/lib/db";
import { authed, json } from "@/lib/http";

export const GET = authed(async (_req, user) => {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const since30 = new Date(Date.now() - 30 * 86_400_000);
  const [month, byFeature, recent, last30] = await Promise.all([
    db.aiUsage.aggregate({
      where: { userId: user.id, createdAt: { gte: monthStart } },
      _sum: { costUsd: true, promptTokens: true, cachedTokens: true, completionTokens: true },
      _count: true,
    }),
    db.aiUsage.groupBy({
      by: ["feature"],
      where: { userId: user.id, createdAt: { gte: monthStart } },
      _sum: { costUsd: true, promptTokens: true, completionTokens: true },
      _count: true,
    }),
    db.aiUsage.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 15 }),
    db.aiUsage.findMany({ where: { userId: user.id, createdAt: { gte: since30 } }, select: { createdAt: true, costUsd: true } }),
  ]);
  const daily: Record<string, number> = {};
  for (const r of last30) {
    const d = r.createdAt.toISOString().slice(0, 10);
    daily[d] = (daily[d] ?? 0) + r.costUsd;
  }
  return json({
    month: {
      requests: month._count,
      costUsd: month._sum.costUsd ?? 0,
      promptTokens: month._sum.promptTokens ?? 0,
      cachedTokens: month._sum.cachedTokens ?? 0,
      completionTokens: month._sum.completionTokens ?? 0,
    },
    byFeature: byFeature.map((f) => ({ feature: f.feature, requests: f._count, costUsd: f._sum.costUsd ?? 0, tokens: (f._sum.promptTokens ?? 0) + (f._sum.completionTokens ?? 0) })),
    daily,
    recent: recent.map((r) => ({ id: r.id, feature: r.feature, model: r.model, tokens: r.promptTokens + r.completionTokens, costUsd: r.costUsd, createdAt: r.createdAt })),
  });
});
