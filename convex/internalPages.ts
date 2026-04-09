import { v } from 'convex/values';
import { query, mutation } from './_generated/server';

export const getById = query({
  args: { pageId: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('internalPages')
      .withIndex('by_pageId', (q) => q.eq('pageId', args.pageId))
      .first();
    return existing?.content ?? null;
  },
});

export const upsert = mutation({
  args: { pageId: v.string(), content: v.any() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('internalPages')
      .withIndex('by_pageId', (q) => q.eq('pageId', args.pageId))
      .first();

    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { content: args.content, updatedAt: now });
      return args.content;
    }

    await ctx.db.insert('internalPages', {
      pageId: args.pageId,
      content: args.content,
      updatedAt: now,
    });
    return args.content;
  },
});
