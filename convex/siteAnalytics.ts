import { v } from 'convex/values';
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from './_generated/server';

/** Mes calendario en Colombia (dashboard y visitas reales del sitio). */
function bogotaYearMonth(ts: number): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(new Date(ts));
  return {
    year: Number(parts.find((p) => p.type === 'year')?.value ?? 1970),
    month: Number(parts.find((p) => p.type === 'month')?.value ?? 1),
  };
}

function monthKey(ts = Date.now()): string {
  const { year, month } = bogotaYearMonth(ts);
  return `${year}-${String(month).padStart(2, '0')}`;
}

function prevMonthKey(ts = Date.now()): string {
  const { year, month } = bogotaYearMonth(ts);
  const d = new Date(year, month - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
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
    await incrementMetric(ctx, `month:${currentMonth}`);
    return { ok: true };
  },
});

export const getDashboardStats = internalQuery({
  args: {},
  handler: async (ctx) => {
    const currentMonth = monthKey();
    const previousMonth = prevMonthKey();
    const monthViews = await getMetricCount(ctx, `month:${currentMonth}`);
    const prevMonthViews = await getMetricCount(ctx, `month:${previousMonth}`);

    const monthGrowth =
      prevMonthViews > 0
        ? ((monthViews - prevMonthViews) / prevMonthViews) * 100
        : monthViews > 0
          ? 100
          : 0;

    return {
      monthViews,
      prevMonthViews,
      monthGrowth,
      monthLabel: currentMonth,
    };
  },
});
