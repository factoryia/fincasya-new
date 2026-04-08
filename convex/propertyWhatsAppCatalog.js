"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setPropertyCatalogs = exports.removePropertyFromCatalog = exports.setPropertyInCatalog = exports.getPropertyIdsInAnyCatalog = exports.getProductRetailerIdsForProperties = exports.listByCatalog = exports.listByProperty = void 0;
const values_1 = require("convex/values");
const server_1 = require("./_generated/server");
const api_1 = require("./_generated/api");
exports.listByProperty = (0, server_1.query)({
    args: { propertyId: values_1.v.id("properties") },
    handler: async (ctx, args) => {
        const rows = await ctx.db
            .query("propertyWhatsAppCatalog")
            .withIndex("by_property", (q) => q.eq("propertyId", args.propertyId))
            .collect();
        const withCatalog = await Promise.all(rows.map(async (r) => {
            const catalog = await ctx.db.get(r.catalogId);
            return { ...r, catalogName: catalog?.name ?? null, whatsappCatalogId: catalog?.whatsappCatalogId ?? null };
        }));
        return withCatalog;
    },
});
exports.listByCatalog = (0, server_1.query)({
    args: { catalogId: values_1.v.id("whatsappCatalogs") },
    handler: async (ctx, args) => {
        return await ctx.db
            .query("propertyWhatsAppCatalog")
            .withIndex("by_catalog", (q) => q.eq("catalogId", args.catalogId))
            .collect();
    },
});
exports.getProductRetailerIdsForProperties = (0, server_1.query)({
    args: {
        catalogId: values_1.v.id("whatsappCatalogs"),
        propertyIds: values_1.v.array(values_1.v.id("properties")),
    },
    handler: async (ctx, args) => {
        const set = new Set(args.propertyIds);
        const rows = await ctx.db
            .query("propertyWhatsAppCatalog")
            .withIndex("by_catalog", (q) => q.eq("catalogId", args.catalogId))
            .collect();
        const result = [];
        for (const r of rows) {
            if (set.has(r.propertyId)) {
                result.push({ propertyId: r.propertyId, productRetailerId: r.productRetailerId });
            }
        }
        return result;
    },
});
exports.getPropertyIdsInAnyCatalog = (0, server_1.query)({
    args: {},
    handler: async (ctx) => {
        const rows = await ctx.db.query("propertyWhatsAppCatalog").collect();
        return [...new Set(rows.map((r) => r.propertyId))];
    },
});
exports.setPropertyInCatalog = (0, server_1.mutation)({
    args: {
        propertyId: values_1.v.id("properties"),
        catalogId: values_1.v.id("whatsappCatalogs"),
        productRetailerId: values_1.v.string(),
    },
    handler: async (ctx, args) => {
        const now = Date.now();
        const catalog = await ctx.db.get(args.catalogId);
        if (!catalog)
            throw new Error("Catálogo no encontrado");
        const existing = await ctx.db
            .query("propertyWhatsAppCatalog")
            .withIndex("by_property_and_catalog", (q) => q.eq("propertyId", args.propertyId).eq("catalogId", args.catalogId))
            .unique();
        if (existing) {
            await ctx.db.patch(existing._id, {
                productRetailerId: args.productRetailerId,
                updatedAt: now,
            });
            await ctx.scheduler.runAfter(0, api_1.internal.metaCatalog.syncProductToMetaCatalog, {
                whatsappCatalogId: catalog.whatsappCatalogId,
                propertyId: args.propertyId,
                method: "UPDATE",
            });
            return existing._id;
        }
        const rowId = await ctx.db.insert("propertyWhatsAppCatalog", {
            propertyId: args.propertyId,
            catalogId: args.catalogId,
            productRetailerId: args.productRetailerId,
            createdAt: now,
            updatedAt: now,
        });
        await ctx.scheduler.runAfter(0, api_1.internal.metaCatalog.syncProductToMetaCatalog, {
            whatsappCatalogId: catalog.whatsappCatalogId,
            propertyId: args.propertyId,
            method: "CREATE",
        });
        return rowId;
    },
});
exports.removePropertyFromCatalog = (0, server_1.mutation)({
    args: {
        propertyId: values_1.v.id("properties"),
        catalogId: values_1.v.id("whatsappCatalogs"),
    },
    handler: async (ctx, args) => {
        const row = await ctx.db
            .query("propertyWhatsAppCatalog")
            .withIndex("by_property_and_catalog", (q) => q.eq("propertyId", args.propertyId).eq("catalogId", args.catalogId))
            .unique();
        if (row) {
            const catalog = await ctx.db.get(row.catalogId);
            if (catalog) {
                await ctx.scheduler.runAfter(0, api_1.internal.metaCatalog.deleteFromMetaCatalogs, {
                    items: [
                        { whatsappCatalogId: catalog.whatsappCatalogId, retailer_id: row.productRetailerId },
                    ],
                });
            }
            await ctx.db.delete(row._id);
        }
        return args.propertyId;
    },
});
exports.setPropertyCatalogs = (0, server_1.mutation)({
    args: {
        propertyId: values_1.v.id("properties"),
        entries: values_1.v.array(values_1.v.object({
            catalogId: values_1.v.id("whatsappCatalogs"),
            productRetailerId: values_1.v.string(),
        })),
    },
    handler: async (ctx, args) => {
        const now = Date.now();
        const existing = await ctx.db
            .query("propertyWhatsAppCatalog")
            .withIndex("by_property", (q) => q.eq("propertyId", args.propertyId))
            .collect();
        const toDeleteFromMeta = [];
        for (const e of existing) {
            const catalog = await ctx.db.get(e.catalogId);
            if (catalog)
                toDeleteFromMeta.push({ whatsappCatalogId: catalog.whatsappCatalogId, retailer_id: e.productRetailerId });
            await ctx.db.delete(e._id);
        }
        if (toDeleteFromMeta.length > 0) {
            await ctx.scheduler.runAfter(0, api_1.internal.metaCatalog.deleteFromMetaCatalogs, {
                items: toDeleteFromMeta,
            });
        }
        for (const entry of args.entries) {
            const catalog = await ctx.db.get(entry.catalogId);
            if (!catalog)
                continue;
            await ctx.db.insert("propertyWhatsAppCatalog", {
                propertyId: args.propertyId,
                catalogId: entry.catalogId,
                productRetailerId: entry.productRetailerId,
                createdAt: now,
                updatedAt: now,
            });
            await ctx.scheduler.runAfter(0, api_1.internal.metaCatalog.syncProductToMetaCatalog, {
                whatsappCatalogId: catalog.whatsappCatalogId,
                propertyId: args.propertyId,
                method: "CREATE",
            });
        }
        return args.propertyId;
    },
});
//# sourceMappingURL=propertyWhatsAppCatalog.js.map