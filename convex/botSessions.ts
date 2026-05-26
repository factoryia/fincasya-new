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

/**
 * ¿Este teléfono ya tuvo una sesión de bot que llegó a la fase comercial
 * (catálogo enviado / mascotas / cotización / contrato)? Indica que es un
 * CLIENTE RECURRENTE que retoma — el bot debería tratarlo así (no empezar
 * de cero) y un asesor debe atenderlo con contexto.
 *
 * Reglas:
 * - Match por phone exacto (los teléfonos en `botSessions` son E.164 ya
 *   normalizados al crear la sesión, así que comparación directa).
 * - Excluye la conversación actual (`excludingConversationId`) para que esta
 *   sesión NO se cuente a sí misma como "anterior".
 * - Solo cuenta sesiones cuya `phase` indique progreso real (no welcome).
 * - Devuelve la más reciente (por `updatedAt`) si hay match.
 *
 * Devuelve `null` si no hay historial relevante.
 */
export const findRecentCommercialByPhone = internalQuery({
  args: {
    phone: v.string(),
    excludingConversationId: v.id("conversations"),
  },
  handler: async (ctx, { phone, excludingConversationId }) => {
    const COMMERCIAL_PHASES = new Set([
      "collecting",
      "catalog_sent",
      "property_selected",
      "pet_check",
      "pet_rules_shown",
      "quote_shown",
      "contract",
      "done",
    ]);
    const rows = await ctx.db
      .query("botSessions")
      .withIndex("by_phone", (q) => q.eq("phone", phone))
      .collect();
    const candidates = rows.filter(
      (s) =>
        s.conversationId !== excludingConversationId &&
        COMMERCIAL_PHASES.has(s.phase),
    );
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    return candidates[0];
  },
});

/**
 * Marca alertas como YA disparadas en la sesión (idempotencia para
 * `flagPriorityAlert`). Si la sesión no existe todavía, se crea vacía.
 */
export const markAlertFired = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    phone: v.string(),
    alertReason: v.string(),
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
      const fired = new Set(existing.firedAlerts ?? []);
      if (fired.has(args.alertReason)) return false;
      fired.add(args.alertReason);
      await ctx.db.patch(existing._id, {
        firedAlerts: Array.from(fired),
        updatedAt: now,
      });
      return true;
    }
    await ctx.db.insert("botSessions", {
      conversationId: args.conversationId,
      phone: args.phone,
      phase: "welcome",
      entities: {},
      turnCount: 0,
      firedAlerts: [args.alertReason],
      createdAt: now,
      updatedAt: now,
    });
    return true;
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
      excludedRegions: v.optional(v.array(v.string())),
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
