import { v } from 'convex/values';
import { internalMutation, internalQuery, mutation, query } from './_generated/server';
import {
  AiChannel,
  GLOBAL_PLATFORM_SCOPE,
  getPlatformSettingsRow,
  isChannelAiEnabled,
  isGlobalAiEnabled,
  resolveChannelAiEnabled,
} from './lib/platformAi';
import {
  setChannelAiEnabled,
  setGlobalAiEnabled,
} from './lib/platformSettingsStore';

function buildAiSettingsResponse(row: Awaited<ReturnType<typeof getPlatformSettingsRow>>) {
  const webAiEnabled = resolveChannelAiEnabled(row, 'web');
  const whatsappAiEnabled = resolveChannelAiEnabled(row, 'whatsapp');
  return {
    aiEnabled: webAiEnabled || whatsappAiEnabled,
    webAiEnabled,
    whatsappAiEnabled,
    updatedAt: row?.updatedAt ?? null,
    updatedByUserId: row?.updatedByUserId ?? null,
  };
}

export const getAiSettings = query({
  args: {},
  handler: async (ctx) => {
    const row = await getPlatformSettingsRow(ctx);
    return buildAiSettingsResponse(row);
  },
});

export const isAiEnabledInternal = internalQuery({
  args: {},
  handler: async (ctx) => isGlobalAiEnabled(ctx),
});

export const isChannelAiEnabledInternal = internalQuery({
  args: {
    channel: v.union(v.literal('whatsapp'), v.literal('web')),
  },
  handler: async (ctx, { channel }) => isChannelAiEnabled(ctx, channel),
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
    const row = await getPlatformSettingsRow(ctx);
    return buildAiSettingsResponse(row);
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// "Solo conversaciones nuevas": cuando está activo, el bot NO responde a
// conversaciones antiguas (las que ya existían); solo a las que se creen de
// ahora en adelante. Las viejas quedan para atención humana. Default = false.
// Activar/desactivar por CLI:
//   bunx convex run platformSettings:setBotOnlyNewConversations '{"enabled":true}'
// ─────────────────────────────────────────────────────────────────────────────

export const isBotOnlyNewConversationsInternal = internalQuery({
  args: {},
  handler: async (ctx): Promise<boolean> => {
    const row = await getPlatformSettingsRow(ctx);
    return row?.botOnlyNewConversations === true;
  },
});

export const setBotOnlyNewConversations = internalMutation({
  args: {
    enabled: v.boolean(),
    updatedByUserId: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { enabled, updatedByUserId },
  ): Promise<{ botOnlyNewConversations: boolean }> => {
    const now = Date.now();
    const existing = await ctx.db
      .query('platformSettings')
      .withIndex('by_scope', (q) => q.eq('scope', GLOBAL_PLATFORM_SCOPE))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        botOnlyNewConversations: enabled,
        updatedAt: now,
        updatedByUserId,
      });
    } else {
      await ctx.db.insert('platformSettings', {
        scope: GLOBAL_PLATFORM_SCOPE,
        aiEnabled: false,
        botOnlyNewConversations: enabled,
        updatedAt: now,
        updatedByUserId,
      });
    }
    return { botOnlyNewConversations: enabled };
  },
});

/** Actualizar IA por canal (autorización en API Nest). */
export const setChannelAiEnabledPublic = mutation({
  args: {
    channel: v.union(v.literal('whatsapp'), v.literal('web')),
    aiEnabled: v.boolean(),
    updatedByUserId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await setChannelAiEnabled(
      ctx,
      args.channel as AiChannel,
      args.aiEnabled,
      args.updatedByUserId,
    );
    const row = await getPlatformSettingsRow(ctx);
    return buildAiSettingsResponse(row);
  },
});
