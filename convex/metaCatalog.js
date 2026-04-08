'use node';
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteFromMetaCatalogs = exports.syncPropertyToAllCatalogs = exports.syncProductToMetaCatalog = exports.syncPropertyToCatalogs = exports.testMetaCatalogToken = exports.syncCatalogsFromMeta = void 0;
const values_1 = require("convex/values");
const server_1 = require("./_generated/server");
const api_1 = require("./_generated/api");
exports.syncCatalogsFromMeta = (0, server_1.action)({
    args: {
        catalogIds: values_1.v.optional(values_1.v.array(values_1.v.string())),
    },
    handler: async (ctx, args) => {
        const token = process.env.META_CATALOG_ACCESS_TOKEN;
        if (!token) {
            throw new Error('META_CATALOG_ACCESS_TOKEN no configurado');
        }
        const ids = args.catalogIds ?? ['26198995209693859', '803534855410286'];
        const catalogs = [];
        for (const catalogId of ids) {
            const res = await fetch(`${GRAPH_API_BASE}/${catalogId}?fields=id,name`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = (await res.json());
            if (!res.ok) {
                throw new Error(`Meta API error: ${res.status} - ${JSON.stringify(data)}`);
            }
            if (data.id && data.name) {
                catalogs.push({ id: data.id, name: data.name });
            }
        }
        if (catalogs.length === 0) {
            return { message: 'No se obtuvieron catálogos', catalogs: [] };
        }
        await ctx.runMutation(api_1.internal.whatsappCatalogs.syncFromMeta, { catalogs });
        return { message: 'Catálogos sincronizados', catalogs };
    },
});
exports.testMetaCatalogToken = (0, server_1.action)({
    args: { catalogId: values_1.v.string() },
    handler: async (ctx, args) => {
        const token = process.env.META_CATALOG_ACCESS_TOKEN;
        if (!token) {
            throw new Error('META_CATALOG_ACCESS_TOKEN no configurado. Usa: npx convex env set META_CATALOG_ACCESS_TOKEN <token>');
        }
        const url = `${GRAPH_API_BASE}/${args.catalogId}?access_token=${encodeURIComponent(token)}`;
        const res = await fetch(url);
        const text = await res.text();
        if (!res.ok) {
            throw new Error(`Meta API error: ${res.status} - ${text}`);
        }
        return JSON.parse(text);
    },
});
const GRAPH_API_BASE = 'https://graph.facebook.com/v19.0';
const PRODUCT_BASE_URL = process.env.CATALOG_PRODUCT_BASE_URL ||
    process.env.SITE_URL ||
    'https://fincasya.cloud';
function buildMetaPayload(prop, propertyId) {
    const retailerId = String(propertyId);
    const price = prop.priceBase ?? 0;
    const base = PRODUCT_BASE_URL.replace(/\/$/, '');
    const productUrl = `${base}/fincas/${retailerId}`;
    const productName = (prop.title || 'Finca').trim() || 'Finca';
    const payload = {
        id: retailerId,
        name: productName,
        title: productName,
        description: (prop.description || '').slice(0, 5000),
        price: `${price} COP`,
        availability: 'in stock',
        brand: 'Finca',
        condition: 'new',
        url: productUrl,
        link: productUrl,
    };
    const images = prop.images?.filter(Boolean) ?? [];
    if (images.length > 0) {
        payload.image_link = images[0];
        if (images.length > 1) {
            payload.additional_image_link = images.slice(1);
        }
    }
    if (prop.video) {
        payload.video = [{ url: prop.video, tag: [] }];
    }
    if (prop.priceBaja != null && prop.priceBaja > 0 && prop.priceBaja < price) {
        payload.sale_price = `${prop.priceBaja} COP`;
    }
    return payload;
}
async function getPropertyPayload(ctx, propertyId) {
    const prop = await ctx.runQuery(api_1.api.fincas.getById, { id: propertyId });
    if (!prop)
        return null;
    return buildMetaPayload(prop, propertyId);
}
exports.syncPropertyToCatalogs = (0, server_1.action)({
    args: { propertyId: values_1.v.id('properties') },
    handler: async (ctx, args) => {
        const token = process.env.META_CATALOG_ACCESS_TOKEN;
        if (!token) {
            throw new Error('META_CATALOG_ACCESS_TOKEN no configurado en Convex');
        }
        const links = (await ctx.runQuery(api_1.api.propertyWhatsAppCatalog.listByProperty, {
            propertyId: args.propertyId,
        }));
        const toSync = links.filter((l) => l.whatsappCatalogId);
        if (toSync.length === 0)
            return { synced: 0 };
        const prop = (await ctx.runQuery(api_1.api.fincas.getById, {
            id: args.propertyId,
        }));
        if (!prop)
            throw new Error(`Finca no encontrada: ${args.propertyId}`);
        const retailerId = String(args.propertyId);
        const payload = buildMetaPayload(prop, args.propertyId);
        const body = {
            item_type: 'PRODUCT_ITEM',
            allow_upsert: true,
            requests: [{ method: 'UPDATE', retailer_id: retailerId, data: payload }],
        };
        let synced = 0;
        for (const link of toSync) {
            const wid = link.whatsappCatalogId;
            const url = `${GRAPH_API_BASE}/${wid}/items_batch?access_token=${encodeURIComponent(token)}`;
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const text = await res.text();
            if (!res.ok)
                throw new Error(`Meta API error ${res.status} (catálogo ${wid}): ${text}`);
            const data = text
                ? JSON.parse(text)
                : {};
            for (const st of data.validation_status ?? []) {
                if (st.errors?.length) {
                    throw new Error(`Meta rechazó el producto (${st.retailer_id}): ${st.errors.map((e) => e.message).join('; ')}`);
                }
            }
            synced++;
        }
        return { synced };
    },
});
exports.syncProductToMetaCatalog = (0, server_1.internalAction)({
    args: {
        whatsappCatalogId: values_1.v.string(),
        propertyId: values_1.v.id('properties'),
        method: values_1.v.union(values_1.v.literal('CREATE'), values_1.v.literal('UPDATE')),
    },
    handler: async (ctx, args) => {
        const token = process.env.META_CATALOG_ACCESS_TOKEN;
        if (!token) {
            console.error('META_CATALOG_ACCESS_TOKEN no configurado en Convex');
            return;
        }
        const payload = await getPropertyPayload(ctx, args.propertyId);
        if (!payload)
            return;
        const retailerId = args.propertyId;
        const body = {
            item_type: 'PRODUCT_ITEM',
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
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const text = await res.text();
        if (!res.ok) {
            console.error('Meta items_batch error:', res.status, text);
            throw new Error(`Meta catalog sync failed: ${res.status} ${text}`);
        }
    },
});
exports.syncPropertyToAllCatalogs = (0, server_1.internalAction)({
    args: { propertyId: values_1.v.id('properties') },
    handler: async (ctx, args) => {
        const links = (await ctx.runQuery(api_1.api.propertyWhatsAppCatalog.listByProperty, {
            propertyId: args.propertyId,
        }));
        const token = process.env.META_CATALOG_ACCESS_TOKEN;
        if (!token)
            return;
        const payload = await getPropertyPayload(ctx, args.propertyId);
        if (!payload)
            return;
        for (const link of links) {
            if (!link.whatsappCatalogId)
                continue;
            const url = `${GRAPH_API_BASE}/${link.whatsappCatalogId}/items_batch?access_token=${encodeURIComponent(token)}`;
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    item_type: 'PRODUCT_ITEM',
                    requests: [
                        {
                            method: 'UPDATE',
                            retailer_id: link.productRetailerId,
                            data: payload,
                        },
                    ],
                }),
            });
            if (!res.ok) {
                console.error('Meta items_batch UPDATE error:', await res.text());
            }
        }
    },
});
exports.deleteFromMetaCatalogs = (0, server_1.internalAction)({
    args: {
        items: values_1.v.array(values_1.v.object({
            whatsappCatalogId: values_1.v.string(),
            retailer_id: values_1.v.string(),
        })),
    },
    handler: async (ctx, args) => {
        const token = process.env.META_CATALOG_ACCESS_TOKEN;
        if (!token) {
            console.error('META_CATALOG_ACCESS_TOKEN no configurado');
            return;
        }
        for (const item of args.items) {
            const url = `${GRAPH_API_BASE}/${item.whatsappCatalogId}/items_batch?access_token=${encodeURIComponent(token)}`;
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    item_type: 'PRODUCT_ITEM',
                    requests: [{ method: 'DELETE', retailer_id: item.retailer_id }],
                }),
            });
            if (!res.ok) {
                console.error('Meta items_batch DELETE error:', item.whatsappCatalogId, await res.text());
            }
        }
    },
});
//# sourceMappingURL=metaCatalog.js.map