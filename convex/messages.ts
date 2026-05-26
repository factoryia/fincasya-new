import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";

const whatsappStatusValidator = v.union(
  v.literal("failed"),
  v.literal("accepted"),
  v.literal("sent"),
  v.literal("delivered"),
  v.literal("read"),
);

const WHATSAPP_STATUS_RANK: Record<string, number> = {
  failed: 0,
  accepted: 1,
  sent: 2,
  delivered: 3,
  read: 4,
};

function resolveOutboundWamid(
  explicit?: string,
  metadata?: unknown,
): string | undefined {
  const fromArg = explicit?.trim();
  if (fromArg && fromArg.length > 6) return fromArg;
  if (metadata && typeof metadata === "object") {
    const w = (metadata as { wamid?: unknown }).wamid;
    if (typeof w === "string" && w.trim().length > 6) return w.trim();
  }
  return undefined;
}

function normalizeWhatsappStatus(
  raw?: string,
): "failed" | "accepted" | "sent" | "delivered" | "read" | undefined {
  const s = String(raw ?? "").toLowerCase();
  if (
    s === "failed" ||
    s === "accepted" ||
    s === "sent" ||
    s === "delivered" ||
    s === "read"
  ) {
    return s;
  }
  return undefined;
}

export const insertUserMessage = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    content: v.string(),
    createdAt: v.number(),
    type: v.optional(
      v.union(
        v.literal("text"),
        v.literal("image"),
        v.literal("audio"),
        v.literal("video"),
        v.literal("document"),
        v.literal("product")
      )
    ),
    mediaUrl: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const messageId = await ctx.db.insert("messages", {
      conversationId: args.conversationId,
      sender: "user",
      content: args.content,
      type: args.type ?? "text",
      mediaUrl: args.mediaUrl,
      metadata: args.metadata,
      createdAt: args.createdAt,
    });
    const conv = await ctx.db.get(args.conversationId);
    const prevUnread = conv?.inboxUnreadCount ?? 0;
    await ctx.db.patch(args.conversationId, {
      lastMessageAt: args.createdAt,
      inboxUnreadCount: prevUnread + 1,
    });
    return messageId;
  },
});

/**
 * Mensaje interno visible en el inbox (no WhatsApp).
 * Usado para alertas de escalación a humano, etc.
 */
export const insertSystemMessage = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    content: v.string(),
    createdAt: v.number(),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("messages", {
      conversationId: args.conversationId,
      sender: "system",
      content: args.content,
      type: "text",
      createdAt: args.createdAt,
      ...(args.metadata != null ? { metadata: args.metadata } : {}),
    });
    await ctx.db.patch(args.conversationId, {
      lastMessageAt: args.createdAt,
    });
  },
});

export const insertAssistantMessage = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    content: v.string(),
    createdAt: v.number(),
    sentByUserId: v.optional(v.string()),
    metadata: v.optional(v.any()),
    wamid: v.optional(v.string()),
    whatsappStatus: v.optional(whatsappStatusValidator),
  },
  handler: async (ctx, args) => {
    const wamid = resolveOutboundWamid(args.wamid, args.metadata);
    const whatsappStatus = normalizeWhatsappStatus(args.whatsappStatus);
    await ctx.db.insert("messages", {
      conversationId: args.conversationId,
      sender: "assistant",
      content: args.content,
      createdAt: args.createdAt,
      sentByUserId: args.sentByUserId,
      ...(args.metadata != null ? { metadata: args.metadata } : {}),
      ...(wamid ? { wamid } : {}),
      ...(whatsappStatus ? { whatsappStatus } : {}),
    });
  },
});

/** Insertar mensaje del asistente con soporte para media (imagen, audio, video, documento). */
export const insertAssistantMessageWithMedia = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    content: v.string(),
    type: v.optional(
      v.union(
        v.literal("text"),
        v.literal("image"),
        v.literal("audio"),
        v.literal("video"),
        v.literal("document"),
        v.literal("product")
      )
    ),
    mediaUrl: v.optional(v.string()),
    metadata: v.optional(v.any()),
    createdAt: v.number(),
    sentByUserId: v.optional(v.string()),
    wamid: v.optional(v.string()),
    whatsappStatus: v.optional(whatsappStatusValidator),
  },
  handler: async (ctx, args) => {
    const wamid = resolveOutboundWamid(args.wamid, args.metadata);
    const whatsappStatus = normalizeWhatsappStatus(args.whatsappStatus);
    await ctx.db.insert("messages", {
      conversationId: args.conversationId,
      sender: "assistant",
      content: args.content,
      type: args.type ?? "text",
      mediaUrl: args.mediaUrl,
      metadata: args.metadata,
      createdAt: args.createdAt,
      sentByUserId: args.sentByUserId,
      ...(wamid ? { wamid } : {}),
      ...(whatsappStatus ? { whatsappStatus } : {}),
    });
  },
});

/** Actualiza estado de entrega/lectura cuando YCloud envía `whatsapp.message.updated`. */
export const updateWhatsappStatusByWamid = internalMutation({
  args: {
    wamid: v.string(),
    status: whatsappStatusValidator,
  },
  handler: async (ctx, args) => {
    const w = args.wamid.trim();
    if (w.length < 6) return { updated: false as const };
    const msg = await ctx.db
      .query("messages")
      .withIndex("by_wamid", (q) => q.eq("wamid", w))
      .first();
    if (!msg) return { updated: false as const };
    const cur = msg.whatsappStatus;
    const curRank = cur ? (WHATSAPP_STATUS_RANK[cur] ?? -1) : -1;
    const newRank = WHATSAPP_STATUS_RANK[args.status] ?? 0;
    if (newRank <= curRank) return { updated: false as const };
    await ctx.db.patch(msg._id, { whatsappStatus: args.status });
    return { updated: true as const };
  },
});

export const listRecent = query({
  args: {
    conversationId: v.id("conversations"),
    limit: v.optional(v.number()),
    /**
     * Si se envía, devuelve los mensajes anteriores a este `createdAt` (exclusivo),
     * en orden cronológico ascendente (igual que sin cursor). Sirve para scroll infinito hacia arriba.
     */
    beforeCreatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 150);
    const list = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) => {
        const base = q.eq("conversationId", args.conversationId);
        return args.beforeCreatedAt != null
          ? base.lt("createdAt", args.beforeCreatedAt)
          : base;
      })
      .order("desc")
      .take(limit);
    return list.reverse();
  },
});

/**
 * Devuelve el último mensaje del usuario en una conversación (si existe).
 * Se usa para evitar respuestas duplicadas cuando llegan ráfagas.
 */
export const getLatestUserMessage = query({
  args: {
    conversationId: v.id("conversations"),
    scanLimit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const scanLimit = Math.max(1, Math.min(args.scanLimit ?? 50, 200));
    const recent = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", args.conversationId)
      )
      .order("desc")
      .take(scanLimit);
    return recent.find((m) => m.sender === "user") ?? null;
  },
});

export const updateMessageContent = internalMutation({
  args: {
    messageId: v.id("messages"),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.messageId, { content: args.content });
  },
});
