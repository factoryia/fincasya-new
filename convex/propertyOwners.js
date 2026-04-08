"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.upsert = exports.getOwnedProperties = exports.getByPropertyId = void 0;
const values_1 = require("convex/values");
const server_1 = require("./_generated/server");
exports.getByPropertyId = (0, server_1.query)({
    args: { propertyId: values_1.v.id('properties') },
    handler: async (ctx, args) => {
        return await ctx.db
            .query('propertyOwnerInfo')
            .withIndex('by_property', (q) => q.eq('propertyId', args.propertyId))
            .unique();
    },
});
exports.getOwnedProperties = (0, server_1.query)({
    args: { ownerUserId: values_1.v.string() },
    handler: async (ctx, args) => {
        const infos = await ctx.db
            .query('propertyOwnerInfo')
            .withIndex('by_owner', (q) => q.eq('ownerUserId', args.ownerUserId))
            .collect();
        if (infos.length === 0)
            return [];
        const properties = [];
        for (const info of infos) {
            const prop = await ctx.db.get(info.propertyId);
            if (prop) {
                properties.push({
                    id: prop._id,
                    title: prop.title,
                    code: prop.code,
                });
            }
        }
        return properties;
    },
});
exports.upsert = (0, server_1.mutation)({
    args: {
        propertyId: values_1.v.id('properties'),
        ownerUserId: values_1.v.string(),
        rutNumber: values_1.v.string(),
        bankName: values_1.v.string(),
        accountNumber: values_1.v.string(),
        rntNumber: values_1.v.string(),
        bankCertificationUrl: values_1.v.optional(values_1.v.string()),
        idCopyUrl: values_1.v.optional(values_1.v.string()),
        rntPdfUrl: values_1.v.optional(values_1.v.string()),
        chamberOfCommerceUrl: values_1.v.optional(values_1.v.string()),
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
        }
        else {
            return await ctx.db.insert('propertyOwnerInfo', {
                ...args,
                createdAt: timestamp,
                updatedAt: timestamp,
            });
        }
    },
});
//# sourceMappingURL=propertyOwners.js.map