"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.seedCatalogProductos = exports.syncFromMeta = exports.remove = exports.update = exports.create = exports.getByLocationKeyword = exports.getDefault = exports.getById = exports.list = void 0;
const values_1 = require("convex/values");
const server_1 = require("./_generated/server");
exports.list = (0, server_1.query)({
    args: {},
    handler: async (ctx) => {
        const all = await ctx.db.query("whatsappCatalogs").collect();
        return all.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
    },
});
exports.getById = (0, server_1.query)({
    args: { id: values_1.v.id("whatsappCatalogs") },
    handler: async (ctx, args) => {
        return await ctx.db.get(args.id);
    },
});
exports.getDefault = (0, server_1.query)({
    args: {},
    handler: async (ctx) => {
        const byDefault = await ctx.db
            .query("whatsappCatalogs")
            .withIndex("by_is_default", (q) => q.eq("isDefault", true))
            .first();
        if (byDefault)
            return byDefault;
        const all = await ctx.db.query("whatsappCatalogs").collect();
        return all.sort((a, b) => (a.order ?? 999) - (b.order ?? 999))[0] ?? null;
    },
});
exports.getByLocationKeyword = (0, server_1.query)({
    args: { location: values_1.v.string() },
    handler: async (ctx, args) => {
        const locLower = args.location.trim().toLowerCase();
        if (!locLower)
            return null;
        const catalogs = await ctx.db.query("whatsappCatalogs").collect();
        return (catalogs.find((c) => c.locationKeyword && locLower.includes(c.locationKeyword.toLowerCase())) ?? null);
    },
});
exports.create = (0, server_1.mutation)({
    args: {
        name: values_1.v.string(),
        whatsappCatalogId: values_1.v.string(),
        isDefault: values_1.v.optional(values_1.v.boolean()),
        locationKeyword: values_1.v.optional(values_1.v.string()),
        order: values_1.v.optional(values_1.v.number()),
    },
    handler: async (ctx, args) => {
        const now = Date.now();
        return await ctx.db.insert("whatsappCatalogs", {
            name: args.name,
            whatsappCatalogId: args.whatsappCatalogId,
            isDefault: args.isDefault ?? false,
            locationKeyword: args.locationKeyword,
            order: args.order,
            createdAt: now,
            updatedAt: now,
        });
    },
});
exports.update = (0, server_1.mutation)({
    args: {
        id: values_1.v.id("whatsappCatalogs"),
        name: values_1.v.optional(values_1.v.string()),
        whatsappCatalogId: values_1.v.optional(values_1.v.string()),
        isDefault: values_1.v.optional(values_1.v.boolean()),
        locationKeyword: values_1.v.optional(values_1.v.string()),
        order: values_1.v.optional(values_1.v.number()),
    },
    handler: async (ctx, args) => {
        const { id, ...updates } = args;
        const existing = await ctx.db.get(id);
        if (!existing)
            throw new Error("Catálogo no encontrado");
        await ctx.db.patch(id, { ...updates, updatedAt: Date.now() });
        return id;
    },
});
exports.remove = (0, server_1.mutation)({
    args: { id: values_1.v.id("whatsappCatalogs") },
    handler: async (ctx, args) => {
        const links = await ctx.db
            .query("propertyWhatsAppCatalog")
            .withIndex("by_catalog", (q) => q.eq("catalogId", args.id))
            .collect();
        for (const link of links) {
            await ctx.db.delete(link._id);
        }
        await ctx.db.delete(args.id);
        return args.id;
    },
});
exports.syncFromMeta = (0, server_1.internalMutation)({
    args: {
        catalogs: values_1.v.array(values_1.v.object({
            id: values_1.v.string(),
            name: values_1.v.string(),
        })),
    },
    handler: async (ctx, args) => {
        const now = Date.now();
        const existing = await ctx.db.query("whatsappCatalogs").collect();
        const byMetaId = new Map(existing.map((c) => [c.whatsappCatalogId, c]));
        for (let i = 0; i < args.catalogs.length; i++) {
            const cat = args.catalogs[i];
            const row = byMetaId.get(cat.id);
            if (row) {
                if (row.name !== cat.name) {
                    await ctx.db.patch(row._id, { name: cat.name, updatedAt: now });
                }
            }
            else {
                await ctx.db.insert("whatsappCatalogs", {
                    name: cat.name,
                    whatsappCatalogId: cat.id,
                    isDefault: i === 0,
                    order: i,
                    createdAt: now,
                    updatedAt: now,
                });
            }
        }
        return args.catalogs.length;
    },
});
exports.seedCatalogProductos = (0, server_1.mutation)({
    args: {},
    handler: async (ctx) => {
        const META_CATALOG_ID = "26198995209693859";
        const PROPERTY_ID = "js797fftx557dg5gb9yd9et8s581g9dy";
        const PRODUCT_RETAILER_ID = "quk9ne5y4o";
        const now = Date.now();
        let catalog = (await ctx.db.query("whatsappCatalogs").collect()).find((c) => c.whatsappCatalogId === META_CATALOG_ID);
        if (!catalog) {
            const id = await ctx.db.insert("whatsappCatalogs", {
                name: "Catálogo_productos",
                whatsappCatalogId: META_CATALOG_ID,
                isDefault: true,
                order: 0,
                createdAt: now,
                updatedAt: now,
            });
            catalog = (await ctx.db.get(id));
        }
        const existing = await ctx.db
            .query("propertyWhatsAppCatalog")
            .withIndex("by_property_and_catalog", (q) => q.eq("propertyId", PROPERTY_ID).eq("catalogId", catalog._id))
            .unique();
        if (!existing) {
            await ctx.db.insert("propertyWhatsAppCatalog", {
                propertyId: PROPERTY_ID,
                catalogId: catalog._id,
                productRetailerId: PRODUCT_RETAILER_ID,
                createdAt: now,
                updatedAt: now,
            });
        }
        return {
            catalogId: catalog._id,
            catalogName: catalog.name,
            propertyId: PROPERTY_ID,
            productRetailerId: PRODUCT_RETAILER_ID,
        };
    },
});
//# sourceMappingURL=whatsappCatalogs.js.map