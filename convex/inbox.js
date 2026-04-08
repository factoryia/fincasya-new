"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendMessage = void 0;
const values_1 = require("convex/values");
const server_1 = require("./_generated/server");
const api_1 = require("./_generated/api");
exports.sendMessage = (0, server_1.action)({
    args: {
        conversationId: values_1.v.id("conversations"),
        phone: values_1.v.string(),
        type: values_1.v.union(values_1.v.literal("text"), values_1.v.literal("image"), values_1.v.literal("audio"), values_1.v.literal("document"), values_1.v.literal("product")),
        text: values_1.v.optional(values_1.v.string()),
        mediaUrl: values_1.v.optional(values_1.v.string()),
        mediaUrlForStorage: values_1.v.optional(values_1.v.string()),
        filename: values_1.v.optional(values_1.v.string()),
        metadata: values_1.v.optional(values_1.v.any()),
    },
    handler: async (ctx, args) => {
        const apiKey = process.env.YCLOUD_API_KEY;
        const wabaNumber = process.env.YCLOUD_WABA_NUMBER;
        if (!apiKey || !wabaNumber) {
            throw new Error("YCLOUD_API_KEY y YCLOUD_WABA_NUMBER deben estar configurados en Convex");
        }
        const now = Date.now();
        const caption = args.text ?? "";
        if (args.type === "text") {
            if (!args.text?.trim())
                throw new Error("Texto requerido para tipo text");
            await ctx.runAction(api_1.internal.ycloud.sendWhatsAppMessage, {
                to: args.phone,
                text: args.text,
                sendDirectly: true,
            });
            await ctx.runMutation(api_1.internal.messages.insertAssistantMessage, {
                conversationId: args.conversationId,
                content: args.text,
                createdAt: now,
            });
            await ctx.runMutation(api_1.internal.conversations.updateLastMessageAt, {
                conversationId: args.conversationId,
            });
            return { ok: true };
        }
        if (args.type === "product") {
            const metadata = args.metadata;
            let productRetailerIds = [];
            let bodyText = args.text || "Aquí tienes estas opciones:";
            if (metadata?.product) {
                const finca = metadata.product;
                bodyText = args.text || `Aquí tienes ${finca.title} 🏡`;
                const catalog = await ctx.runQuery(api_1.api.whatsappCatalogs.getDefault, {});
                if (catalog) {
                    const property = await ctx.runQuery(api_1.api.fincas.getBySlug, { slug: finca.slug });
                    if (property) {
                        const entries = await ctx.runQuery(api_1.api.propertyWhatsAppCatalog.getProductRetailerIdsForProperties, { catalogId: catalog._id, propertyIds: [property._id] });
                        productRetailerIds = [entries[0]?.productRetailerId || property._id];
                    }
                }
            }
            else if (metadata?.catalog) {
                const fincas = metadata.catalog;
                const catalog = await ctx.runQuery(api_1.api.whatsappCatalogs.getDefault, {});
                if (catalog) {
                    const propertyIds = [];
                    for (const f of fincas) {
                        const property = await ctx.runQuery(api_1.api.fincas.getBySlug, { slug: f.slug });
                        if (property)
                            propertyIds.push(property._id);
                    }
                    if (propertyIds.length > 0) {
                        const entries = await ctx.runQuery(api_1.api.propertyWhatsAppCatalog.getProductRetailerIdsForProperties, { catalogId: catalog._id, propertyIds });
                        const entryMap = new Map(entries.map((e) => [e.propertyId, e.productRetailerId]));
                        productRetailerIds = propertyIds.map(id => entryMap.get(id) || id);
                    }
                }
            }
            if (productRetailerIds.length > 0) {
                const catalog = await ctx.runQuery(api_1.api.whatsappCatalogs.getDefault, {});
                await ctx.runAction(api_1.internal.ycloud.sendWhatsAppCatalogList, {
                    to: args.phone,
                    productRetailerIds,
                    bodyText,
                    catalogId: catalog?.whatsappCatalogId,
                });
            }
            await ctx.runMutation(api_1.internal.messages.insertAssistantMessageWithMedia, {
                conversationId: args.conversationId,
                content: bodyText,
                type: "product",
                metadata: args.metadata,
                createdAt: now,
            });
            await ctx.runMutation(api_1.internal.conversations.updateLastMessageAt, {
                conversationId: args.conversationId,
            });
            return { ok: true };
        }
        if (!args.mediaUrl?.trim()) {
            throw new Error("mediaUrl requerido para tipo image/audio/document");
        }
        const mediaPayload = {
            link: args.mediaUrl,
        };
        if (args.type === "document") {
            mediaPayload.filename = args.filename ?? `document_${Date.now()}`;
        }
        if (caption && (args.type === "image" || args.type === "document")) {
            mediaPayload.caption = caption;
        }
        const msgBody = {
            from: wabaNumber,
            to: args.phone,
            type: args.type,
            [args.type]: mediaPayload,
        };
        const sendRes = await fetch("https://api.ycloud.com/v2/whatsapp/messages/sendDirectly", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
            body: JSON.stringify(msgBody),
        });
        const resText = await sendRes.text();
        if (!sendRes.ok) {
            throw new Error(`YCloud send failed: ${sendRes.status} - ${resText}`);
        }
        let resJson = {};
        try {
            resJson = resText ? JSON.parse(resText) : {};
        }
        catch {
        }
        const err = resJson?.error;
        if (err?.message) {
            throw new Error(`YCloud rechazó el mensaje: ${err.message}`);
        }
        const msg = resJson?.message;
        if (typeof msg === "string" && /error|unsupported|invalid|rejected/i.test(msg)) {
            throw new Error(`YCloud: ${msg}`);
        }
        const status = resJson?.status;
        if (status && !["accepted", "sent", "delivered"].includes(String(status).toLowerCase())) {
            throw new Error(`YCloud no envió: status=${status}`);
        }
        await ctx.runMutation(api_1.internal.messages.insertAssistantMessageWithMedia, {
            conversationId: args.conversationId,
            content: caption,
            type: args.type,
            mediaUrl: args.mediaUrlForStorage ?? args.mediaUrl,
            metadata: args.metadata,
            createdAt: now,
        });
        await ctx.runMutation(api_1.internal.conversations.updateLastMessageAt, {
            conversationId: args.conversationId,
        });
        return { ok: true };
    },
});
//# sourceMappingURL=inbox.js.map