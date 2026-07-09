import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { findContactByPhone } from "./lib/contactLookup";

/** Mismo criterio que el webhook YCloud: `evt.from` suele venir en E.164 con +. */
function normalizeWhatsappPhone(raw: string): string {
  const s = String(raw ?? "").trim().replace(/\s/g, "");
  if (!s) return "";
  const digits = s.replace(/^\+/, "").replace(/\D/g, "");
  if (!digits) return "";
  return `+${digits}`;
}

/**
 * Persistir en inbox lo que el flujo n8n ya envió por YCloud (texto o ficha de catálogo).
 * Resuelve contacto + conversación como el bot Convex.
 */
const N8N_ASSISTANT_METADATA = { source: "n8n_ycloud_inbound" as const };

export const logOutboundAssistantMessage = mutation({
  args: {
    phone: v.string(),
    customerName: v.optional(v.string()),
    content: v.string(),
    messageType: v.optional(v.union(v.literal("text"), v.literal("product"))),
    metadata: v.optional(v.any()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: true; conversationId: Id<"conversations"> }> => {
    const phone = normalizeWhatsappPhone(args.phone);
    const content = String(args.content ?? "").trim();
    if (!phone) throw new Error("phone requerido (E.164 o dígitos)");
    if (!content) throw new Error("content requerido");

    const contactId: Id<"contacts"> = await ctx.runMutation(
      internal.ycloud.getOrCreateContact,
      {
        phone,
        name: String(args.customerName ?? "").trim() || phone,
      },
    );
    const conv: {
      conversationId: Id<"conversations">;
      isNew: boolean;
      isReactivated: boolean;
    } = await ctx.runMutation(internal.ycloud.getOrCreateConversation, {
      contactId,
    });
    const conversationId = conv.conversationId;
    const now = Date.now();
    const mt = args.messageType ?? "text";

    if (mt === "product") {
      await ctx.runMutation(internal.messages.insertAssistantMessageWithMedia, {
        conversationId,
        content,
        type: "product",
        metadata: {
          ...N8N_ASSISTANT_METADATA,
          ...(args.metadata != null && typeof args.metadata === "object"
            ? (args.metadata as Record<string, unknown>)
            : {}),
        },
        createdAt: now,
      });
    } else {
      await ctx.runMutation(internal.messages.insertAssistantMessage, {
        conversationId,
        content,
        createdAt: now,
        metadata: { ...N8N_ASSISTANT_METADATA, ...(args.metadata ?? {}) },
      });
    }
    await ctx.runMutation(internal.conversations.updateLastMessageAt, {
      conversationId,
    });
    return { ok: true as const, conversationId };
  },
});

type UserMsgType = "text" | "image" | "audio" | "video" | "document" | "product";

function normalizeInboundMessageType(raw: string): UserMsgType {
  const t = String(raw ?? "text").toLowerCase().trim();
  if (
    t === "image" ||
    t === "audio" ||
    t === "video" ||
    t === "document" ||
    t === "product"
  ) {
    return t;
  }
  return "text";
}

/**
 * Mensaje entrante del cliente (n8n/YCloud) → misma tabla `messages` que el webhook Convex.
 */
export const logInboundUserMessage = mutation({
  args: {
    phone: v.string(),
    customerName: v.optional(v.string()),
    content: v.string(),
    messageType: v.string(),
    mediaUrl: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    ok: true;
    conversationId: Id<"conversations">;
    messageId: Id<"messages">;
  }> => {
    const phone = normalizeWhatsappPhone(args.phone);
    const content = String(args.content ?? "").trim();
    if (!phone) throw new Error("phone requerido (E.164 o dígitos)");
    if (!content) throw new Error("content requerido");

    const contactId: Id<"contacts"> = await ctx.runMutation(
      internal.ycloud.getOrCreateContact,
      {
        phone,
        name: String(args.customerName ?? "").trim() || phone,
      },
    );
    const conv: {
      conversationId: Id<"conversations">;
      isNew: boolean;
      isReactivated: boolean;
    } = await ctx.runMutation(internal.ycloud.getOrCreateConversation, {
      contactId,
    });
    const conversationId = conv.conversationId;
    const now = Date.now();
    const type = normalizeInboundMessageType(args.messageType);
    const mediaUrl =
      args.mediaUrl != null && String(args.mediaUrl).trim()
        ? String(args.mediaUrl).trim()
        : undefined;

    const messageId: Id<"messages"> = await ctx.runMutation(
      internal.messages.insertUserMessage,
      {
        conversationId,
        content,
        createdAt: now,
        type,
        ...(mediaUrl ? { mediaUrl } : {}),
        ...(args.metadata != null ? { metadata: args.metadata } : {}),
      },
    );

    return { ok: true as const, conversationId, messageId };
  },
});

/**
 * n8n: ¿puede contestar la IA? Si la conversación está en `human`, no.
 */
export const getN8nBotReplyAllowed = query({
  args: { phone: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ runBot: boolean; conversationStatus: string | null }> => {
    const phone = normalizeWhatsappPhone(args.phone);
    if (!phone) return { runBot: true, conversationStatus: null };
    const contact = await findContactByPhone(ctx, phone);
    if (!contact) return { runBot: true, conversationStatus: null };
    const conv = await ctx.db
      .query("conversations")
      .withIndex("by_contact", (q) => q.eq("contactId", contact._id))
      .order("desc")
      .first();
    if (!conv) return { runBot: true, conversationStatus: null };
    const runBot = conv.status !== "human";
    return { runBot, conversationStatus: conv.status };
  },
});

/** YCloud avisó mensaje saliente (humano) → misma lógica que webhook Convex `markOutboundAsHuman`. */
export const markOutboundHumanFromN8n = mutation({
  args: { phone: v.string() },
  handler: async (ctx, args): Promise<{ ok: true } | { ok: false; reason: string }> => {
    const phone = normalizeWhatsappPhone(args.phone);
    if (!phone) return { ok: false, reason: "phone inválido" };
    await ctx.runMutation(internal.ycloud.markOutboundAsHuman, { phone });
    return { ok: true as const };
  },
});

/** Volver a modo IA por teléfono (n8n o automatización). */
export const resumeAiByPhoneFromN8n = mutation({
  args: { phone: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: true } | { ok: false; reason: string }> => {
    const phone = normalizeWhatsappPhone(args.phone);
    if (!phone) return { ok: false, reason: "phone inválido" };
    const contact = await findContactByPhone(ctx, phone);
    if (!contact) return { ok: false, reason: "contacto no encontrado" };
    const conv = await ctx.db
      .query("conversations")
      .withIndex("by_contact", (q) => q.eq("contactId", contact._id))
      .order("desc")
      .first();
    if (!conv) return { ok: false, reason: "conversación no encontrada" };
    await ctx.runMutation(internal.conversations.setToAi, {
      conversationId: conv._id,
    });
    return { ok: true as const };
  },
});
