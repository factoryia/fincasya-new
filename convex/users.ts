import { v } from 'convex/values';
import { query, mutation } from './_generated/server';
import { components } from './_generated/api';

/**
 * List all users via the betterAuth component adapter
 */
export const list = query({
  args: {
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'user',
      paginationOpts: {
        cursor: args.cursor ?? null,
        numItems: args.limit ?? 100,
      },
    });
    // result.page contains the array of users
    return result.page;
  },
});

/**
 * Get user by _id string via the betterAuth component adapter
 */
export const getById = query({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    return await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: 'user',
      where: [{ field: '_id', value: args.id }],
    });
  },
});

/**
 * Update user details and role by _id string
 * NOTE: updateOne takes an `input` wrapper
 */
export const update = mutation({
  args: {
    id: v.string(),
    name: v.optional(v.string()),
    role: v.optional(v.union(v.literal('user'), v.literal('admin'))),
    phone: v.optional(v.string()),
    position: v.optional(v.string()),
    documentId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    await ctx.runMutation(components.betterAuth.adapter.updateOne, {
      input: {
        model: 'user',
        update: updates,
        where: [{ field: '_id', value: id }],
      },
    });
    return id;
  },
});

/**
 * Update user details by email (used right after better-auth sign-up/email)
 * NOTE: updateOne takes an `input` wrapper
 */
export const updateByEmail = mutation({
  args: {
    email: v.string(),
    name: v.optional(v.string()),
    role: v.optional(v.union(v.literal('user'), v.literal('admin'))),
    phone: v.optional(v.string()),
    position: v.optional(v.string()),
    documentId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { email, ...updates } = args;
    const result = await ctx.runMutation(
      components.betterAuth.adapter.updateOne,
      {
        input: {
          model: 'user',
          update: updates,
          where: [{ field: 'email', value: email }],
        },
      },
    );

    if (!result) {
      throw new Error(`User not found with email ${email}`);
    }

    return result;
  },
});

/**
 * Update a user's password by userId string (the string id returned by betterAuth).
 * The newPasswordHash must already be a bcrypt hash.
 */
export const updatePassword = mutation({
  args: {
    userId: v.string(),
    newPasswordHash: v.string(),
  },
  handler: async (ctx, args) => {
    // passwords live in the `account` table linked by userId
    await ctx.runMutation(components.betterAuth.adapter.updateOne, {
      input: {
        model: 'account',
        update: { password: args.newPasswordHash },
        where: [
          { field: 'userId', value: args.userId },
          { field: 'providerId', value: 'credential' },
        ],
      },
    });
    return { success: true };
  },
});

/**
 * Remove a user by _id string
 * NOTE: deleteOne takes an `input` wrapper
 */
export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    await ctx.runMutation(components.betterAuth.adapter.deleteOne, {
      input: {
        model: 'user',
        where: [{ field: '_id', value: args.id }],
      },
    });
    return { success: true };
  },
});
