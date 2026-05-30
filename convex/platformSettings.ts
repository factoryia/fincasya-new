import { v } from 'convex/values';
import { internalMutation, internalQuery, mutation, query } from './_generated/server';
import {
  GLOBAL_PLATFORM_SCOPE,
  isGlobalAiEnabled,
} from './lib/platformAi';
import { setGlobalAiEnabled } from './lib/platformSettingsStore';

export const getAiSettings = query({
  args: {},
  handler: async (ctx) => {
    const aiEnabled = await isGlobalAiEnabled(ctx);
    const row = await ctx.db
      .query('platformSettings')
      .withIndex('by_scope', (q) => q.eq('scope', GLOBAL_PLATFORM_SCOPE))
      .unique();
    return {
      aiEnabled,
      updatedAt: row?.updatedAt ?? null,
      updatedByUserId: row?.updatedByUserId ?? null,
    };
  },
});

export const isAiEnabledInternal = internalQuery({
  args: {},
  handler: async (ctx) => isGlobalAiEnabled(ctx),
});

export const setAiEnabledInternal = internalMutation({
  args: {
    aiEnabled: v.boolean(),
    updatedByUserId: v.optional(v.string()),
  },
  handler: async (ctx, { aiEnabled, updatedByUserId }) =>
    setGlobalAiEnabled(ctx, aiEnabled, updatedByUserId),
});

/** Actualizar interruptor global de IA (autorización en API Nest). */
export const setAiEnabled = mutation({
  args: {
    aiEnabled: v.boolean(),
    updatedByUserId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await setGlobalAiEnabled(ctx, args.aiEnabled, args.updatedByUserId);
    return { aiEnabled: args.aiEnabled };
  },
});
