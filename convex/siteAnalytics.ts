import { v } from 'convex/values';
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from './_generated/server';

function monthKey(ts = Date.now()): string {
  const d = new Date(ts);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function prevMonthKey(ts = Date.now()): string {
  const d = new Date(ts);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return monthKey(d.getTime());
}

async function incrementMetric(ctx: MutationCtx, key: string, delta = 1) {
  const existing = await ctx.db
    .query('siteAnalytics')
    .withIndex('by_metricKey', (q) => q.eq('metricKey', key))
    .first();
  const now = Date.now();
  if (existing) {
    await ctx.db.patch(existing._id, {
      count: existing.count + delta,
      updatedAt: now,
    });
    return existing.count + delta;
  }
  await ctx.db.insert('siteAnalytics', {
    metricKey: key,
    count: delta,
    updatedAt: now,
  });
  return delta;
}

async function getMetricCount(ctx: QueryCtx, key: string): Promise<number> {
  const row = await ctx.db
    .query('siteAnalytics')
    .withIndex('by_metricKey', (q) => q.eq('metricKey', key))
    .first();
  return row?.count ?? 0;
}

export const recordPageView = internalMutation({
  args: {
    path: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    void args.path;
    const currentMonth = monthKey();
    await incrementMetric(ctx, 'total');
    await incrementMetric(ctx, `month:${currentMonth}`);
    return { ok: true };
  },
});

export const getDashboardStats = internalQuery({
  args: {},
  handler: async (ctx) => {
    const currentMonth = monthKey();
    const previousMonth = prevMonthKey();
    const totalViews = await getMetricCount(ctx, 'total');
    const monthViews = await getMetricCount(ctx, `month:${currentMonth}`);
    const prevMonthViews = await getMetricCount(ctx, `month:${previousMonth}`);

    const monthGrowth =
      prevMonthViews > 0
        ? ((monthViews - prevMonthViews) / prevMonthViews) * 100
        : monthViews > 0
          ? 100
          : 0;

    return {
      totalViews,
      monthViews,
      prevMonthViews,
      monthGrowth,
      monthLabel: currentMonth,
    };
  },
});
