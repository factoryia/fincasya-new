"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.remove = exports.update = exports.create = exports.getById = exports.list = void 0;
const values_1 = require("convex/values");
const server_1 = require("./_generated/server");
exports.list = (0, server_1.query)({
    args: {},
    handler: async (ctx) => {
        return await ctx.db
            .query('globalPricing')
            .order('desc')
            .collect();
    },
});
exports.getById = (0, server_1.query)({
    args: { id: values_1.v.id('globalPricing') },
    handler: async (ctx, args) => {
        return await ctx.db.get(args.id);
    },
});
exports.create = (0, server_1.mutation)({
    args: {
        nombre: values_1.v.string(),
        fechaDesde: values_1.v.optional(values_1.v.string()),
        fechaHasta: values_1.v.optional(values_1.v.string()),
        fechas: values_1.v.optional(values_1.v.array(values_1.v.string())),
        activa: values_1.v.optional(values_1.v.boolean()),
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
exports.update = (0, server_1.mutation)({
    args: {
        id: values_1.v.id('globalPricing'),
        nombre: values_1.v.optional(values_1.v.string()),
        fechaDesde: values_1.v.optional(values_1.v.string()),
        fechaHasta: values_1.v.optional(values_1.v.string()),
        fechas: values_1.v.optional(values_1.v.array(values_1.v.string())),
        activa: values_1.v.optional(values_1.v.boolean()),
    },
    handler: async (ctx, args) => {
        const { id, ...updates } = args;
        const existing = await ctx.db.get(id);
        if (!existing)
            throw new Error('Global rule not found');
        return await ctx.db.patch(id, {
            ...updates,
            updatedAt: Date.now(),
        });
    },
});
exports.remove = (0, server_1.mutation)({
    args: { id: values_1.v.id('globalPricing') },
    handler: async (ctx, args) => {
        await ctx.db.delete(args.id);
        return { success: true };
    },
});
//# sourceMappingURL=globalPricing.js.map