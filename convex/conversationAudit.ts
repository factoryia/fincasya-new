import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";

/** Interna: emite un evento de auditoría de conversación. */
export const recordEvent = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    eventType: v.union(
      v.literal("assigned"),
      v.literal("unassigned"),
      v.literal("transferred"),
      v.literal("resolved"),
      v.literal("message_sent"),
    ),
    userId: v.string(),
    previousUserId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("conversationAuditEvents", {
      conversationId: args.conversationId,
      eventType: args.eventType,
      userId: args.userId,
      previousUserId: args.previousUserId,
      createdAt: Date.now(),
    });
  },
});

/** Pública: historial de auditoría de una conversación (enriquecido con datos de usuario). */
export const listByConversation = query({
  args: {
    conversationId: v.id("conversations"),
  },
  handler: async (ctx, args) => {
    const events = await ctx.db
      .query("conversationAuditEvents")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", args.conversationId),
      )
      .order("asc")
      .collect();

    const userIds = [
      ...new Set([
        ...events.map((e) => e.userId),
        ...events
          .filter((e) => e.previousUserId)
          .map((e) => e.previousUserId!),
      ]),
    ];

    const users = await Promise.all(
      userIds.map((id) =>
        ctx.db
          .query("user")
          .filter((q) => q.eq(q.field("_id"), id))
          .first(),
      ),
    );

    const userMap = new Map(
      users
        .filter(Boolean)
        .map((u) => [String(u!._id), { name: u!.name, email: u!.email }]),
    );

    return events.map((e) => ({
      ...e,
      userName: userMap.get(e.userId)?.name ?? e.userId,
      userEmail: userMap.get(e.userId)?.email ?? null,
      previousUserName: e.previousUserId
        ? (userMap.get(e.previousUserId)?.name ?? e.previousUserId)
        : undefined,
    }));
  },
});
