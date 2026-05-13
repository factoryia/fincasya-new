/**
 * Bot v2 — Mutations e queries para botSessions.
 *
 * Usadas por ycloud.ts para leer/escribir el estado del FSM.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

// ─────────────────────────────────────────────────────────────────────────────
// Query: leer sesión por conversación
// ─────────────────────────────────────────────────────────────────────────────

export const getByConversation = internalQuery({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    return ctx.db
      .query("botSessions")
      .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
      .first();
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Mutation: upsert (crear o actualizar)
// ─────────────────────────────────────────────────────────────────────────────

export const upsert = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    phone: v.string(),
    phase: v.string(),
    entities: v.object({
      location: v.optional(v.string()),
      checkIn: v.optional(v.string()),
      checkOut: v.optional(v.string()),
      cupo: v.optional(v.number()),
      isEvento: v.optional(v.boolean()),
      planType: v.optional(v.string()),
      selectedPropertyRetailerId: v.optional(v.string()),
      selectedPropertyName: v.optional(v.string()),
      catalogUserPickedReply: v.optional(v.boolean()),
      puenteAcknowledged: v.optional(v.boolean()),
      hasPets: v.optional(v.boolean()),
      petCount: v.optional(v.number()),
      eventPeopleCount: v.optional(v.number()),
      eventLogistics: v.optional(v.string()),
      contractName: v.optional(v.string()),
      contractCedula: v.optional(v.string()),
      contractEmail: v.optional(v.string()),
      contractPhone: v.optional(v.string()),
      contractAddress: v.optional(v.string()),
    }),
    turnCount: v.number(),
    phaseEnteredAt: v.optional(v.number()),
    samePhaseTurnCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("botSessions")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", args.conversationId),
      )
      .first();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        phase: args.phase,
        entities: args.entities,
        turnCount: args.turnCount,
        ...(args.phaseEnteredAt !== undefined ? { phaseEnteredAt: args.phaseEnteredAt } : {}),
        ...(args.samePhaseTurnCount !== undefined ? { samePhaseTurnCount: args.samePhaseTurnCount } : {}),
        updatedAt: now,
      });
      return existing._id;
    }

    return ctx.db.insert("botSessions", {
      conversationId: args.conversationId,
      phone: args.phone,
      phase: args.phase,
      entities: args.entities,
      turnCount: args.turnCount,
      phaseEnteredAt: args.phaseEnteredAt ?? now,
      samePhaseTurnCount: args.samePhaseTurnCount ?? 0,
      createdAt: now,
      updatedAt: now,
    });
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Mutation: reset (cuando el cliente dice "reiniciar" o es nueva sesión)
// ─────────────────────────────────────────────────────────────────────────────

export const reset = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    phone: v.string(),
  },
  handler: async (ctx, { conversationId, phone }) => {
    const existing = await ctx.db
      .query("botSessions")
      .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
      .first();

    const now = Date.now();
    const emptyEntities = {};

    if (existing) {
      await ctx.db.patch(existing._id, {
        phase: "welcome",
        entities: emptyEntities,
        turnCount: 0,
        phaseEnteredAt: now,
        samePhaseTurnCount: 0,
        updatedAt: now,
      });
      return existing._id;
    }

    return ctx.db.insert("botSessions", {
      conversationId,
      phone,
      phase: "welcome",
      entities: emptyEntities,
      turnCount: 0,
      phaseEnteredAt: now,
      samePhaseTurnCount: 0,
      createdAt: now,
      updatedAt: now,
    });
  },
});
