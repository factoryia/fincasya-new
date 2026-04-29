import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, mutation, query } from "./_generated/server";
import {
  DEFAULT_OPERATIONAL_STATE,
  operationalStateValidator,
  type OperationalState,
} from "./conversationOperationalState";

function effectiveState(
  s: OperationalState | undefined,
): OperationalState {
  return s ?? DEFAULT_OPERATIONAL_STATE;
}

/**
 * Estados que en inbox se leen como "pendiente de un asesor" y chocan con status=ai.
 * Al devolver el chat a la IA, se limpian a pending_data.
 */
const HUMAN_INTERVENTION_STATES: OperationalState[] = [
  "requires_advisor",
  "validate_availability",
];

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
    sortByPrice: v.optional(v.boolean()),
    hasPets: v.optional(v.boolean()),
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
        hasPets: args.hasPets,
      },
    });
  },
});

/**
 * Escalar a humano: la IA deja de responder; un agente debe atender.
 * Por defecto marca también "Requiere asesor" salvo que se indique otro estado operativo.
 */
export const escalate = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    operationalState: v.optional(operationalStateValidator),
    /** Si viene definido, asigna; si `undefined`, limpia asignación. */
    assignedUserId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const op = args.operationalState ?? "requires_advisor";
    await ctx.db.patch(args.conversationId, {
      status: "human",
      attended: false,
      operationalState: op,
      assignedUserId: args.assignedUserId,
    });
  },
});

/**
 * Pasar a modo IA: la IA vuelve a responder automáticamente.
 */
export const setToAi = internalMutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    const prev = await ctx.db.get(args.conversationId);
    const op = effectiveState(
      prev?.operationalState as OperationalState | undefined,
    );
    const patch: { status: "ai"; operationalState?: OperationalState } = {
      status: "ai",
    };
    if (HUMAN_INTERVENTION_STATES.includes(op)) {
      patch.operationalState = DEFAULT_OPERATIONAL_STATE;
    }
    await ctx.db.patch(args.conversationId, patch);
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

/** Cambio de estado operativo sin tocar ai/human/resolved (usado por el bot). */
export const setOperationalStateInternal = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    operationalState: operationalStateValidator,
    log: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const prev = await ctx.db.get(args.conversationId);
    const fromState = prev
      ? (effectiveState(prev.operationalState as OperationalState | undefined))
      : undefined;
    await ctx.db.patch(args.conversationId, {
      operationalState: args.operationalState,
    });
    if (args.log === true) {
      await ctx.db.insert("conversationOperationalStateEvents", {
        conversationId: args.conversationId,
        fromState,
        toState: args.operationalState,
        source: "bot",
        createdAt: Date.now(),
      });
    }
  },
});

/**
 * Obtener conversación por ID.
 */
async function withAssignedUser(
  ctx: { db: { get: (id: Id<"user">) => Promise<unknown> } },
  assignedUserId: string | undefined,
) {
  if (!assignedUserId) return null;
  const u = (await ctx.db.get(assignedUserId as Id<"user">)) as {
    _id: Id<"user">;
    name: string;
    email: string;
  } | null;
  if (!u) return null;
  return { _id: String(u._id), name: u.name, email: u.email };
}

export const getById = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.conversationId);
    if (!doc) return null;
    const assignedUser = await withAssignedUser(ctx, doc.assignedUserId);
    return {
      ...doc,
      operationalState: effectiveState(doc.operationalState as OperationalState | undefined),
      assignedUser,
    };
  },
});

/** Definiciones para el panel (extensible en código; en el futuro puede leer de tabla). */
export const listOperationalStateDefinitions = query({
  args: {},
  handler: async () => {
    return [
      {
        id: "requires_advisor" as const,
        label: "Requiere asesor",
        color: "rose",
        icon: "headset",
      },
      {
        id: "validate_availability" as const,
        label: "Validar disponibilidad",
        color: "amber",
        icon: "calendar-check",
      },
      {
        id: "ready_to_book" as const,
        label: "Listo para reservar",
        color: "emerald",
        icon: "check-circle",
      },
      {
        id: "pending_payment" as const,
        label: "Pendiente pago",
        color: "violet",
        icon: "banknote",
      },
      {
        id: "pending_data" as const,
        label: "Pendiente datos",
        color: "slate",
        icon: "clipboard-list",
      },
    ];
  },
});

// --- API pública para dashboard / escalación ---

/** Escalar a humano (la IA deja de responder). */
export const escalateToHuman = mutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.conversationId, {
      status: "human",
      attended: false,
      operationalState: "requires_advisor",
    });
  },
});

/** Marcar conversación como atendida (se quita de notificaciones). */
export const markAsAttended = mutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.conversationId, { attended: true });
  },
});

/** Volver a modo IA (respuesta automática). Limpia etiquetas "Requiere asesor" / validar dispo. */
export const setToAiPublic = mutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    const prev = await ctx.db.get(args.conversationId);
    const op = effectiveState(
      prev?.operationalState as OperationalState | undefined,
    );
    const patch: { status: "ai"; operationalState?: OperationalState } = {
      status: "ai",
    };
    if (HUMAN_INTERVENTION_STATES.includes(op)) {
      patch.operationalState = DEFAULT_OPERATIONAL_STATE;
    }
    await ctx.db.patch(args.conversationId, patch);
  },
});

/** Marcar conversación como resuelta. */
export const resolveConversation = mutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.conversationId, { status: "resolved" });
  },
});

/** Clasificar prioridad: urgent | low | medium | resolved */
export const setPriority = mutation({
  args: {
    conversationId: v.id("conversations"),
    priority: v.union(
      v.literal("urgent"),
      v.literal("low"),
      v.literal("medium"),
      v.literal("resolved")
    ),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.conversationId, { priority: args.priority });
  },
});

/**
 * Actualizar estado operativo (asesor). Requiere autenticación vía API (Nest).
 * `userId` es opcional: trazabilidad en `conversationOperationalStateEvents`.
 */
/**
 * Asignar o quitar asesor (documento `user` en Convex). `null` en API Nest → limpiar.
 */
export const setAssignedUser = mutation({
  args: {
    conversationId: v.id("conversations"),
    assignedUserId: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.conversationId, {
      assignedUserId:
        args.assignedUserId === null ? undefined : args.assignedUserId,
    });
  },
});

export const setOperationalState = mutation({
  args: {
    conversationId: v.id("conversations"),
    operationalState: operationalStateValidator,
    userId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const prev = await ctx.db.get(args.conversationId);
    const fromState = prev
      ? (effectiveState(prev.operationalState as OperationalState | undefined))
      : undefined;
    await ctx.db.patch(args.conversationId, {
      operationalState: args.operationalState,
    });
    await ctx.db.insert("conversationOperationalStateEvents", {
      conversationId: args.conversationId,
      fromState,
      toState: args.operationalState,
      source: "user",
      userId: args.userId,
      createdAt: Date.now(),
    });
  },
});

/** Migración: documentos sin campo → pending_data */
export const backfillOperationalStateDefault = internalMutation({
  args: {},
  handler: async (ctx) => {
    const convs = await ctx.db.query("conversations").collect();
    let n = 0;
    for (const c of convs) {
      if (c.operationalState === undefined) {
        await ctx.db.patch(c._id, {
          operationalState: DEFAULT_OPERATIONAL_STATE,
        });
        n++;
      }
    }
    return { patched: n };
  },
});

/** Listar conversaciones (para inbox). */
export const list = query({
  args: {
    status: v.optional(
      v.union(v.literal("ai"), v.literal("human"), v.literal("resolved"))
    ),
    attended: v.optional(v.boolean()),
    priority: v.optional(
      v.union(
        v.literal("urgent"),
        v.literal("low"),
        v.literal("medium"),
        v.literal("resolved")
      )
    ),
    /** Filtra por uno o varios estados operativos */
    operationalStates: v.optional(v.array(operationalStateValidator)),
    /** Filtra por uno o varios asesores (Convex user _id). */
    assignedUserIds: v.optional(v.array(v.string())),
    /** Solo conversaciones sin asesor asignado. */
    unassignedOnly: v.optional(v.boolean()),
    /** Último mensaje (o createdAt si no hay): timestamp >= */
    lastMessageFrom: v.optional(v.number()),
    /** Último mensaje (o createdAt si no hay): timestamp <= */
    lastMessageTo: v.optional(v.number()),
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

    if (args.attended !== undefined) {
      convs = convs.filter((c) => (c.attended ?? false) === args.attended);
    }

    if (args.priority) {
      convs = convs.filter((c) => c.priority === args.priority);
    }

    if (args.operationalStates && args.operationalStates.length > 0) {
      const set = new Set(args.operationalStates);
      convs = convs.filter((c) =>
        set.has(effectiveState(c.operationalState as OperationalState | undefined))
      );
    }

    if (args.unassignedOnly) {
      convs = convs.filter((c) => !c.assignedUserId);
    }

    if (args.assignedUserIds && args.assignedUserIds.length > 0) {
      const idSet = new Set(args.assignedUserIds);
      convs = convs.filter(
        (c) => c.assignedUserId && idSet.has(c.assignedUserId),
      );
    }

    const msgTs = (c: (typeof convs)[number]) =>
      c.lastMessageAt ?? c.createdAt ?? c._creationTime;
    if (args.lastMessageFrom !== undefined) {
      convs = convs.filter((c) => msgTs(c) >= args.lastMessageFrom!);
    }
    if (args.lastMessageTo !== undefined) {
      convs = convs.filter((c) => msgTs(c) <= args.lastMessageTo!);
    }

    convs = convs.sort(
      (a, b) =>
        (b.lastMessageAt ?? b.createdAt) - (a.lastMessageAt ?? a.createdAt)
    );
    const slice = convs.slice(0, limit);
    const withContact = await Promise.all(
      slice.map(async (c) => {
        const contact = await ctx.db.get(c.contactId);
        const assignedUser = await withAssignedUser(ctx, c.assignedUserId);
        return {
          ...c,
          operationalState: effectiveState(
            c.operationalState as OperationalState | undefined
          ),
          assignedUser,
          contact: contact
            ? { phone: contact.phone, name: contact.name }
            : null,
        };
      })
    );
    return withContact;
  },
});
