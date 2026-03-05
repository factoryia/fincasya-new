import { v } from 'convex/values'; // Re-sync trigger
import { query, mutation } from './_generated/server';

// ============ QUERIES ============

/**
 * Listar todas las features del catálogo
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const features = await ctx.db.query('featureCatalog').collect();
    return features;
  },
});

/**
 * Obtener una feature por ID
 */
export const getById = query({
  args: { id: v.id('featureCatalog') },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

// ============ MUTATIONS ============

/**
 * Crear una feature en el catálogo
 */
export const create = mutation({
  args: {
    name: v.optional(v.string()),
    iconUrl: v.optional(v.string()),
    emoji: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const id = await ctx.db.insert('featureCatalog', {
      name: args.name,
      iconUrl: args.iconUrl,
      emoji: args.emoji,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  },
});

/**
 * Crear múltiples features de una sola vez (carga masiva)
 */
export const bulkCreate = mutation({
  args: {
    features: v.array(
      v.object({
        name: v.optional(v.string()),
        iconUrl: v.optional(v.string()),
        emoji: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const ids: string[] = [];
    for (const feature of args.features) {
      const id = await ctx.db.insert('featureCatalog', {
        name: feature.name,
        iconUrl: feature.iconUrl,
        emoji: feature.emoji,
        createdAt: now,
        updatedAt: now,
      });
      ids.push(id);
    }
    return ids;
  },
});

/**
 * Actualizar nombre y/o iconUrl de una feature
 */
export const update = mutation({
  args: {
    id: v.id('featureCatalog'),
    name: v.optional(v.string()),
    iconUrl: v.optional(v.string()),
    emoji: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const feature = await ctx.db.get(args.id);
    if (!feature) {
      throw new Error('Feature no encontrada');
    }

    const updates: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.name !== undefined) updates.name = args.name;
    if (args.iconUrl !== undefined) updates.iconUrl = args.iconUrl;
    if (args.emoji !== undefined) updates.emoji = args.emoji;

    await ctx.db.patch(args.id, updates);
    return args.id;
  },
});

/**
 * Eliminar una feature del catálogo.
 * Valida que no esté en uso en propertyFeatures.
 */
export const remove = mutation({
  args: { id: v.id('featureCatalog') },
  handler: async (ctx, args) => {
    const feature = await ctx.db.get(args.id);
    if (!feature) {
      throw new Error('Feature no encontrada');
    }

    // Verificar que no esté en uso
    const inUse = await ctx.db
      .query('propertyFeatures')
      .withIndex('by_feature', (q) => q.eq('featureId', args.id))
      .first();

    if (inUse) {
      throw new Error(
        'No se puede eliminar la feature porque está siendo usada por al menos una finca. Desenlácela primero.',
      );
    }

    await ctx.db.delete(args.id);
    return { success: true };
  },
});
