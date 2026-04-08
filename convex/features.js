"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.removeIcon = exports.updateIcon = exports.bulkCreateIcons = exports.createIcon = exports.getIconById = exports.listIcons = void 0;
const values_1 = require("convex/values");
const server_1 = require("./_generated/server");
exports.listIcons = (0, server_1.query)({
    args: {},
    handler: async (ctx) => {
        const icons = await ctx.db.query('iconography').collect();
        return icons;
    },
});
exports.getIconById = (0, server_1.query)({
    args: { id: values_1.v.id('iconography') },
    handler: async (ctx, args) => {
        return await ctx.db.get(args.id);
    },
});
exports.createIcon = (0, server_1.mutation)({
    args: {
        name: values_1.v.optional(values_1.v.string()),
        iconUrl: values_1.v.optional(values_1.v.string()),
        emoji: values_1.v.optional(values_1.v.string()),
    },
    handler: async (ctx, args) => {
        const now = Date.now();
        const id = await ctx.db.insert('iconography', {
            name: args.name,
            iconUrl: args.iconUrl,
            emoji: args.emoji,
            createdAt: now,
            updatedAt: now,
        });
        return id;
    },
});
exports.bulkCreateIcons = (0, server_1.mutation)({
    args: {
        icons: values_1.v.array(values_1.v.object({
            name: values_1.v.optional(values_1.v.string()),
            iconUrl: values_1.v.optional(values_1.v.string()),
            emoji: values_1.v.optional(values_1.v.string()),
        })),
    },
    handler: async (ctx, args) => {
        const now = Date.now();
        const ids = [];
        for (const icon of args.icons) {
            const id = await ctx.db.insert('iconography', {
                name: icon.name,
                iconUrl: icon.iconUrl,
                emoji: icon.emoji,
                createdAt: now,
                updatedAt: now,
            });
            ids.push(id);
        }
        return ids;
    },
});
exports.updateIcon = (0, server_1.mutation)({
    args: {
        id: values_1.v.id('iconography'),
        name: values_1.v.optional(values_1.v.string()),
        iconUrl: values_1.v.optional(values_1.v.string()),
        emoji: values_1.v.optional(values_1.v.string()),
    },
    handler: async (ctx, args) => {
        const icon = await ctx.db.get(args.id);
        if (!icon) {
            throw new Error('Icono no encontrado');
        }
        const updates = { updatedAt: Date.now() };
        if (args.name !== undefined)
            updates.name = args.name;
        if (args.iconUrl !== undefined)
            updates.iconUrl = args.iconUrl;
        if (args.emoji !== undefined)
            updates.emoji = args.emoji;
        await ctx.db.patch(args.id, updates);
        return args.id;
    },
});
exports.removeIcon = (0, server_1.mutation)({
    args: { id: values_1.v.id('iconography') },
    handler: async (ctx, args) => {
        const icon = await ctx.db.get(args.id);
        if (!icon) {
            throw new Error('Icono no encontrado');
        }
        const inUse = await ctx.db
            .query('propertyFeatures')
            .withIndex('by_icon', (q) => q.eq('iconId', args.id))
            .first();
        if (inUse) {
            throw new Error('No se puede eliminar el icono porque está siendo usado por al menos una finca. Desenlácela primero.');
        }
        await ctx.db.delete(args.id);
        return { success: true };
    },
});
//# sourceMappingURL=features.js.map