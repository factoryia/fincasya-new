import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

const propertyCategory = v.union(
  v.literal('ECONOMICA'),
  v.literal('ESTANDAR'),
  v.literal('PREMIUM'),
  v.literal('LUJO'),
  v.literal('ECOTURISMO'),
  v.literal('CON_PISCINA'),
  v.literal('CERCA_BOGOTA'),
  v.literal('GRUPOS_GRANDES'),
  v.literal('VIP'),
);

export const listByCategory = query({
  args: { propertyCategory },
  handler: async (ctx, args) => {
    const templates = await ctx.db
      .query('propertyCategoryZoneTemplates')
      .withIndex('by_category', (q) =>
        q.eq('propertyCategory', args.propertyCategory),
      )
      .collect();

    const sorted = templates.sort(
      (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name),
    );

    const out = [];
    for (const t of sorted) {
      const rows = await ctx.db
        .query('propertyCategoryZoneFeatures')
        .withIndex('by_zone_template', (q) => q.eq('zoneTemplateId', t._id))
        .collect();
      rows.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      out.push({ ...t, features: rows });
    }
    return out;
  },
});

/** Todas las plantillas de zona (sin filtrar por categoría de propiedad). */
export const listAll = query({
  args: {},
  handler: async (ctx) => {
    const templates = await ctx.db
      .query('propertyCategoryZoneTemplates')
      .collect();
    const sorted = templates.sort(
      (a, b) =>
        (a.order ?? 0) - (b.order ?? 0) ||
        String(a.name).localeCompare(String(b.name)) ||
        a._id.localeCompare(b._id),
    );
    const out = [];
    for (const t of sorted) {
      const rows = await ctx.db
        .query('propertyCategoryZoneFeatures')
        .withIndex('by_zone_template', (q) => q.eq('zoneTemplateId', t._id))
        .collect();
      rows.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      out.push({ ...t, features: rows });
    }
    return out;
  },
});

export const createTemplate = mutation({
  args: {
    propertyCategory,
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query('propertyCategoryZoneTemplates')
      .withIndex('by_category', (q) =>
        q.eq('propertyCategory', args.propertyCategory),
      )
      .collect();
    const order = existing.length;
    return await ctx.db.insert('propertyCategoryZoneTemplates', {
      propertyCategory: args.propertyCategory,
      name: args.name.trim(),
      order,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateTemplate = mutation({
  args: {
    id: v.id('propertyCategoryZoneTemplates'),
    name: v.optional(v.string()),
    order: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row) throw new Error('Plantilla de zona no encontrada');
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.name !== undefined) patch.name = args.name.trim();
    if (args.order !== undefined) patch.order = args.order;
    await ctx.db.patch(args.id, patch);
    return args.id;
  },
});

export const deleteTemplate = mutation({
  args: { id: v.id('propertyCategoryZoneTemplates') },
  handler: async (ctx, args) => {
    const features = await ctx.db
      .query('propertyCategoryZoneFeatures')
      .withIndex('by_zone_template', (q) => q.eq('zoneTemplateId', args.id))
      .collect();
    for (const f of features) {
      await ctx.db.delete(f._id);
    }
    await ctx.db.delete(args.id);
    return { success: true };
  },
});

export const addTemplateFeature = mutation({
  args: {
    zoneTemplateId: v.id('propertyCategoryZoneTemplates'),
    iconographyId: v.id('iconography'),
    alias: v.optional(v.string()),
    quantity: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const tpl = await ctx.db.get(args.zoneTemplateId);
    if (!tpl) throw new Error('Plantilla no encontrada');
    const icon = await ctx.db.get(args.iconographyId);
    if (!icon) throw new Error('Icono no encontrado');
    const now = Date.now();
    const existing = await ctx.db
      .query('propertyCategoryZoneFeatures')
      .withIndex('by_zone_template', (q) =>
        q.eq('zoneTemplateId', args.zoneTemplateId),
      )
      .collect();
    const order = existing.length;
    const qty =
      args.quantity !== undefined
        ? Math.max(1, Math.floor(Number(args.quantity)))
        : 1;
    return await ctx.db.insert('propertyCategoryZoneFeatures', {
      zoneTemplateId: args.zoneTemplateId,
      iconographyId: args.iconographyId,
      alias: args.alias?.trim() || undefined,
      quantity: qty,
      order,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateTemplateFeature = mutation({
  args: {
    id: v.id('propertyCategoryZoneFeatures'),
    alias: v.optional(v.string()),
    order: v.optional(v.number()),
    iconographyId: v.optional(v.id('iconography')),
    quantity: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row) throw new Error('Característica de plantilla no encontrada');
    if (args.iconographyId) {
      const icon = await ctx.db.get(args.iconographyId);
      if (!icon) throw new Error('Icono no encontrado');
    }
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.alias !== undefined)
      patch.alias = args.alias.trim() === '' ? undefined : args.alias.trim();
    if (args.order !== undefined) patch.order = args.order;
    if (args.iconographyId !== undefined) patch.iconographyId = args.iconographyId;
    if (args.quantity !== undefined)
      patch.quantity = Math.max(1, Math.floor(Number(args.quantity)));
    await ctx.db.patch(args.id, patch);
    return args.id;
  },
});

export const removeTemplateFeature = mutation({
  args: { id: v.id('propertyCategoryZoneFeatures') },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
    return { success: true };
  },
});
