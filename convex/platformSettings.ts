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

/** ¿Está activo el flag? (true = hay un corte configurado). Para verificar. */
export const isBotOnlyNewConversationsInternal = internalQuery({
  args: {},
  handler: async (ctx): Promise<boolean> => {
    const row = await getPlatformSettingsRow(ctx);
    return typeof row?.botOnlyNewConversationsSince === 'number';
  },
});

/** Corte por fecha (ms) o null si está apagado. Lo consulta el bot en inbound. */
export const getBotOnlyNewConversationsCutoffInternal = internalQuery({
  args: {},
  handler: async (ctx): Promise<number | null> => {
    const row = await getPlatformSettingsRow(ctx);
    return typeof row?.botOnlyNewConversationsSince === 'number'
      ? row.botOnlyNewConversationsSince
      : null;
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
  ): Promise<{ enabled: boolean; since: number | null }> => {
    const now = Date.now();
    // enabled → corte = AHORA (solo atiende conversaciones creadas desde ya).
    // disabled → se limpia el corte (flag apagado).
    const since = enabled ? now : undefined;
    const existing = await ctx.db
      .query('platformSettings')
      .withIndex('by_scope', (q) => q.eq('scope', GLOBAL_PLATFORM_SCOPE))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        botOnlyNewConversations: enabled,
        botOnlyNewConversationsSince: since,
        updatedAt: now,
        updatedByUserId,
      });
    } else {
      await ctx.db.insert('platformSettings', {
        scope: GLOBAL_PLATFORM_SCOPE,
        aiEnabled: false,
        botOnlyNewConversations: enabled,
        botOnlyNewConversationsSince: since,
        updatedAt: now,
        updatedByUserId,
      });
    }
    return { enabled, since: since ?? null };
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

// ─────────────────────────────────────────────────────────────────────────────
// KILL-SWITCH de mensajería automática programada (timeline check-in +
// recordatorios de reserva). Origen: incidente del recordatorio a las 4:00 AM
// (2026-07-13). El gate duro vive en `checkinMessaging.runScheduledMoment` y
// en los crons de Nest — esto es solo la configuración.
//
// Keys válidas para el apagado fino: las de `templateCatalog.ts`
// (tourist_departure, tourist_checkin_start, tourist_checkin_pending,
// tourist_travel_tomorrow, owner_arrival_tomorrow, owner_week_reminder) +
// "booking_reminder_email" (recordatorio de reserva por correo, Nest/Brevo).
// ─────────────────────────────────────────────────────────────────────────────

function buildAutomationSettingsResponse(
  row: Awaited<ReturnType<typeof getPlatformSettingsRow>>,
) {
  return {
    /**
     * DEFAULT = APAGADO: solo `true` explícito enciende. Decisión del cliente
     * (2026-07-13): los mensajes automáticos quedan deshabilitados hasta que
     * las plantillas sean revisadas y aprobadas; se encienden desde el panel.
     */
    scheduledMessagingEnabled:
      (row as { scheduledMessagingEnabled?: boolean } | null)
        ?.scheduledMessagingEnabled === true,
    scheduledMessagesDisabled:
      (row as { scheduledMessagesDisabled?: string[] } | null)
        ?.scheduledMessagesDisabled ?? [],
    updatedAt: row?.updatedAt ?? null,
  };
}

/** Config de mensajería automática (para el panel admin, vía API Nest). */
export const getAutomationSettings = query({
  args: {},
  handler: async (ctx) => {
    const row = await getPlatformSettingsRow(ctx);
    return buildAutomationSettingsResponse(row);
  },
});

/** Igual pero interna (para el motor de envíos). */
export const getAutomationSettingsInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const row = await getPlatformSettingsRow(ctx);
    return buildAutomationSettingsResponse(row);
  },
});

/** Switch GLOBAL de mensajes automáticos (autorización en API Nest). */
export const setScheduledMessagingEnabled = mutation({
  args: {
    enabled: v.boolean(),
    updatedByUserId: v.optional(v.string()),
  },
  handler: async (ctx, { enabled, updatedByUserId }) => {
    const now = Date.now();
    const existing = await ctx.db
      .query('platformSettings')
      .withIndex('by_scope', (q) => q.eq('scope', GLOBAL_PLATFORM_SCOPE))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        scheduledMessagingEnabled: enabled,
        updatedAt: now,
        updatedByUserId,
      });
    } else {
      await ctx.db.insert('platformSettings', {
        scope: GLOBAL_PLATFORM_SCOPE,
        aiEnabled: false,
        scheduledMessagingEnabled: enabled,
        updatedAt: now,
        updatedByUserId,
      });
    }
    const row = await getPlatformSettingsRow(ctx);
    return buildAutomationSettingsResponse(row);
  },
});

/** Apagado FINO por tipo de mensaje (autorización en API Nest). */
export const setScheduledMessageTypeDisabled = mutation({
  args: {
    key: v.string(),
    disabled: v.boolean(),
    updatedByUserId: v.optional(v.string()),
  },
  handler: async (ctx, { key, disabled, updatedByUserId }) => {
    const now = Date.now();
    const existing = await ctx.db
      .query('platformSettings')
      .withIndex('by_scope', (q) => q.eq('scope', GLOBAL_PLATFORM_SCOPE))
      .unique();
    const current = new Set(
      ((existing as { scheduledMessagesDisabled?: string[] } | null)
        ?.scheduledMessagesDisabled ?? []) as string[],
    );
    if (disabled) current.add(key.trim());
    else current.delete(key.trim());
    const list = Array.from(current);
    if (existing) {
      await ctx.db.patch(existing._id, {
        scheduledMessagesDisabled: list,
        updatedAt: now,
        updatedByUserId,
      });
    } else {
      await ctx.db.insert('platformSettings', {
        scope: GLOBAL_PLATFORM_SCOPE,
        aiEnabled: false,
        scheduledMessagesDisabled: list,
        updatedAt: now,
        updatedByUserId,
      });
    }
    const row = await getPlatformSettingsRow(ctx);
    return buildAutomationSettingsResponse(row);
  },
});
