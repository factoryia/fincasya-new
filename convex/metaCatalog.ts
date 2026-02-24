"use node";

import { v } from "convex/values";
import { internalAction, action } from "./_generated/server";
import { internal, api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/**
 * Sincroniza catálogos de Meta a whatsappCatalogs.
 * Usa GET /{catalogId}?fields=id,name (solo requiere catalog_management, no business_management).
 * Ejecutar: npx convex run metaCatalog:syncCatalogsFromMeta
 * O con IDs: npx convex run metaCatalog:syncCatalogsFromMeta '{"catalogIds": ["26198995209693859", "803534855410286"]}'
 */
export const syncCatalogsFromMeta = action({
  args: {
    /** IDs de catálogos en Meta. Por defecto: los dos catálogos conocidos. */
    catalogIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const token = process.env.META_CATALOG_ACCESS_TOKEN;
    if (!token) {
      throw new Error("META_CATALOG_ACCESS_TOKEN no configurado");
    }
    const ids = args.catalogIds ?? ["26198995209693859", "803534855410286"];
    const catalogs: Array<{ id: string; name: string }> = [];

    for (const catalogId of ids) {
      const res = await fetch(
        `${GRAPH_API_BASE}/${catalogId}?fields=id,name`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = (await res.json()) as { id?: string; name?: string; error?: { message: string } };
      if (!res.ok) {
        throw new Error(`Meta API error: ${res.status} - ${JSON.stringify(data)}`);
      }
      if (data.id && data.name) {
        catalogs.push({ id: data.id, name: data.name });
      }
    }

    if (catalogs.length === 0) {
      return { message: "No se obtuvieron catálogos", catalogs: [] };
    }
    await ctx.runMutation(internal.whatsappCatalogs.syncFromMeta, { catalogs });
    return { message: "Catálogos sincronizados", catalogs };
  },
});

/**
 * Probar token y catálogo: GET graph.facebook.com/v19.0/{CATALOG_ID}?access_token=TOKEN
 * Ejecutar: npx convex run metaCatalog:testMetaCatalogToken '{"catalogId": "26198995209693859"}'
 */
export const testMetaCatalogToken = action({
  args: { catalogId: v.string() },
  handler: async (ctx, args) => {
    const token = process.env.META_CATALOG_ACCESS_TOKEN;
    if (!token) {
      throw new Error("META_CATALOG_ACCESS_TOKEN no configurado. Usa: npx convex env set META_CATALOG_ACCESS_TOKEN <token>");
    }
    const url = `${GRAPH_API_BASE}/${args.catalogId}?access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url);
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Meta API error: ${res.status} - ${text}`);
    }
    return JSON.parse(text) as Record<string, unknown>;
  },
});

const GRAPH_API_BASE = "https://graph.facebook.com/v19.0";

/** URL base para enlace de producto. Configurar CATALOG_PRODUCT_BASE_URL si el frontend usa otra ruta (ej. https://fincasya.cloud/fincas/). */
const PRODUCT_BASE_URL = process.env.CATALOG_PRODUCT_BASE_URL || process.env.SITE_URL || "https://fincasya.cloud";

type PropForCatalog = {
  title?: string;
  description?: string;
  images?: string[];
  video?: string;
  priceBase?: number;
  priceBaja?: number;
};

function buildMetaPayload(prop: PropForCatalog, propertyId: Id<"properties">): Record<string, unknown> {
  const retailerId = String(propertyId);
  const price = prop.priceBase ?? 0;
  const base = PRODUCT_BASE_URL.replace(/\/$/, "");
  const productUrl = `${base}/fincas/${retailerId}`;
  const productName = (prop.title || "Finca").trim() || "Finca";
  const payload: Record<string, unknown> = {
    id: retailerId,
    name: productName,
    title: productName,
    description: (prop.description || "").slice(0, 5000),
    price: `${price} COP`,
    availability: "in stock",
    brand: "Finca",
    condition: "new",
    url: productUrl,
    link: productUrl,
  };
  const images = prop.images?.filter(Boolean) ?? [];
  if (images.length > 0) {
    payload.image = images.map((url) => ({ url, tag: [] }));
  }
  if (prop.video) {
    payload.video = [{ url: prop.video, tag: [] }];
  }
  // Solo enviar sale_price si es un descuento real (menor que el precio)
  if (
    prop.priceBaja != null &&
    prop.priceBaja > 0 &&
    prop.priceBaja < price
  ) {
    payload.sale_price = `${prop.priceBaja} COP`;
  }
  return payload;
}

async function getPropertyPayload(
  ctx: { runQuery: (query: typeof api.fincas.getById, args: { id: Id<"properties"> }) => Promise<PropForCatalog | null> },
  propertyId: Id<"properties">
) {
  const prop = await ctx.runQuery(api.fincas.getById, { id: propertyId });
  if (!prop) return null;
  return buildMetaPayload(prop, propertyId);
}

/**
 * Sincroniza una finca a todos los catálogos en propertyWhatsAppCatalog.
 * Lo llama Nest después de crear finca con catalogIds.
 */
export const syncPropertyToCatalogs = action({
  args: { propertyId: v.id("properties") },
  handler: async (ctx, args): Promise<{ synced: number }> => {
    const token = process.env.META_CATALOG_ACCESS_TOKEN;
    if (!token) {
      throw new Error("META_CATALOG_ACCESS_TOKEN no configurado en Convex");
    }
    const links = await ctx.runQuery(api.propertyWhatsAppCatalog.listByProperty, {
      propertyId: args.propertyId,
    }) as Array<{ whatsappCatalogId: string | null }>;
    const toSync = links.filter((l) => l.whatsappCatalogId);
    if (toSync.length === 0) return { synced: 0 };
    const prop = (await ctx.runQuery(api.fincas.getById, { id: args.propertyId })) as PropForCatalog | null;
    if (!prop) throw new Error(`Finca no encontrada: ${args.propertyId}`);
    const retailerId = String(args.propertyId);
    const payload = buildMetaPayload(prop, args.propertyId);
    const body = {
      item_type: "PRODUCT_ITEM",
      allow_upsert: true,
      requests: [{ method: "UPDATE", retailer_id: retailerId, data: payload }],
    };
    let synced = 0;
    for (const link of toSync) {
      const wid = link.whatsappCatalogId!;
      const url = `${GRAPH_API_BASE}/${wid}/items_batch?access_token=${encodeURIComponent(token)}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`Meta API error ${res.status} (catálogo ${wid}): ${text}`);
      const data = text ? (JSON.parse(text) as { validation_status?: Array<{ retailer_id: string; errors?: Array<{ message: string }> }> }) : {};
      for (const st of data.validation_status ?? []) {
        if (st.errors?.length) {
          throw new Error(`Meta rechazó el producto (${st.retailer_id}): ${st.errors.map((e) => e.message).join("; ")}`);
        }
      }
      synced++;
    }
    return { synced };
  },
});

/**
 * Sincroniza una finca con un catálogo de Meta (CREATE o UPDATE).
 * retailer_id = propertyId para consistencia (crear/actualizar/eliminar).
 */
export const syncProductToMetaCatalog = internalAction({
  args: {
    whatsappCatalogId: v.string(),
    propertyId: v.id("properties"),
    method: v.union(v.literal("CREATE"), v.literal("UPDATE")),
  },
  handler: async (ctx, args) => {
    const token = process.env.META_CATALOG_ACCESS_TOKEN;
    if (!token) {
      console.error("META_CATALOG_ACCESS_TOKEN no configurado en Convex");
      return;
    }
    const payload = await getPropertyPayload(ctx, args.propertyId);
    if (!payload) return;
    const retailerId = args.propertyId;
    const body: Record<string, unknown> = {
      item_type: "PRODUCT_ITEM",
      requests: [
        {
          method: args.method,
          retailer_id: retailerId,
          data: payload,
        },
      ],
    };
    const url = `${GRAPH_API_BASE}/${args.whatsappCatalogId}/items_batch?access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      console.error("Meta items_batch error:", res.status, text);
      throw new Error(`Meta catalog sync failed: ${res.status} ${text}`);
    }
  },
});

/**
 * Sincroniza una finca a todos los catálogos en los que está (UPDATE).
 */
export const syncPropertyToAllCatalogs = internalAction({
  args: { propertyId: v.id("properties") },
  handler: async (ctx, args) => {
    const links = await ctx.runQuery(api.propertyWhatsAppCatalog.listByProperty, {
      propertyId: args.propertyId,
    }) as Array<{ productRetailerId: string; whatsappCatalogId: string | null }>;
    const token = process.env.META_CATALOG_ACCESS_TOKEN;
    if (!token) return;
    const payload = await getPropertyPayload(ctx, args.propertyId);
    if (!payload) return;
    for (const link of links) {
      if (!link.whatsappCatalogId) continue;
      const url = `${GRAPH_API_BASE}/${link.whatsappCatalogId}/items_batch?access_token=${encodeURIComponent(token)}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          item_type: "PRODUCT_ITEM",
          requests: [{ method: "UPDATE", retailer_id: link.productRetailerId, data: payload }],
        }),
      });
      if (!res.ok) {
        console.error("Meta items_batch UPDATE error:", await res.text());
      }
    }
  },
});

/**
 * Elimina productos del catálogo de Meta por retailer_id (llamar al borrar una finca).
 */
export const deleteFromMetaCatalogs = internalAction({
  args: {
    items: v.array(
      v.object({
        whatsappCatalogId: v.string(),
        retailer_id: v.string(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const token = process.env.META_CATALOG_ACCESS_TOKEN;
    if (!token) {
      console.error("META_CATALOG_ACCESS_TOKEN no configurado");
      return;
    }
    for (const item of args.items) {
      const url = `${GRAPH_API_BASE}/${item.whatsappCatalogId}/items_batch?access_token=${encodeURIComponent(token)}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          item_type: "PRODUCT_ITEM",
          requests: [{ method: "DELETE", retailer_id: item.retailer_id }],
        }),
      });
      if (!res.ok) {
        console.error("Meta items_batch DELETE error:", item.whatsappCatalogId, await res.text());
      }
    }
  },
});
