import { v } from 'convex/values';
import { query, mutation, action } from './_generated/server';
import { components, api } from './_generated/api';
// Import the standalone hashing utility from Better Auth
import { hashPassword } from 'better-auth/crypto';

/**
 * Reset a user's password using Better Auth's own standalone hasher.
 * This runs as an action because it uses the crypto API.
 */
export const resetPassword = action({
  args: { userId: v.string(), newPassword: v.string() },
  handler: async (ctx, args) => {
    // Hash the password using Better Auth's own standalone utility
    // This produces the correct scrypt hash format: salt:key
    const newPasswordHash = await hashPassword(args.newPassword);

    // Update the password via the mutation
    await ctx.runMutation(api.users.updatePassword, {
      userId: args.userId,
      newPasswordHash,
    });

    return { success: true };
  },
});

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
    role: v.optional(
      v.union(v.literal('admin'), v.literal('assistant'), v.literal('user')),
    ),
    banned: v.optional(v.boolean()),
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
    role: v.optional(
      v.union(v.literal('admin'), v.literal('assistant'), v.literal('user')),
    ),
    banned: v.optional(v.boolean()),
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
    // Find the account first to see what's there
    const account = await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: 'account',
      where: [{ field: 'userId', value: args.userId }],
    });
    console.log('Found account for user:', {
      userId: account.userId,
      providerId: account.providerId,
      passwordPrefix: account.password
        ? account.password.substring(0, 15)
        : 'no-password',
    });

    if (!account) {
      console.error('Account not found for user ID:', args.userId);
      return { success: false, message: 'Account not found' };
    }

    const result = await ctx.runMutation(
      components.betterAuth.adapter.updateOne,
      {
        input: {
          model: 'account',
          update: { password: args.newPasswordHash },
          where: [
            { field: 'userId', value: args.userId },
            { field: 'providerId', value: account.providerId },
          ],
        },
      },
    );
    console.log('Update result:', result);
    return { success: !!result };
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
