import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

/**
 * Actualizar lastMessageAt de una conversación.
 */
export const updateLastMessageAt = internalMutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.conversationId, {
      lastMessageAt: Date.now(),
    });
  },
});

/**
 * Guardar las fincas enviadas en el catálogo y los filtros de búsqueda (para "otras opciones").
 */
export const setLastCatalogSent = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    propertyIds: v.array(v.id("properties")),
    location: v.string(),
    fechaEntrada: v.number(),
    fechaSalida: v.number(),
    minCapacity: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.conversationId, {
      lastSentCatalogPropertyIds: args.propertyIds,
      lastCatalogSearch: {
        location: args.location,
        fechaEntrada: args.fechaEntrada,
        fechaSalida: args.fechaSalida,
        minCapacity: args.minCapacity,
      },
    });
  },
});

/**
 * Escalar a humano: la IA deja de responder; un agente debe atender.
 */
export const escalate = internalMutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.conversationId, { status: "human" });
  },
});

/**
 * Pasar a modo IA: la IA vuelve a responder automáticamente.
 */
export const setToAi = internalMutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.conversationId, { status: "ai" });
  },
});

/**
 * Marcar conversación como resuelta (cerrada).
 */
export const resolve = internalMutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.conversationId, { status: "resolved" });
  },
});

/**
 * Obtener conversación por ID.
 */
export const getById = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.conversationId);
  },
});

// --- API pública para dashboard / escalación ---

/** Escalar a humano (la IA deja de responder). */
export const escalateToHuman = mutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.conversationId, { status: "human" });
  },
});

/** Volver a modo IA (respuesta automática). */
export const setToAiPublic = mutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.conversationId, { status: "ai" });
  },
});

/** Marcar conversación como resuelta. */
export const resolveConversation = mutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.conversationId, { status: "resolved" });
  },
});

/** Listar conversaciones (para inbox). */
export const list = query({
  args: {
    status: v.optional(
      v.union(v.literal("ai"), v.literal("human"), v.literal("resolved"))
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;
    let convs = args.status
      ? await ctx.db
          .query("conversations")
          .withIndex("by_status", (q) => q.eq("status", args.status!))
          .collect()
      : await ctx.db.query("conversations").collect();
    convs = convs.sort(
      (a, b) =>
        (b.lastMessageAt ?? b.createdAt) - (a.lastMessageAt ?? a.createdAt)
    );
    const slice = convs.slice(0, limit);
    const withContact = await Promise.all(
      slice.map(async (c) => {
        const contact = await ctx.db.get(c.contactId);
        return {
          ...c,
          contact: contact
            ? { phone: contact.phone, name: contact.name }
            : null,
        };
      })
    );
    return withContact;
  },
});
