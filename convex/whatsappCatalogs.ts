import { v } from "convex/values";
import { query, mutation, internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

/**
 * Catálogos de WhatsApp configurados en la base de datos (sin env vars).
 * Un catálogo tiene nombre, ID de Meta y opcionalmente palabra clave de ubicación o isDefault.
 */

export const list = query({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("whatsappCatalogs").collect();
    return all.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  },
});

export const getById = query({
  args: { id: v.id("whatsappCatalogs") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

/** Catálogo por defecto (isDefault: true); si no hay, el primero por order. */
export const getDefault = query({
  args: {},
  handler: async (ctx) => {
    const byDefault = await ctx.db
      .query("whatsappCatalogs")
      .withIndex("by_is_default", (q) => q.eq("isDefault", true))
      .first();
    if (byDefault) return byDefault;
    const all = await ctx.db.query("whatsappCatalogs").collect();
    return all.sort((a, b) => (a.order ?? 999) - (b.order ?? 999))[0] ?? null;
  },
});

/** Catálogo cuya locationKeyword está contenida en la ubicación (ej. "tolima" en "Villavicencio Tolima"). */
export const getByLocationKeyword = query({
  args: { location: v.string() },
  handler: async (ctx, args) => {
    const locLower = args.location.trim().toLowerCase();
    if (!locLower) return null;
    const catalogs = await ctx.db.query("whatsappCatalogs").collect();
    return (
      catalogs.find(
        (c) => c.locationKeyword && locLower.includes(c.locationKeyword.toLowerCase())
      ) ?? null
    );
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    whatsappCatalogId: v.string(),
    isDefault: v.optional(v.boolean()),
    locationKeyword: v.optional(v.string()),
    order: v.optional(v.number()),
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

export const update = mutation({
  args: {
    id: v.id("whatsappCatalogs"),
    name: v.optional(v.string()),
    whatsappCatalogId: v.optional(v.string()),
    isDefault: v.optional(v.boolean()),
    locationKeyword: v.optional(v.string()),
    order: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    const existing = await ctx.db.get(id);
    if (!existing) throw new Error("Catálogo no encontrado");
    await ctx.db.patch(id, { ...updates, updatedAt: Date.now() });
    return id;
  },
});

export const remove = mutation({
  args: { id: v.id("whatsappCatalogs") },
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

/**
 * Sincroniza catálogos desde Meta a la tabla whatsappCatalogs.
 * Crea los que no existen; actualiza nombre de los que ya existen por whatsappCatalogId.
 */
export const syncFromMeta = internalMutation({
  args: {
    catalogs: v.array(
      v.object({
        id: v.string(),
        name: v.string(),
      })
    ),
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
      } else {
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

/**
 * Seed: crea el catálogo "Catálogo_productos" (Meta 26198995209693859) y asocia la finca
 * VILLA GREEN 12 pax #vc115 (product_retailer_id quk9ne5y4o). Idempotente.
 * Ejecutar una vez: npx convex run whatsappCatalogs:seedCatalogProductos
 */
export const seedCatalogProductos = mutation({
  args: {},
  handler: async (ctx) => {
    const META_CATALOG_ID = "26198995209693859";
    const PROPERTY_ID = "js797fftx557dg5gb9yd9et8s581g9dy" as Id<"properties">;
    const PRODUCT_RETAILER_ID = "quk9ne5y4o";
    const now = Date.now();

    let catalog = (await ctx.db.query("whatsappCatalogs").collect()).find(
      (c) => c.whatsappCatalogId === META_CATALOG_ID
    );
    if (!catalog) {
      const id = await ctx.db.insert("whatsappCatalogs", {
        name: "Catálogo_productos",
        whatsappCatalogId: META_CATALOG_ID,
        isDefault: true,
        order: 0,
        createdAt: now,
        updatedAt: now,
      });
      catalog = (await ctx.db.get(id))!;
    }

    const existing = await ctx.db
      .query("propertyWhatsAppCatalog")
      .withIndex("by_property_and_catalog", (q) =>
        q.eq("propertyId", PROPERTY_ID).eq("catalogId", catalog._id)
      )
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
