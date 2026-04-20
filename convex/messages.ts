import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";

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
    await ctx.db.patch(args.conversationId, {
      lastMessageAt: args.createdAt,
    });
    return messageId;
  },
});

export const insertAssistantMessage = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    content: v.string(),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("messages", {
      conversationId: args.conversationId,
      sender: "assistant",
      content: args.content,
      createdAt: args.createdAt,
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
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("messages", {
      conversationId: args.conversationId,
      sender: "assistant",
      content: args.content,
      type: args.type ?? "text",
      mediaUrl: args.mediaUrl,
      metadata: args.metadata,
      createdAt: args.createdAt,
    });
  },
});

export const listRecent = query({
  args: {
    conversationId: v.id("conversations"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;
    const list = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", args.conversationId)
      )
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
