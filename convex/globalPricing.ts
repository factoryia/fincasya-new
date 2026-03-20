import { v } from 'convex/values';
import { query, mutation } from './_generated/server';

/**
 * List all global pricing rules
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query('globalPricing')
      .order('desc')
      .collect();
  },
});

/**
 * Get a global pricing rule by ID
 */
export const getById = query({
  args: { id: v.id('globalPricing') },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

/**
 * Create a new global pricing rule
 */
export const create = mutation({
  args: {
    nombre: v.string(),
    fechaDesde: v.optional(v.string()),
    fechaHasta: v.optional(v.string()),
    fechas: v.optional(v.array(v.string())),
    activa: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert('globalPricing', {
      ...args,
      activa: args.activa ?? true,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Update an existing global pricing rule
 */
export const update = mutation({
  args: {
    id: v.id('globalPricing'),
    nombre: v.optional(v.string()),
    fechaDesde: v.optional(v.string()),
    fechaHasta: v.optional(v.string()),
    fechas: v.optional(v.array(v.string())),
    activa: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    const existing = await ctx.db.get(id);
    if (!existing) throw new Error('Global rule not found');

    return await ctx.db.patch(id, {
      ...updates,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Remove a global pricing rule
 */
export const remove = mutation({
  args: { id: v.id('globalPricing') },
  handler: async (ctx, args) => {
    // First, check if any property is using this rule to warn or prevent?
    // For now, let's just delete it.
    await ctx.db.delete(args.id);
    return { success: true };
  },
});
