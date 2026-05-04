import { v } from 'convex/values';
import { query, mutation } from './_generated/server';

export const listAll = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query('rolePermissions').collect();
  },
});

export const getByRole = query({
  args: { role: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('rolePermissions')
      .withIndex('by_role', (q) => q.eq('role', args.role))
      .collect();
  },
});

export const upsert = mutation({
  args: {
    role: v.string(),
    module: v.string(),
    permissions: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('rolePermissions')
      .withIndex('by_role_module', (q) =>
        q.eq('role', args.role).eq('module', args.module),
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        permissions: args.permissions,
        isCustom: true,
        updatedAt: Date.now(),
      });
      return existing._id;
    } else {
      return await ctx.db.insert('rolePermissions', {
        role: args.role,
        module: args.module,
        permissions: args.permissions,
        isCustom: false,
        updatedAt: Date.now(),
      });
    }
  },
});

export const initializeRole = mutation({
  args: { role: v.string() },
  handler: async (ctx, args) => {
    const modules = [
      'fincas', 'bookings', 'payments', 'users', 'inbox',
      'contacts', 'reviews', 'catalogs', 'knowledge', 'reports', 'owner_info',
    ];

    for (const module of modules) {
      const existing = await ctx.db
        .query('rolePermissions')
        .withIndex('by_role_module', (q) =>
          q.eq('role', args.role).eq('module', module),
        )
        .first();

      if (!existing) {
        await ctx.db.insert('rolePermissions', {
          role: args.role,
          module,
          permissions: [],
          isCustom: false,
          updatedAt: Date.now(),
        });
      }
    }

    return { success: true };
  },
});