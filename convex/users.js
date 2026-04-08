"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listPropietarios = exports.remove = exports.updatePassword = exports.updateByEmail = exports.update = exports.getById = exports.list = exports.resetPassword = void 0;
const values_1 = require("convex/values");
const server_1 = require("./_generated/server");
const api_1 = require("./_generated/api");
const crypto_1 = require("better-auth/crypto");
exports.resetPassword = (0, server_1.action)({
    args: { userId: values_1.v.string(), newPassword: values_1.v.string() },
    handler: async (ctx, args) => {
        const newPasswordHash = await (0, crypto_1.hashPassword)(args.newPassword);
        await ctx.runMutation(api_1.api.users.updatePassword, {
            userId: args.userId,
            newPasswordHash,
        });
        return { success: true };
    },
});
exports.list = (0, server_1.query)({
    args: {
        limit: values_1.v.optional(values_1.v.number()),
        cursor: values_1.v.optional(values_1.v.string()),
    },
    handler: async (ctx, args) => {
        const result = await ctx.runQuery(api_1.components.betterAuth.adapter.findMany, {
            model: 'user',
            paginationOpts: {
                cursor: args.cursor ?? null,
                numItems: args.limit ?? 100,
            },
        });
        return result.page;
    },
});
exports.getById = (0, server_1.query)({
    args: { id: values_1.v.string() },
    handler: async (ctx, args) => {
        return await ctx.runQuery(api_1.components.betterAuth.adapter.findOne, {
            model: 'user',
            where: [{ field: '_id', value: args.id }],
        });
    },
});
exports.update = (0, server_1.mutation)({
    args: {
        id: values_1.v.string(),
        name: values_1.v.optional(values_1.v.string()),
        role: values_1.v.optional(values_1.v.union(values_1.v.literal('admin'), values_1.v.literal('assistant'), values_1.v.literal('vendedor'), values_1.v.literal('propietario'), values_1.v.literal('user'), values_1.v.null())),
        banned: values_1.v.optional(values_1.v.boolean()),
        phone: values_1.v.optional(values_1.v.union(values_1.v.null(), values_1.v.string())),
        position: values_1.v.optional(values_1.v.union(values_1.v.null(), values_1.v.string())),
        documentId: values_1.v.optional(values_1.v.union(values_1.v.null(), values_1.v.string())),
    },
    handler: async (ctx, args) => {
        const { id, ...updates } = args;
        const cleanUpdates = Object.fromEntries(Object.entries(updates).filter(([k, v]) => !(k === 'role' && v === null)));
        await ctx.runMutation(api_1.components.betterAuth.adapter.updateOne, {
            input: {
                model: 'user',
                update: cleanUpdates,
                where: [{ field: '_id', value: id }],
            },
        });
        return id;
    },
});
exports.updateByEmail = (0, server_1.mutation)({
    args: {
        email: values_1.v.string(),
        name: values_1.v.optional(values_1.v.string()),
        role: values_1.v.optional(values_1.v.union(values_1.v.literal('admin'), values_1.v.literal('assistant'), values_1.v.literal('vendedor'), values_1.v.literal('propietario'), values_1.v.literal('user'))),
        banned: values_1.v.optional(values_1.v.boolean()),
        phone: values_1.v.optional(values_1.v.string()),
        position: values_1.v.optional(values_1.v.union(values_1.v.null(), values_1.v.string())),
        documentId: values_1.v.optional(values_1.v.string()),
    },
    handler: async (ctx, args) => {
        const { email, ...updates } = args;
        const result = await ctx.runMutation(api_1.components.betterAuth.adapter.updateOne, {
            input: {
                model: 'user',
                update: updates,
                where: [{ field: 'email', value: email }],
            },
        });
        if (!result) {
            throw new Error(`User not found with email ${email}`);
        }
        return result;
    },
});
exports.updatePassword = (0, server_1.mutation)({
    args: {
        userId: values_1.v.string(),
        newPasswordHash: values_1.v.string(),
    },
    handler: async (ctx, args) => {
        const account = await ctx.runQuery(api_1.components.betterAuth.adapter.findOne, {
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
        const result = await ctx.runMutation(api_1.components.betterAuth.adapter.updateOne, {
            input: {
                model: 'account',
                update: { password: args.newPasswordHash },
                where: [
                    { field: 'userId', value: args.userId },
                    { field: 'providerId', value: account.providerId },
                ],
            },
        });
        console.log('Update result:', result);
        return { success: !!result };
    },
});
exports.remove = (0, server_1.mutation)({
    args: { id: values_1.v.string() },
    handler: async (ctx, args) => {
        await ctx.runMutation(api_1.components.betterAuth.adapter.deleteOne, {
            input: {
                model: 'user',
                where: [{ field: '_id', value: args.id }],
            },
        });
        return { success: true };
    },
});
exports.listPropietarios = (0, server_1.query)({
    args: {},
    handler: async (ctx) => {
        const result = await ctx.runQuery(api_1.components.betterAuth.adapter.findMany, {
            model: 'user',
            paginationOpts: {
                cursor: null,
                numItems: 1000,
            },
        });
        return result.page.filter((u) => u.role === 'propietario');
    },
});
//# sourceMappingURL=users.js.map