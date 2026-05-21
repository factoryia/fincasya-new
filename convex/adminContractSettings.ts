import { v } from 'convex/values';
import { internalMutation, internalQuery, query } from './_generated/server';

const GLOBAL_SCOPE = 'global' as const;

/** Snapshot global del contrato (admin, cláusulas, propietario por finca). Usado al generar .docx. */
export const getGlobalPayload = query({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db
      .query('adminContractSettings')
      .withIndex('by_scope', (q) => q.eq('scope', GLOBAL_SCOPE))
      .unique();
    return row?.payload ?? null;
  },
});

export const getForAdmin = internalQuery({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db
      .query('adminContractSettings')
      .withIndex('by_scope', (q) => q.eq('scope', GLOBAL_SCOPE))
      .unique();
    return row;
  },
});

export const replaceForAdmin = internalMutation({
  args: {
    payload: v.any(),
  },
  handler: async (ctx, { payload }) => {
    if (payload == null || typeof payload !== 'object') {
      throw new Error('payload inválido');
    }
    const now = Date.now();
    const existing = await ctx.db
      .query('adminContractSettings')
      .withIndex('by_scope', (q) => q.eq('scope', GLOBAL_SCOPE))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { payload, updatedAt: now });
      return existing._id;
    }
    return await ctx.db.insert('adminContractSettings', {
      scope: GLOBAL_SCOPE,
      payload,
      updatedAt: now,
    });
  },
});
