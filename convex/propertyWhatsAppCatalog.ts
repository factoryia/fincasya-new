import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

/**
 * Relación finca ↔ catálogo: una finca puede estar en varios catálogos,
 * cada uno con su product_retailer_id (identificador de contenido en Meta).
 */

/** Todas las entradas de una finca (en qué catálogos está y con qué product_retailer_id). */
export const listByProperty = query({
  args: { propertyId: v.id("properties") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("propertyWhatsAppCatalog")
      .withIndex("by_property", (q) => q.eq("propertyId", args.propertyId))
      .collect();
    const withCatalog = await Promise.all(
      rows.map(async (r) => {
        const catalog = await ctx.db.get(r.catalogId);
        return { ...r, catalogName: catalog?.name ?? null, whatsappCatalogId: catalog?.whatsappCatalogId ?? null };
      })
    );
    return withCatalog;
  },
});

/** Todas las fincas en un catálogo con su product_retailer_id. */
export const listByCatalog = query({
  args: { catalogId: v.id("whatsappCatalogs") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("propertyWhatsAppCatalog")
      .withIndex("by_catalog", (q) => q.eq("catalogId", args.catalogId))
      .collect();
  },
});

/** Dado un catálogo y una lista de propertyIds, devuelve los product_retailer_id en ese catálogo (para enviar el product_list). */
export const getProductRetailerIdsForProperties = query({
  args: {
    catalogId: v.id("whatsappCatalogs"),
    propertyIds: v.array(v.id("properties")),
  },
  handler: async (ctx, args) => {
    const set = new Set(args.propertyIds);
    const rows = await ctx.db
      .query("propertyWhatsAppCatalog")
      .withIndex("by_catalog", (q) => q.eq("catalogId", args.catalogId))
      .collect();
    const result: { propertyId: Id<"properties">; productRetailerId: string }[] = [];
    for (const r of rows) {
      if (set.has(r.propertyId)) {
        result.push({ propertyId: r.propertyId, productRetailerId: r.productRetailerId });
      }
    }
    return result;
  },
});

/** propertyIds que tienen al menos un catálogo asignado (para filtrar fincas que pueden enviarse en catálogo). */
export const getPropertyIdsInAnyCatalog = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("propertyWhatsAppCatalog").collect();
    return [...new Set(rows.map((r) => r.propertyId))];
  },
});

/** Añadir o actualizar: esta finca en este catálogo con este product_retailer_id. */
export const setPropertyInCatalog = mutation({
  args: {
    propertyId: v.id("properties"),
    catalogId: v.id("whatsappCatalogs"),
    productRetailerId: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("propertyWhatsAppCatalog")
      .withIndex("by_property_and_catalog", (q) =>
        q.eq("propertyId", args.propertyId).eq("catalogId", args.catalogId)
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        productRetailerId: args.productRetailerId,
        updatedAt: now,
      });
      return existing._id;
    }
    return await ctx.db.insert("propertyWhatsAppCatalog", {
      propertyId: args.propertyId,
      catalogId: args.catalogId,
      productRetailerId: args.productRetailerId,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/** Quitar una finca de un catálogo. */
export const removePropertyFromCatalog = mutation({
  args: {
    propertyId: v.id("properties"),
    catalogId: v.id("whatsappCatalogs"),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("propertyWhatsAppCatalog")
      .withIndex("by_property_and_catalog", (q) =>
        q.eq("propertyId", args.propertyId).eq("catalogId", args.catalogId)
      )
      .unique();
    if (row) await ctx.db.delete(row._id);
    return args.propertyId;
  },
});

/**
 * Reemplazar todos los catálogos de una finca. Útil desde el front: enviar lista de { catalogId, productRetailerId }.
 * catalogId aquí es el _id de whatsappCatalogs (Convex).
 */
export const setPropertyCatalogs = mutation({
  args: {
    propertyId: v.id("properties"),
    entries: v.array(
      v.object({
        catalogId: v.id("whatsappCatalogs"),
        productRetailerId: v.string(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("propertyWhatsAppCatalog")
      .withIndex("by_property", (q) => q.eq("propertyId", args.propertyId))
      .collect();
    for (const e of existing) {
      await ctx.db.delete(e._id);
    }
    for (const entry of args.entries) {
      const catalog = await ctx.db.get(entry.catalogId);
      if (!catalog) continue;
      await ctx.db.insert("propertyWhatsAppCatalog", {
        propertyId: args.propertyId,
        catalogId: entry.catalogId,
        productRetailerId: entry.productRetailerId,
        createdAt: now,
        updatedAt: now,
      });
    }
    return args.propertyId;
  },
});
