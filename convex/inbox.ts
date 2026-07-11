import { v } from "convex/values";
import { action, type ActionCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { wamidFromYcloudSendResponse, sendAudioToYcloud } from "./lib/ycloud/senders";

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
    /** wamid del mensaje citado (responder en WhatsApp). */
    replyToWamid: v.optional(v.string()),
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
        replyToWamid?: string;
      },
    ) => {
      const replyToWamid = String(extra?.replyToWamid ?? args.replyToWamid ?? "").trim();
      const baseMeta = {
        ...(args.metadata && typeof args.metadata === "object"
          ? (args.metadata as Record<string, unknown>)
          : {}),
        ...(extra?.metadata && typeof extra.metadata === "object"
          ? (extra.metadata as Record<string, unknown>)
          : {}),
      };
      const mergedMetadata =
        replyToWamid.length > 6
          ? { ...baseMeta, replyToWamid }
          : Object.keys(baseMeta).length > 0
            ? baseMeta
            : extra?.metadata;
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
          metadata: mergedMetadata,
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
          metadata: mergedMetadata,
          ...outbound,
        });
      }
      await ctx.runMutation(internal.conversations.updateLastMessageAt, {
        conversationId: args.conversationId,
      });
      if (args.sentByUserId) {
        await ctx.runMutation(api.conversations.markInboxRead, {
          conversationId: args.conversationId,
        });
        await ctx.runMutation(internal.conversationAudit.recordEvent, {
          conversationId: args.conversationId,
          eventType: "message_sent",
          userId: args.sentByUserId,
        });
        // Un asesor humano tomó control: si la conversación estaba en modo IA,
        // pasarla a humano para que el bot no interrumpa al cliente siguiente.
        // Es el mismo comportamiento que markOutboundAsHuman para WhatsApp.
        await ctx.runMutation(internal.conversations.escalate, {
          conversationId: args.conversationId,
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
        type FincaMeta = {
          title?: string;
          slug?: string;
          image?: string;
          price?: number;
        };

        const rawMeta = { ...(args.metadata ?? {}) } as Record<string, unknown>;
        let items: Array<{ finca: FincaMeta; bodyText: string }> = [];

        if (rawMeta.product && typeof rawMeta.product === "object") {
          const finca = rawMeta.product as FincaMeta;
          items = [
            {
              finca,
              bodyText: args.text || `Aquí tienes ${finca.title ?? "esta finca"} 🏡`,
            },
          ];
        } else if (Array.isArray(rawMeta.catalog)) {
          const catalog = rawMeta.catalog as FincaMeta[];
          items = catalog.map((finca, i) => ({
            finca,
            bodyText:
              i === 0 && args.text?.trim()
                ? args.text
                : `Aquí tienes la información de ${finca.title ?? "esta finca"} 🏡`,
          }));
        } else {
          throw new Error("metadata.product o metadata.catalog requerido");
        }

        for (let i = 0; i < items.length; i++) {
          const { finca, bodyText } = items[i];
          const itemMeta: Record<string, unknown> = { product: finca };
          if (finca.slug) {
            const retailerId = await resolveRetailerIdForSlug(ctx, finca.slug);
            if (retailerId) {
              itemMeta.productRetailerId = retailerId;
              itemMeta.productTitle = finca.title;
              await enrichWebProductMetadata(ctx, itemMeta, retailerId);
            }
          }
          await recordAssistantMessage(bodyText, {
            type: "product",
            metadata: itemMeta,
          });
        }
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
      const replyWamid = String(args.replyToWamid ?? "").trim();
      const sendResult = (await ctx.runAction(internal.ycloud.sendWhatsAppMessage, {
        to: args.phone,
        text: args.text,
        wamid: replyWamid.length > 6 ? replyWamid : undefined,
        sendDirectly: true,
      })) as { wamid?: string; status?: string };
      await ctx.runMutation(internal.messages.insertAssistantMessage, {
        conversationId: args.conversationId,
        content: args.text,
        createdAt: now,
        sentByUserId: args.sentByUserId,
        wamid: sendResult?.wamid,
        whatsappStatus: (sendResult?.status as "sent" | undefined) ?? "sent",
        metadata: {
          ...(args.metadata && typeof args.metadata === "object"
            ? (args.metadata as Record<string, unknown>)
            : {}),
          ...(replyWamid.length > 6 ? { replyToWamid: replyWamid } : {}),
        },
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
      type FincaMeta = {
        title?: string;
        slug?: string;
        image?: string;
        price?: number;
      };

      const rawMeta = (args.metadata ?? {}) as {
        product?: FincaMeta;
        catalog?: FincaMeta[];
      };

      let items: Array<{ finca: FincaMeta; bodyText: string }> = [];

      if (rawMeta.product) {
        const finca = rawMeta.product;
        items = [
          {
            finca,
            bodyText: args.text || `Aquí tienes ${finca.title ?? "esta finca"} 🏡`,
          },
        ];
      } else if (Array.isArray(rawMeta.catalog)) {
        items = rawMeta.catalog.map((finca, i) => ({
          finca,
          bodyText:
            i === 0 && args.text?.trim()
              ? args.text
              : `Aquí tienes la información de ${finca.title ?? "esta finca"} 🏡`,
        }));
      } else {
        throw new Error("metadata.product o metadata.catalog requerido");
      }

      const waCatalog = await ctx.runQuery(api.whatsappCatalogs.getDefault, {});
      const resolved: Array<{
        finca: FincaMeta;
        bodyText: string;
        retailerId?: string;
      }> = [];

      for (const item of items) {
        let retailerId: string | undefined;
        if (waCatalog && item.finca.slug) {
          const property = await ctx.runQuery(api.fincas.getBySlug, {
            slug: item.finca.slug,
          });
          if (property) {
            const entries = await ctx.runQuery(
              api.propertyWhatsAppCatalog.getProductRetailerIdsForProperties,
              { catalogId: waCatalog._id, propertyIds: [property._id] },
            );
            retailerId =
              entries[0]?.productRetailerId || (property._id as string);
          }
        }
        resolved.push({ ...item, retailerId });
      }

      const productRetailerIds = resolved
        .map((r) => r.retailerId)
        .filter((id): id is string => Boolean(id?.trim()));

      let sendRows: Array<{ productRetailerId: string; wamid?: string; ok: boolean }> =
        [];
      if (productRetailerIds.length > 0) {
        sendRows = await ctx.runAction(internal.ycloud.sendWhatsAppCatalogList, {
          to: args.phone,
          productRetailerIds,
          bodyText: resolved[0]?.bodyText,
          catalogId: waCatalog?.whatsappCatalogId,
          conversationId: args.conversationId,
          // Envío manual del asesor: respetar la selección completa sin cortar a 12.
          ...(args.sentByUserId ? { limit: productRetailerIds.length } : {}),
        });
      }

      const rowByRetailerId = new Map(
        sendRows.map((row) => [row.productRetailerId, row]),
      );

      for (let i = 0; i < resolved.length; i++) {
        const { finca, bodyText, retailerId } = resolved[i];
        const row = retailerId ? rowByRetailerId.get(retailerId) : undefined;
        if (retailerId && row?.ok === false) continue;

        await ctx.runMutation(internal.messages.insertAssistantMessageWithMedia, {
          conversationId: args.conversationId,
          content: bodyText,
          type: "product",
          metadata: {
            product: finca,
            ...(retailerId
              ? { productRetailerId: retailerId, productTitle: finca.title }
              : {}),
          },
          createdAt: now + i * 25,
          sentByUserId: args.sentByUserId,
          wamid: row?.wamid,
          whatsappStatus: row?.wamid ? ("sent" as const) : undefined,
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
      return { ok: true };
    }

    // Media: image, audio, document
    if (!args.mediaUrl?.trim()) {
      throw new Error("mediaUrl requerido para tipo image/audio/document");
    }

    const replyWamid = String(args.replyToWamid ?? "").trim();

    if (args.type === "audio") {
      const audioRes = await fetch(args.mediaUrl);
      if (!audioRes.ok) {
        throw new Error(
          `No se pudo descargar el audio para WhatsApp: ${audioRes.status}`,
        );
      }
      const audioBuffer = new Uint8Array(await audioRes.arrayBuffer());
      const rawMime =
        audioRes.headers.get("content-type") ||
        (args.filename?.toLowerCase().endsWith(".m4a")
          ? "audio/mp4"
          : args.filename?.toLowerCase().endsWith(".mp3")
            ? "audio/mpeg"
            : "audio/ogg");

      const sendResult = await sendAudioToYcloud({
        to: args.phone,
        audioBuffer,
        mimeType: rawMime,
        filename: args.filename,
        wamid: replyWamid.length > 6 ? replyWamid : undefined,
      });

      await ctx.runMutation(internal.messages.insertAssistantMessageWithMedia, {
        conversationId: args.conversationId,
        content: caption,
        type: "audio",
        mediaUrl: args.mediaUrlForStorage ?? args.mediaUrl,
        metadata: args.metadata,
        createdAt: now,
        sentByUserId: args.sentByUserId,
        wamid: sendResult.wamid,
        whatsappStatus: (sendResult.status as "sent" | undefined) ?? "sent",
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

    // Imagen / documento: link (URL directa) o id (upload).
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
