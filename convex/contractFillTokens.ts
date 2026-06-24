import { v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import type { QueryCtx } from './_generated/server';
import { internalMutation, internalQuery, mutation } from './_generated/server';

const MAX_PROPERTY_IMAGES = 12;

async function resolvePropertyId(
  ctx: QueryCtx,
  row: {
    contractDraftJson?: string;
    conversationId?: Id<'conversations'>;
    propertyTitle?: string;
  },
): Promise<Id<'properties'> | null> {
  if (row.contractDraftJson) {
    try {
      const draft = JSON.parse(row.contractDraftJson) as { propertyId?: string };
      if (draft.propertyId) {
        return draft.propertyId as Id<'properties'>;
      }
    } catch {
      // ignore malformed draft
    }
  }

  if (row.conversationId) {
    const conv = await ctx.db.get(row.conversationId);
    const catalogIds = (conv as { lastSentCatalogPropertyIds?: Id<'properties'>[] } | null)
      ?.lastSentCatalogPropertyIds;
    if (catalogIds?.length) {
      return catalogIds[0];
    }
  }

  const title = row.propertyTitle?.trim().toLowerCase();
  if (title) {
    const properties = await ctx.db.query('properties').collect();
    const exact = properties.find((p) => p.title?.trim().toLowerCase() === title);
    if (exact) return exact._id;
    const partial = properties.find((p) => {
      const pt = p.title?.trim().toLowerCase() ?? '';
      return pt.includes(title) || title.includes(pt);
    });
    if (partial) return partial._id;
  }

  return null;
}

async function getPropertyImageUrls(
  ctx: QueryCtx,
  propertyId: Id<'properties'>,
): Promise<string[]> {
  const images = await ctx.db
    .query('propertyImages')
    .withIndex('by_property', (q) => q.eq('propertyId', propertyId))
    .collect();

  return images
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((img) => img.url?.trim())
    .filter((url): url is string => !!url)
    .slice(0, MAX_PROPERTY_IMAGES);
}

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

/** Deal público + fotos de la finca para el formulario de contrato. */
export const getPublicDealByToken = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('contractFillTokens')
      .withIndex('by_token', (q) => q.eq('token', args.token))
      .unique();

    if (!row) return null;

    const propertyId = await resolvePropertyId(ctx, row);
    const propertyImages = propertyId
      ? await getPropertyImageUrls(ctx, propertyId)
      : [];

    return {
      source: row.source ?? 'inbox',
      deal: {
        propertyTitle: row.propertyTitle ?? null,
        propertyLocation: row.propertyLocation ?? null,
        fechaEntrada: row.fechaEntrada ?? null,
        fechaSalida: row.fechaSalida ?? null,
        cupo: row.cupo ?? null,
        precioTotal: row.precioTotal ?? null,
      },
      propertyImages,
      status: row.status,
      expiresAt: row.expiresAt,
    };
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

    // Si hay borrador admin pendiente, actualizar con el nombre completo del link.
    if (row.contractDraftJson) {
      try {
        const draft = JSON.parse(row.contractDraftJson) as {
          contractNumber?: string;
        };
        const code = String(draft.contractNumber ?? '').trim();
        if (code) {
          const snapshots = await ctx.db
            .query('adminContractSnapshots')
            .withIndex('by_contract_number', (q) =>
              q.eq('contractNumber', code),
            )
            .collect();
          for (const snap of snapshots) {
            const p = (snap.payload ?? {}) as Record<string, unknown>;
            await ctx.db.patch(snap._id, {
              payload: {
                ...p,
                nombreCompleto: args.nombre,
                cedula: args.cedula,
                correo: args.email,
                celular: args.telefono,
                address: args.direccion,
                ...(args.ciudad ? { city: args.ciudad } : {}),
              },
            });
          }
        }
      } catch {
        // Borrador sin JSON válido: no bloquea el fill.
      }
    }

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

/** Admin: actualiza las fotos de cédula de un link ya completado. */
export const updateCedulaPhotos = mutation({
  args: {
    fillTokenId: v.id('contractFillTokens'),
    cedulaPhotoUrls: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.fillTokenId);
    if (!row?.filledData) return { ok: false, reason: 'no_filled_data' as const };
    const urls = args.cedulaPhotoUrls
      .map((u) => String(u ?? '').trim())
      .filter(Boolean)
      .slice(0, 2);
    await ctx.db.patch(args.fillTokenId, {
      filledData: {
        ...row.filledData,
        cedulaPhotoUrls: urls.length ? urls : undefined,
      },
    });
    return { ok: true };
  },
});
