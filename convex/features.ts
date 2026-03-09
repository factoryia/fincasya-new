import { v } from 'convex/values'; // Re-sync trigger
import { query, mutation } from './_generated/server';

// ============ QUERIES ============

/**
 * Listar toda la iconografía del catálogo
 */
export const listIcons = query({
  args: {},
  handler: async (ctx) => {
    const icons = await ctx.db.query('iconography').collect();
    return icons;
  },
});

/**
 * Obtener un icono por ID
 */
export const getIconById = query({
  args: { id: v.id('iconography') },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

// ============ MUTATIONS ============

/**
 * Crear un icono en el catálogo
 */
export const createIcon = mutation({
  args: {
    name: v.optional(v.string()),
    iconUrl: v.optional(v.string()),
    emoji: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const id = await ctx.db.insert('iconography', {
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
 * Crear múltiples iconos de una sola vez (carga masiva)
 */
export const bulkCreateIcons = mutation({
  args: {
    icons: v.array(
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
    for (const icon of args.icons) {
      const id = await ctx.db.insert('iconography', {
        name: icon.name,
        iconUrl: icon.iconUrl,
        emoji: icon.emoji,
        createdAt: now,
        updatedAt: now,
      });
      ids.push(id);
    }
    return ids;
  },
});

/**
 * Actualizar nombre y/o iconUrl de un icono
 */
export const updateIcon = mutation({
  args: {
    id: v.id('iconography'),
    name: v.optional(v.string()),
    iconUrl: v.optional(v.string()),
    emoji: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const icon = await ctx.db.get(args.id);
    if (!icon) {
      throw new Error('Icono no encontrado');
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
 * Eliminar un icono del catálogo.
 * Valida que no esté en uso en propertyFeatures.
 */
export const removeIcon = mutation({
  args: { id: v.id('iconography') },
  handler: async (ctx, args) => {
    const icon = await ctx.db.get(args.id);
    if (!icon) {
      throw new Error('Icono no encontrado');
    }

    // Verificar que no esté en uso
    const inUse = await ctx.db
      .query('propertyFeatures')
      .withIndex('by_icon', (q) => q.eq('iconId', args.id))
      .first();

    if (inUse) {
      throw new Error(
        'No se puede eliminar el icono porque está siendo usado por al menos una finca. Desenlácela primero.',
      );
    }

    await ctx.db.delete(args.id);
    return { success: true };
  },
});
