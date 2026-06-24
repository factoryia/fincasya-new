import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';

const TTL_MS = 48 * 60 * 60 * 1000; // 48 horas

/** Crea un token nuevo (o reutiliza el pending vigente) para la conversación. */
export const createToken = internalMutation({
  args: {
    conversationId: v.id('conversations'),
    propertyTitle: v.optional(v.string()),
    propertyLocation: v.optional(v.string()),
    fechaEntrada: v.optional(v.string()),
    fechaSalida: v.optional(v.string()),
    cupo: v.optional(v.number()),
    precioTotal: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Reutilizar si hay uno pendiente sin expirar
    const existing = await ctx.db
      .query('contractFillTokens')
      .withIndex('by_conversation', (q) => q.eq('conversationId', args.conversationId))
      .order('desc')
      .first();

    if (existing && existing.status === 'pending' && existing.expiresAt > now) {
      await ctx.db.patch(existing._id, {
        propertyTitle: args.propertyTitle,
        propertyLocation: args.propertyLocation,
        fechaEntrada: args.fechaEntrada,
        fechaSalida: args.fechaSalida,
        cupo: args.cupo,
        precioTotal: args.precioTotal,
        expiresAt: now + TTL_MS,
      });
      return { token: existing.token, isNew: false };
    }

    // Genera token hex aleatorio de 36 chars
    const rawBytes = new Uint8Array(18);
    crypto.getRandomValues(rawBytes);
    const token = Array.from(rawBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    await ctx.db.insert('contractFillTokens', {
      token,
      conversationId: args.conversationId,
      source: 'inbox',
      propertyTitle: args.propertyTitle,
      propertyLocation: args.propertyLocation,
      fechaEntrada: args.fechaEntrada,
      fechaSalida: args.fechaSalida,
      cupo: args.cupo,
      precioTotal: args.precioTotal,
      expiresAt: now + TTL_MS,
      status: 'pending',
      createdAt: now,
    });

    return { token, isNew: true };
  },
});

/** Devuelve el registro por token (para el GET público del form). */
export const getByToken = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    return ctx.db
      .query('contractFillTokens')
      .withIndex('by_token', (q) => q.eq('token', args.token))
      .unique();
  },
});

/** Guarda los datos del cliente y marca como filled. */
export const fillToken = internalMutation({
  args: {
    token: v.string(),
    nombre: v.string(),
    cedula: v.string(),
    email: v.string(),
    telefono: v.string(),
    direccion: v.string(),
    ciudad: v.optional(v.string()),
    cedulaPhotoUrls: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('contractFillTokens')
      .withIndex('by_token', (q) => q.eq('token', args.token))
      .unique();

    if (!row) return { ok: false, reason: 'not_found' as const };
    if (row.status === 'filled') return { ok: false, reason: 'already_filled' as const };
    if (row.status === 'expired' || row.expiresAt < Date.now()) {
      await ctx.db.patch(row._id, { status: 'expired' });
      return { ok: false, reason: 'expired' as const };
    }

    await ctx.db.patch(row._id, {
      status: 'filled',
      filledData: {
        nombre: args.nombre,
        cedula: args.cedula,
        email: args.email,
        telefono: args.telefono,
        direccion: args.direccion,
        ciudad: args.ciudad,
        cedulaPhotoUrls: args.cedulaPhotoUrls,
        filledAt: Date.now(),
      },
    });

    return {
      ok: true,
      conversationId: row.conversationId,
      source: row.source ?? 'inbox',
    };
  },
});

/** Crea un link de contrato standalone desde el panel admin (sin conversación). */
export const createAdminToken = internalMutation({
  args: {
    contractDraftJson: v.string(),
    contractSettingsJson: v.string(),
    propertyMetaJson: v.string(),
    propertyTitle: v.optional(v.string()),
    propertyLocation: v.optional(v.string()),
    fechaEntrada: v.optional(v.string()),
    fechaSalida: v.optional(v.string()),
    cupo: v.optional(v.number()),
    precioTotal: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const rawBytes = new Uint8Array(18);
    crypto.getRandomValues(rawBytes);
    const token = Array.from(rawBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    await ctx.db.insert('contractFillTokens', {
      token,
      source: 'admin',
      contractDraftJson: args.contractDraftJson,
      contractSettingsJson: args.contractSettingsJson,
      propertyMetaJson: args.propertyMetaJson,
      propertyTitle: args.propertyTitle,
      propertyLocation: args.propertyLocation,
      fechaEntrada: args.fechaEntrada,
      fechaSalida: args.fechaSalida,
      cupo: args.cupo,
      precioTotal: args.precioTotal,
      expiresAt: now + TTL_MS,
      status: 'pending',
      createdAt: now,
    });

    return { token };
  },
});
