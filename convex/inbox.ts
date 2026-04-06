import { v } from "convex/values";
import { action } from "./_generated/server";
import { api, internal } from "./_generated/api";

/**
 * Enviar mensaje a WhatsApp vía YCloud desde el inbox (dashboard).
 * Soporta texto, imagen, audio y documento.
 * Requiere: conversationId, phone, y según tipo: text y/o mediaUrl.
 */
export const sendMessage = action({
  args: {
    conversationId: v.id("conversations"),
    phone: v.string(),
    type: v.union(
      v.literal("text"),
      v.literal("image"),
      v.literal("audio"),
      v.literal("document"),
      v.literal("product")
    ),
    text: v.optional(v.string()),
    /** URL para descargar el media (pre-firmada o pública) */
    mediaUrl: v.optional(v.string()),
    /** URL permanente para guardar en DB (S3 público); si no, se usa mediaUrl */
    mediaUrlForStorage: v.optional(v.string()),
    filename: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const apiKey = process.env.YCLOUD_API_KEY;
    const wabaNumber = process.env.YCLOUD_WABA_NUMBER;
    if (!apiKey || !wabaNumber) {
      throw new Error(
        "YCLOUD_API_KEY y YCLOUD_WABA_NUMBER deben estar configurados en Convex"
      );
    }

    const now = Date.now();
    const caption = args.text ?? "";

    if (args.type === "text") {
      if (!args.text?.trim()) throw new Error("Texto requerido para tipo text");
      await ctx.runAction(internal.ycloud.sendWhatsAppMessage, {
        to: args.phone,
        text: args.text,
        sendDirectly: true,
      });
      await ctx.runMutation(internal.messages.insertAssistantMessage, {
        conversationId: args.conversationId,
        content: args.text,
        createdAt: now,
      });
      await ctx.runMutation(internal.conversations.updateLastMessageAt, {
        conversationId: args.conversationId,
      });
      return { ok: true };
    }

    if (args.type === "product") {
      const metadata = args.metadata;
      let productRetailerIds: string[] = [];
      let bodyText = args.text || "Aquí tienes estas opciones:";

      if (metadata?.product) {
        // Single product
        const finca = metadata.product;
        bodyText = args.text || `Aquí tienes ${finca.title} 🏡`;
        // We need to resolve the productRetailerId. 
        // For simplicity in the manual flow, we'll try to find it or use a default catalog.
        const catalog = await ctx.runQuery(api.whatsappCatalogs.getDefault, {});
        if (catalog) {
          const property = await ctx.runQuery(api.fincas.getBySlug, { slug: finca.slug });
          if (property) {
            const entries = await ctx.runQuery(
              api.propertyWhatsAppCatalog.getProductRetailerIdsForProperties,
              { catalogId: catalog._id, propertyIds: [property._id] }
            );
            productRetailerIds = [entries[0]?.productRetailerId || (property._id as string)];
          }
        }
      } else if (metadata?.catalog) {
        // Multiple products
        const fincas = metadata.catalog;
        const catalog = await ctx.runQuery(api.whatsappCatalogs.getDefault, {});
        if (catalog) {
          const propertyIds: any[] = [];
          for (const f of fincas) {
            const property = await ctx.runQuery(api.fincas.getBySlug, { slug: f.slug });
            if (property) propertyIds.push(property._id);
          }
          if (propertyIds.length > 0) {
            const entries = await ctx.runQuery(
              api.propertyWhatsAppCatalog.getProductRetailerIdsForProperties,
              { catalogId: catalog._id, propertyIds }
            );
            const entryMap = new Map(entries.map((e: any) => [e.propertyId, e.productRetailerId]));
            productRetailerIds = propertyIds.map(id => (entryMap.get(id) as string) || (id as string));
          }
        }
      }

      if (productRetailerIds.length > 0) {
        const catalog = await ctx.runQuery(api.whatsappCatalogs.getDefault, {});
        await ctx.runAction(internal.ycloud.sendWhatsAppCatalogList, {
          to: args.phone,
          productRetailerIds,
          bodyText,
          catalogId: catalog?.whatsappCatalogId,
        });
      }

      await ctx.runMutation(internal.messages.insertAssistantMessageWithMedia, {
        conversationId: args.conversationId,
        content: bodyText,
        type: "product",
        metadata: args.metadata,
        createdAt: now,
      });
      await ctx.runMutation(internal.conversations.updateLastMessageAt, {
        conversationId: args.conversationId,
      });
      return { ok: true };
    }

    // Media: image, audio, document
    // YCloud acepta "link" (URL directa) o "id" (de upload). Usamos link para mayor compatibilidad.
    if (!args.mediaUrl?.trim()) {
      throw new Error("mediaUrl requerido para tipo image/audio/document");
    }

    const mediaPayload: Record<string, unknown> = {
      link: args.mediaUrl,
    };
    if (args.type === "document") {
      mediaPayload.filename = args.filename ?? `document_${Date.now()}`;
    }
    if (caption && (args.type === "image" || args.type === "document")) {
      mediaPayload.caption = caption;
    }

    const msgBody: Record<string, unknown> = {
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
    let resJson: Record<string, unknown> = {};
    try {
      resJson = resText ? (JSON.parse(resText) as Record<string, unknown>) : {};
    } catch {
      // Respuesta no JSON, asumir éxito si status fue 2xx
    }
    const err = resJson?.error as { message?: string } | undefined;
    if (err?.message) {
      throw new Error(`YCloud rechazó el mensaje: ${err.message}`);
    }
    const msg = resJson?.message as string | undefined;
    if (typeof msg === "string" && /error|unsupported|invalid|rejected/i.test(msg)) {
      throw new Error(`YCloud: ${msg}`);
    }
    const status = resJson?.status as string | undefined;
    if (status && !["accepted", "sent", "delivered"].includes(String(status).toLowerCase())) {
      throw new Error(`YCloud no envió: status=${status}`);
    }

    await ctx.runMutation(internal.messages.insertAssistantMessageWithMedia, {
      conversationId: args.conversationId,
      content: caption,
      type: args.type as "image" | "audio" | "document" | "text" | "video" | "product",
      mediaUrl: args.mediaUrlForStorage ?? args.mediaUrl,
      metadata: args.metadata,
      createdAt: now,
    });
    await ctx.runMutation(internal.conversations.updateLastMessageAt, {
      conversationId: args.conversationId,
    });

    return { ok: true };
  },
});
