import { v } from "convex/values";
import { action, type ActionCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { wamidFromYcloudSendResponse } from "./lib/ycloud/senders";

async function resolveRetailerIdForSlug(
  ctx: ActionCtx,
  slug: string,
): Promise<string | undefined> {
  const catalog = await ctx.runQuery(api.whatsappCatalogs.getDefault, {});
  if (!catalog) return undefined;
  const property = await ctx.runQuery(api.fincas.getBySlug, { slug });
  if (!property) return undefined;
  const entries = await ctx.runQuery(
    api.propertyWhatsAppCatalog.getProductRetailerIdsForProperties,
    { catalogId: catalog._id, propertyIds: [property._id] },
  );
  return entries[0]?.productRetailerId ?? (property._id as string);
}

async function enrichWebProductMetadata(
  ctx: ActionCtx,
  metadata: Record<string, unknown>,
  productRetailerId: string,
) {
  try {
    const prop = (await ctx.runQuery(api.whatsappCatalogs.getPropertyByRetailerId, {
      productRetailerId,
    })) as {
      imageUrl?: string;
      slug?: string;
      propertyId?: string;
      propertyName?: string;
      location?: string;
    } | null;
    if (prop?.imageUrl?.trim()) metadata.imageUrl = prop.imageUrl.trim();
    if (prop?.slug?.trim()) metadata.slug = prop.slug.trim();
    if (prop?.propertyId) metadata.propertyId = prop.propertyId;
    if (prop?.propertyName?.trim()) metadata.propertyName = prop.propertyName.trim();
    if (prop?.location?.trim()) metadata.location = prop.location.trim();
  } catch (err) {
    console.error("inbox: getPropertyByRetailerId (web):", err);
  }
}

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
    channel: v.optional(v.union(v.literal("whatsapp"), v.literal("web"))),
    /** Convex user._id del asesor que envía el mensaje (trazabilidad). */
    sentByUserId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const channel =
      args.channel ?? (args.phone.trim().toLowerCase().startsWith("web:") ? "web" : "whatsapp");
    const now = Date.now();
    const caption = args.text ?? "";

    const recordAssistantMessage = async (
      content: string,
      extra?: {
        type?: "image" | "audio" | "document" | "text" | "video" | "product";
        mediaUrl?: string;
        metadata?: unknown;
        wamid?: string;
        whatsappStatus?: string;
      },
    ) => {
      const outbound = {
        wamid: extra?.wamid,
        whatsappStatus: extra?.whatsappStatus as
          | "failed"
          | "accepted"
          | "sent"
          | "delivered"
          | "read"
          | undefined,
      };
      if (extra?.type && extra.type !== "text") {
        await ctx.runMutation(internal.messages.insertAssistantMessageWithMedia, {
          conversationId: args.conversationId,
          content,
          type: extra.type,
          mediaUrl: extra.mediaUrl,
          metadata: extra.metadata,
          createdAt: now,
          sentByUserId: args.sentByUserId,
          ...outbound,
        });
      } else {
        await ctx.runMutation(internal.messages.insertAssistantMessage, {
          conversationId: args.conversationId,
          content,
          createdAt: now,
          sentByUserId: args.sentByUserId,
          ...outbound,
        });
      }
      await ctx.runMutation(internal.conversations.updateLastMessageAt, {
        conversationId: args.conversationId,
      });
      if (args.sentByUserId) {
        await ctx.runMutation(internal.conversationAudit.recordEvent, {
          conversationId: args.conversationId,
          eventType: "message_sent",
          userId: args.sentByUserId,
        });
      }
    };

    if (channel === "web") {
      if (args.type === "text") {
        if (!args.text?.trim()) throw new Error("Texto requerido para tipo text");
        await recordAssistantMessage(args.text);
        return { ok: true };
      }

      if (args.type === "product") {
        const metadata = { ...(args.metadata ?? {}) } as Record<string, unknown>;
        let bodyText = args.text || "Aquí tienes estas opciones:";

        if (metadata?.product) {
          const finca = metadata.product as { title?: string; slug?: string };
          bodyText = args.text || `Aquí tienes ${finca.title ?? "esta finca"} 🏡`;
          const retailerId = finca.slug
            ? await resolveRetailerIdForSlug(ctx, finca.slug)
            : undefined;
          if (retailerId) {
            metadata.productRetailerId = retailerId;
            await enrichWebProductMetadata(ctx, metadata, retailerId);
          }
        } else if (Array.isArray(metadata?.catalog)) {
          const catalogItems = metadata.catalog as Array<{ slug?: string; title?: string }>;
          const enriched = [];
          for (const item of catalogItems) {
            if (!item.slug) continue;
            const retailerId = await resolveRetailerIdForSlug(ctx, item.slug);
            if (!retailerId) continue;
            const itemMeta: Record<string, unknown> = {
              productRetailerId: retailerId,
              productTitle: item.title,
            };
            await enrichWebProductMetadata(ctx, itemMeta, retailerId);
            enriched.push(itemMeta);
          }
          if (enriched.length > 0) metadata.catalogItems = enriched;
        }

        await recordAssistantMessage(bodyText, {
          type: "product",
          metadata,
        });
        return { ok: true };
      }

      if (!args.mediaUrl?.trim()) {
        throw new Error("mediaUrl requerido para tipo image/audio/document");
      }
      await recordAssistantMessage(caption, {
        type: args.type as "image" | "audio" | "document",
        mediaUrl: args.mediaUrlForStorage ?? args.mediaUrl,
        metadata: args.metadata,
      });
      return { ok: true };
    }

    const apiKey = process.env.YCLOUD_API_KEY;
    const wabaNumber = process.env.YCLOUD_WABA_NUMBER;
    if (!apiKey || !wabaNumber) {
      throw new Error(
        "YCLOUD_API_KEY y YCLOUD_WABA_NUMBER deben estar configurados en Convex"
      );
    }

    if (args.type === "text") {
      if (!args.text?.trim()) throw new Error("Texto requerido para tipo text");
      const sendResult = (await ctx.runAction(internal.ycloud.sendWhatsAppMessage, {
        to: args.phone,
        text: args.text,
        sendDirectly: true,
      })) as { wamid?: string; status?: string };
      await ctx.runMutation(internal.messages.insertAssistantMessage, {
        conversationId: args.conversationId,
        content: args.text,
        createdAt: now,
        sentByUserId: args.sentByUserId,
        wamid: sendResult?.wamid,
        whatsappStatus: (sendResult?.status as "sent" | undefined) ?? "sent",
      });
      await ctx.runMutation(internal.conversations.updateLastMessageAt, {
        conversationId: args.conversationId,
      });
      if (args.sentByUserId) {
        await ctx.runMutation(internal.conversationAudit.recordEvent, {
          conversationId: args.conversationId,
          eventType: "message_sent",
          userId: args.sentByUserId,
        });
      }
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
          conversationId: args.conversationId,
        });
      }

      await ctx.runMutation(internal.messages.insertAssistantMessageWithMedia, {
        conversationId: args.conversationId,
        content: bodyText,
        type: "product",
        metadata: args.metadata,
        createdAt: now,
        sentByUserId: args.sentByUserId,
      });
      await ctx.runMutation(internal.conversations.updateLastMessageAt, {
        conversationId: args.conversationId,
      });
      if (args.sentByUserId) {
        await ctx.runMutation(internal.conversationAudit.recordEvent, {
          conversationId: args.conversationId,
          eventType: "message_sent",
          userId: args.sentByUserId,
        });
      }
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
    const outboundWamid = wamidFromYcloudSendResponse(resJson);
    const initialStatus =
      status && ["accepted", "sent", "delivered", "read"].includes(String(status).toLowerCase())
        ? String(status).toLowerCase()
        : "sent";

    await ctx.runMutation(internal.messages.insertAssistantMessageWithMedia, {
      conversationId: args.conversationId,
      content: caption,
      type: args.type as "image" | "audio" | "document" | "text" | "video" | "product",
      mediaUrl: args.mediaUrlForStorage ?? args.mediaUrl,
      metadata: args.metadata,
      createdAt: now,
      sentByUserId: args.sentByUserId,
      wamid: outboundWamid,
      whatsappStatus: initialStatus as "sent" | "delivered" | "read" | "accepted",
    });

    await ctx.runMutation(internal.conversations.updateLastMessageAt, {
      conversationId: args.conversationId,
    });
    if (args.sentByUserId) {
      await ctx.runMutation(internal.conversationAudit.recordEvent, {
        conversationId: args.conversationId,
        eventType: "message_sent",
        userId: args.sentByUserId,
      });
    }

    return { ok: true };
  },
});
