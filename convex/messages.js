"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateMessageContent = exports.listRecent = exports.insertAssistantMessageWithMedia = exports.insertAssistantMessage = exports.insertUserMessage = void 0;
const values_1 = require("convex/values");
const server_1 = require("./_generated/server");
exports.insertUserMessage = (0, server_1.internalMutation)({
    args: {
        conversationId: values_1.v.id("conversations"),
        content: values_1.v.string(),
        createdAt: values_1.v.number(),
        type: values_1.v.optional(values_1.v.union(values_1.v.literal("text"), values_1.v.literal("image"), values_1.v.literal("audio"), values_1.v.literal("video"), values_1.v.literal("document"), values_1.v.literal("product"))),
        mediaUrl: values_1.v.optional(values_1.v.string()),
        metadata: values_1.v.optional(values_1.v.any()),
    },
    handler: async (ctx, args) => {
        await ctx.db.insert("messages", {
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
    },
});
exports.insertAssistantMessage = (0, server_1.internalMutation)({
    args: {
        conversationId: values_1.v.id("conversations"),
        content: values_1.v.string(),
        createdAt: values_1.v.number(),
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
exports.insertAssistantMessageWithMedia = (0, server_1.internalMutation)({
    args: {
        conversationId: values_1.v.id("conversations"),
        content: values_1.v.string(),
        type: values_1.v.optional(values_1.v.union(values_1.v.literal("text"), values_1.v.literal("image"), values_1.v.literal("audio"), values_1.v.literal("video"), values_1.v.literal("document"), values_1.v.literal("product"))),
        mediaUrl: values_1.v.optional(values_1.v.string()),
        metadata: values_1.v.optional(values_1.v.any()),
        createdAt: values_1.v.number(),
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
exports.listRecent = (0, server_1.query)({
    args: {
        conversationId: values_1.v.id("conversations"),
        limit: values_1.v.optional(values_1.v.number()),
    },
    handler: async (ctx, args) => {
        const limit = args.limit ?? 20;
        const list = await ctx.db
            .query("messages")
            .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
            .order("desc")
            .take(limit);
        return list.reverse();
    },
});
exports.updateMessageContent = (0, server_1.internalMutation)({
    args: {
        messageId: values_1.v.id("messages"),
        content: values_1.v.string(),
    },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.messageId, { content: args.content });
    },
});
//# sourceMappingURL=messages.js.map