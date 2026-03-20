import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

/**
 * Get owner information for a specific property
 */
export const getByPropertyId = query({
  args: { propertyId: v.id('properties') },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('propertyOwnerInfo')
      .withIndex('by_property', (q) => q.eq('propertyId', args.propertyId))
      .unique();
  },
});

/**
 * Upsert owner information for a property
 */
export const upsert = mutation({
  args: {
    propertyId: v.id('properties'),
    ownerUserId: v.string(),
    rutNumber: v.string(),
    bankName: v.string(),
    accountNumber: v.string(),
    rntNumber: v.string(),
    bankCertificationUrl: v.optional(v.string()),
    idCopyUrl: v.optional(v.string()),
    rntPdfUrl: v.optional(v.string()),
    chamberOfCommerceUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('propertyOwnerInfo')
      .withIndex('by_property', (q) => q.eq('propertyId', args.propertyId))
      .unique();

    const timestamp = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        ...args,
        updatedAt: timestamp,
      });
      return existing._id;
    } else {
      return await ctx.db.insert('propertyOwnerInfo', {
        ...args,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }
  },
});
