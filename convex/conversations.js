"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.list = exports.setPriority = exports.resolveConversation = exports.setToAiPublic = exports.markAsAttended = exports.escalateToHuman = exports.getById = exports.resolve = exports.setToAi = exports.escalate = exports.setLastCatalogSent = exports.updateLastMessageAt = void 0;
const values_1 = require("convex/values");
const server_1 = require("./_generated/server");
exports.updateLastMessageAt = (0, server_1.internalMutation)({
    args: { conversationId: values_1.v.id("conversations") },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.conversationId, {
            lastMessageAt: Date.now(),
        });
    },
});
exports.setLastCatalogSent = (0, server_1.internalMutation)({
    args: {
        conversationId: values_1.v.id("conversations"),
        propertyIds: values_1.v.array(values_1.v.id("properties")),
        location: values_1.v.string(),
        fechaEntrada: values_1.v.number(),
        fechaSalida: values_1.v.number(),
        minCapacity: values_1.v.optional(values_1.v.number()),
        sortByPrice: values_1.v.optional(values_1.v.boolean()),
    },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.conversationId, {
            lastSentCatalogPropertyIds: args.propertyIds,
            lastCatalogSearch: {
                location: args.location,
                fechaEntrada: args.fechaEntrada,
                fechaSalida: args.fechaSalida,
                minCapacity: args.minCapacity,
                sortByPrice: args.sortByPrice,
            },
        });
    },
});
exports.escalate = (0, server_1.internalMutation)({
    args: { conversationId: values_1.v.id("conversations") },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.conversationId, { status: "human", attended: false });
    },
});
exports.setToAi = (0, server_1.internalMutation)({
    args: { conversationId: values_1.v.id("conversations") },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.conversationId, { status: "ai" });
    },
});
exports.resolve = (0, server_1.internalMutation)({
    args: { conversationId: values_1.v.id("conversations") },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.conversationId, { status: "resolved" });
    },
});
exports.getById = (0, server_1.query)({
    args: { conversationId: values_1.v.id("conversations") },
    handler: async (ctx, args) => {
        return await ctx.db.get(args.conversationId);
    },
});
exports.escalateToHuman = (0, server_1.mutation)({
    args: { conversationId: values_1.v.id("conversations") },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.conversationId, { status: "human", attended: false });
    },
});
exports.markAsAttended = (0, server_1.mutation)({
    args: { conversationId: values_1.v.id("conversations") },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.conversationId, { attended: true });
    },
});
exports.setToAiPublic = (0, server_1.mutation)({
    args: { conversationId: values_1.v.id("conversations") },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.conversationId, { status: "ai" });
    },
});
exports.resolveConversation = (0, server_1.mutation)({
    args: { conversationId: values_1.v.id("conversations") },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.conversationId, { status: "resolved" });
    },
});
exports.setPriority = (0, server_1.mutation)({
    args: {
        conversationId: values_1.v.id("conversations"),
        priority: values_1.v.union(values_1.v.literal("urgent"), values_1.v.literal("low"), values_1.v.literal("medium"), values_1.v.literal("resolved")),
    },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.conversationId, { priority: args.priority });
    },
});
exports.list = (0, server_1.query)({
    args: {
        status: values_1.v.optional(values_1.v.union(values_1.v.literal("ai"), values_1.v.literal("human"), values_1.v.literal("resolved"))),
        attended: values_1.v.optional(values_1.v.boolean()),
        priority: values_1.v.optional(values_1.v.union(values_1.v.literal("urgent"), values_1.v.literal("low"), values_1.v.literal("medium"), values_1.v.literal("resolved"))),
        limit: values_1.v.optional(values_1.v.number()),
    },
    handler: async (ctx, args) => {
        const limit = args.limit ?? 50;
        let convs = args.status
            ? await ctx.db
                .query("conversations")
                .withIndex("by_status", (q) => q.eq("status", args.status))
                .collect()
            : await ctx.db.query("conversations").collect();
        if (args.attended !== undefined) {
            convs = convs.filter((c) => (c.attended ?? false) === args.attended);
        }
        if (args.priority) {
            convs = convs.filter((c) => c.priority === args.priority);
        }
        convs = convs.sort((a, b) => (b.lastMessageAt ?? b.createdAt) - (a.lastMessageAt ?? a.createdAt));
        const slice = convs.slice(0, limit);
        const withContact = await Promise.all(slice.map(async (c) => {
            const contact = await ctx.db.get(c.contactId);
            return {
                ...c,
                contact: contact
                    ? { phone: contact.phone, name: contact.name }
                    : null,
            };
        }));
        return withContact;
    },
});
//# sourceMappingURL=conversations.js.map