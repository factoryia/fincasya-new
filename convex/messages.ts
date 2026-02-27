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
        v.literal("document")
      )
    ),
    mediaUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("messages", {
      conversationId: args.conversationId,
      sender: "user",
      content: args.content,
      type: args.type ?? "text",
      mediaUrl: args.mediaUrl,
      createdAt: args.createdAt,
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
        v.literal("document")
      )
    ),
    mediaUrl: v.optional(v.string()),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("messages", {
      conversationId: args.conversationId,
      sender: "assistant",
      content: args.content,
      type: args.type ?? "text",
      mediaUrl: args.mediaUrl,
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
