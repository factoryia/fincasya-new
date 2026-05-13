import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { normalizeContractLookupQueryConvex } from './lib/contractLookup';

export const upsert = mutation({
  args: {
    contractNumber: v.string(),
    propertyId: v.id('properties'),
    payload: v.any(),
  },
  handler: async (ctx, args) => {
    const raw = args.contractNumber.trim();
    if (!raw) throw new Error('contractNumber vacío');
    const canonical = normalizeContractLookupQueryConvex(raw) || raw;
    const keys = [...new Set([raw, canonical].filter((k) => k.length > 0))];
    for (const key of keys) {
      const hits = await ctx.db
        .query('adminContractSnapshots')
        .withIndex('by_contract_number', (q) => q.eq('contractNumber', key))
        .collect();
      for (const h of hits) await ctx.db.delete(h._id);
    }
    return await ctx.db.insert('adminContractSnapshots', {
      contractNumber: canonical,
      propertyId: args.propertyId,
      payload: args.payload,
      createdAt: Date.now(),
    });
  },
});

export const getById = query({
  args: { id: v.id('adminContractSnapshots') },
  handler: async (ctx, args) => ctx.db.get(args.id),
});

export const getByContractNumber = query({
  args: { contractNumber: v.string() },
  handler: async (ctx, args) => {
    const raw = args.contractNumber.trim();
    if (!raw) return null;
    const normalized = normalizeContractLookupQueryConvex(raw);
    const keys = [...new Set([normalized, raw].filter((k) => k.length > 0))];
    for (const key of keys) {
      const doc = await ctx.db
        .query('adminContractSnapshots')
        .withIndex('by_contract_number', (q) => q.eq('contractNumber', key))
        .first();
      if (!doc) continue;
      const property = await ctx.db.get(doc.propertyId);
      const p = (doc.payload ?? {}) as Record<string, unknown>;
      return {
        _id: doc._id,
        isContractSnapshot: true as const,
        propertyId: doc.propertyId,
        propertyTitle: (property as { title?: string } | null)?.title ?? '',
        propertyLocation:
          (property as { location?: string } | null)?.location ?? '',
        ...p,
      };
    }
    return null;
  },
});

export const remove = mutation({
  args: { id: v.id('adminContractSnapshots') },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
    return true;
  },
});
