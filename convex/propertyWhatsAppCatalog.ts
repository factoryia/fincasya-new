import { v } from "convex/values";
import { query, mutation, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
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

/** Todas las relaciones finca-catálogos. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("propertyWhatsAppCatalog").collect();
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

/**
 * Buscar una finca por product_retailer_id (opcionalmente acotando por whatsappCatalogId de Meta).
 */
export const getPropertyByRetailerId = query({
  args: {
    productRetailerId: v.string(),
    whatsappCatalogId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const needle = args.productRetailerId.trim();
    if (!needle) return null;

    const links = await ctx.db.query("propertyWhatsAppCatalog").collect();
    const matches = links.filter((l) => l.productRetailerId === needle);
    if (!matches.length) return null;

    for (const match of matches) {
      if (args.whatsappCatalogId) {
        const cat = await ctx.db.get(match.catalogId);
        if (!cat || cat.whatsappCatalogId !== args.whatsappCatalogId) continue;
      }
      const property = await ctx.db.get(match.propertyId);
      if (property) {
        return {
          propertyId: property._id,
          title: property.title,
          slug: property.slug ?? property.code ?? property._id,
        };
      }
    }
    return null;
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

/** Añadir o actualizar: esta finca en este catálogo con este product_retailer_id. Sincroniza con Meta. */
export const setPropertyInCatalog = mutation({
  args: {
    propertyId: v.id("properties"),
    catalogId: v.id("whatsappCatalogs"),
    productRetailerId: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const catalog = await ctx.db.get(args.catalogId);
    if (!catalog) throw new Error("Catálogo no encontrado");
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
      await ctx.scheduler.runAfter(0, internal.metaCatalog.syncProductToMetaCatalog, {
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
    await ctx.scheduler.runAfter(0, internal.metaCatalog.syncProductToMetaCatalog, {
      whatsappCatalogId: catalog.whatsappCatalogId,
      propertyId: args.propertyId,
      method: "CREATE",
    });
    return rowId;
  },
});

/** Quitar una finca de un catálogo. Borra también el producto en Meta. */
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
    if (row) {
      const catalog = await ctx.db.get(row.catalogId);
      if (catalog) {
        await ctx.scheduler.runAfter(0, internal.metaCatalog.deleteFromMetaCatalogs, {
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

/**
 * Reemplazar todos los catálogos de una finca. Sincroniza con Meta (CREATE por cada catálogo).
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
    const toDeleteFromMeta: { whatsappCatalogId: string; retailer_id: string }[] = [];
    for (const e of existing) {
      const catalog = await ctx.db.get(e.catalogId);
      if (catalog) toDeleteFromMeta.push({ whatsappCatalogId: catalog.whatsappCatalogId, retailer_id: e.productRetailerId });
      await ctx.db.delete(e._id);
    }
    if (toDeleteFromMeta.length > 0) {
      await ctx.scheduler.runAfter(0, internal.metaCatalog.deleteFromMetaCatalogs, {
        items: toDeleteFromMeta,
      });
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
      await ctx.scheduler.runAfter(0, internal.metaCatalog.syncProductToMetaCatalog, {
        whatsappCatalogId: catalog.whatsappCatalogId,
        propertyId: args.propertyId,
        method: "CREATE",
      });
    }
    return args.propertyId;
  },
});

/** Elimina vínculo roto finca-catálogo (uso interno desde acciones Node). */
export const detachBrokenPropertyCatalogLink = internalMutation({
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

    if (!row) return;
    await ctx.db.delete(row._id);
  },
});

/**
 * BULK SCRIPT: vincula todas las fincas activas + visibles al catálogo
 * WhatsApp cuya `locationKeyword` matchee su ubicación.
 *
 * Esto es lo que se debe correr cuando se agregan fincas a la BD y se quiere
 * que aparezcan en los envíos del bot por WhatsApp. Sin esta vinculación, el
 * query `getPayloadByLocationForN8n` no devuelve esas fincas aunque estén
 * activas en el catálogo de la web.
 *
 * Idempotente: si una finca ya tiene link al catálogo correcto, NO se duplica.
 * Si una finca no encaja con ninguna `locationKeyword`, se reporta en
 * `noMatchingCatalog` (no se intenta vincular al default).
 *
 * Convención: `productRetailerId = String(propertyId)` (igual que el sync
 * existente con Meta).
 *
 * Uso:
 *   bunx convex run propertyWhatsAppCatalog:bulkLinkActivePropertiesToWhatsAppCatalogs
 *   bunx convex run propertyWhatsAppCatalog:bulkLinkActivePropertiesToWhatsAppCatalogs '{"dryRun": true}'
 *
 * Con `dryRun: true` no inserta nada, solo retorna el reporte de lo que
 * haría. Útil para verificar antes de ejecutar el cambio real.
 *
 * Nota: NO sincroniza a Meta automáticamente. Después de correr esto, ejecuta
 * `metaCatalog:resyncAllLinkedPropertiesToMeta` para empujar los cambios al
 * catálogo de Meta. Los nuevos links recién creados también se programan
 * automáticamente vía `setPropertyInCatalog` → `syncProductToMetaCatalog`,
 * pero el resync global garantiza consistencia si algo falló.
 */
export const bulkLinkActivePropertiesToWhatsAppCatalogs = mutation({
  args: {
    /** Si true, solo retorna el reporte sin insertar links. Default false. */
    dryRun: v.optional(v.boolean()),
    /**
     * Si una finca no matchea ninguna locationKeyword, también vincularla al
     * catálogo `isDefault: true` (si existe). Default false (la finca queda
     * sin vincular y aparece en el reporte).
     */
    fallbackToDefault: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun === true;
    const fallbackToDefault = args.fallbackToDefault === true;
    const now = Date.now();

    const properties = await ctx.db.query("properties").collect();
    const catalogs = await ctx.db.query("whatsappCatalogs").collect();
    const allLinks = await ctx.db.query("propertyWhatsAppCatalog").collect();

    const defaultCatalog = catalogs.find((c) => c.isDefault === true) ?? null;
    const linksByProp = new Map<
      Id<"properties">,
      Array<{ catalogId: Id<"whatsappCatalogs">; productRetailerId: string }>
    >();
    for (const l of allLinks) {
      const arr = linksByProp.get(l.propertyId) ?? [];
      arr.push({
        catalogId: l.catalogId,
        productRetailerId: l.productRetailerId,
      });
      linksByProp.set(l.propertyId, arr);
    }

    const report = {
      totalProperties: properties.length,
      skippedInactive: 0,
      skippedInvisible: 0,
      alreadyLinked: 0,
      newlyLinked: 0,
      noMatchingCatalog: 0,
      linkedToDefault: 0,
      details: [] as Array<{
        propertyId: string;
        title: string | undefined;
        location: string;
        action: "skip-inactive" | "skip-invisible" | "already-linked" | "newly-linked" | "linked-to-default" | "no-matching-catalog";
        catalog?: { id: string; name?: string; locationKeyword?: string };
      }>,
    };

    for (const property of properties) {
      const id = property._id;
      const title = property.title;
      const location = String(property.location ?? "");
      if (property.active === false) {
        report.skippedInactive++;
        report.details.push({
          propertyId: String(id),
          title,
          location,
          action: "skip-inactive",
        });
        continue;
      }
      if (property.visible === false) {
        report.skippedInvisible++;
        report.details.push({
          propertyId: String(id),
          title,
          location,
          action: "skip-invisible",
        });
        continue;
      }
      if (property.visibleInWhatsAppCatalog === false) {
        report.skippedInvisible++;
        report.details.push({
          propertyId: String(id),
          title,
          location,
          action: "skip-invisible",
        });
        continue;
      }

      const locLower = location.toLowerCase();
      let matchingCatalog =
        catalogs.find(
          (c) =>
            c.locationKeyword &&
            locLower.includes(c.locationKeyword.toLowerCase()),
        ) ?? null;
      let linkedToDefault = false;
      if (!matchingCatalog && fallbackToDefault && defaultCatalog) {
        matchingCatalog = defaultCatalog;
        linkedToDefault = true;
      }
      if (!matchingCatalog) {
        report.noMatchingCatalog++;
        report.details.push({
          propertyId: String(id),
          title,
          location,
          action: "no-matching-catalog",
        });
        continue;
      }

      const propLinks = linksByProp.get(id) ?? [];
      const existing = propLinks.find((l) => l.catalogId === matchingCatalog._id);
      if (existing) {
        report.alreadyLinked++;
        report.details.push({
          propertyId: String(id),
          title,
          location,
          action: "already-linked",
          catalog: {
            id: String(matchingCatalog._id),
            name: matchingCatalog.name,
            locationKeyword: matchingCatalog.locationKeyword,
          },
        });
        continue;
      }

      if (!dryRun) {
        const retailerId = String(id);
        await ctx.db.insert("propertyWhatsAppCatalog", {
          propertyId: id,
          catalogId: matchingCatalog._id,
          productRetailerId: retailerId,
          createdAt: now,
          updatedAt: now,
        });
        // Programar push a Meta. Si META_CATALOG_ACCESS_TOKEN no está, el
        // handler de syncProductToMetaCatalog lo loguea y sigue.
        await ctx.scheduler.runAfter(
          0,
          internal.metaCatalog.syncProductToMetaCatalog,
          {
            whatsappCatalogId: matchingCatalog.whatsappCatalogId,
            propertyId: id,
            method: "CREATE",
          },
        );
      }
      if (linkedToDefault) report.linkedToDefault++;
      else report.newlyLinked++;
      report.details.push({
        propertyId: String(id),
        title,
        location,
        action: linkedToDefault ? "linked-to-default" : "newly-linked",
        catalog: {
          id: String(matchingCatalog._id),
          name: matchingCatalog.name,
          locationKeyword: matchingCatalog.locationKeyword,
        },
      });
    }

    return {
      dryRun,
      summary: {
        totalProperties: report.totalProperties,
        skippedInactive: report.skippedInactive,
        skippedInvisible: report.skippedInvisible,
        alreadyLinked: report.alreadyLinked,
        newlyLinked: report.newlyLinked,
        linkedToDefault: report.linkedToDefault,
        noMatchingCatalog: report.noMatchingCatalog,
      },
      details: report.details,
    };
  },
});
