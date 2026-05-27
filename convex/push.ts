/**
 * Push notifications vía Expo Push API.
 *
 * - `registerToken` (mutation pública, autenticada): guarda el ExponentPushToken
 *   del dispositivo del usuario logeado.
 * - `notifyInboxStaff` (internalAction): envía un push a TODOS los tokens
 *   registrados (excluyendo opcionalmente al actor) usando https://exp.host.
 */
import { v } from 'convex/values';
import { mutation, internalAction, internalQuery } from './_generated/server';
import { internal, components } from './_generated/api';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/**
 * Registra (o actualiza) el push token del usuario autenticado.
 */
export const registerToken = mutation({
  args: {
    token: v.string(),
    platform: v.optional(v.union(v.literal('ios'), v.literal('android'))),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error('NOT_AUTHENTICATED');

    const now = Date.now();
    // Si ya existe, actualizar
    const existing = await ctx.db
      .query('pushTokens')
      .withIndex('by_token', (q) => q.eq('token', args.token))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        userId: identity.subject,
        platform: args.platform,
        updatedAt: now,
      });
      return { ok: true, updated: true, id: existing._id };
    }

    const id = await ctx.db.insert('pushTokens', {
      userId: identity.subject,
      token: args.token,
      platform: args.platform,
      createdAt: now,
      updatedAt: now,
    });
    return { ok: true, updated: false, id };
  },
});

/**
 * Devuelve todos los push tokens del staff (usuarios admin/asesor/vendedor),
 * opcionalmente excluyendo a un usuario (el que disparó la acción).
 */
export const listStaffTokens = internalQuery({
  args: {
    excludeUserId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Lista usuarios staff
    const all = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'user',
      paginationOpts: { numItems: 500, cursor: null },
    } as any)) as { page: Array<{ _id: string; role?: string }> };

    const staffIds = new Set(
      all.page
        .filter((u) =>
          ['admin', 'vendedor', 'asesor_limitado', 'contabilidad'].includes(
            u.role ?? '',
          ),
        )
        .map((u) => u._id),
    );
    if (args.excludeUserId) staffIds.delete(args.excludeUserId);

    const tokens: string[] = [];
    for (const uid of staffIds) {
      const userTokens = await ctx.db
        .query('pushTokens')
        .withIndex('by_user', (q) => q.eq('userId', uid))
        .collect();
      for (const t of userTokens) tokens.push(t.token);
    }
    return tokens;
  },
});

/**
 * Envía notificación push a todo el staff. Usado desde mutaciones internas
 * cuando entra un mensaje del cliente o cuando se escala a humano.
 */
export const notifyInboxStaff = internalAction({
  args: {
    title: v.string(),
    body: v.string(),
    /** datos adicionales (ej: conversationId) para deep-link */
    data: v.optional(v.any()),
    /** Excluir un usuario (ej: el que hizo el cambio) */
    excludeUserId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ sent: number; skipped: number }> => {
    const tokens: string[] = await ctx.runQuery(internal.push.listStaffTokens, {
      excludeUserId: args.excludeUserId,
    });

    if (tokens.length === 0) {
      return { sent: 0, skipped: 0 };
    }

    // Batch de hasta 100 mensajes por request (Expo soporta más, pero
    // mantenerlo simple).
    const messages = tokens.map((to) => ({
      to,
      sound: 'default',
      title: args.title,
      body: args.body,
      data: args.data ?? {},
      priority: 'high',
      channelId: 'default',
    }));

    let sent = 0;
    let skipped = 0;
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Accept-Encoding': 'gzip, deflate',
        },
        body: JSON.stringify(messages),
      });
      if (!res.ok) {
        console.warn('[push] Expo Push API error', res.status, await res.text());
        return { sent: 0, skipped: tokens.length };
      }
      sent = tokens.length;
    } catch (e) {
      console.warn('[push] notify error', e);
      skipped = tokens.length;
    }
    return { sent, skipped };
  },
});
