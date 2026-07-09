import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { action, internalMutation, mutation, query } from "./_generated/server";
import { internal, api } from "./_generated/api";
import {
  DEFAULT_OPERATIONAL_STATE,
  operationalStateValidator,
  type OperationalState,
} from "./conversationOperationalState";
import {
  contactMatchesInboxSearch,
  resolveConversationChannel,
} from "./lib/inboxContactDisplay";
import {
  effectiveInboxUnreadCount,
  getConversationLastMessageMeta,
} from "./lib/inboxMessagePreview";
import { jsonSafeString } from "./lib/jsonSafeString";

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
    /** Marca la conversación como urgente en el inbox (ej. contrato completado por el cliente). */
    priority: v.optional(
      v.union(
        v.literal("urgent"),
        v.literal("low"),
        v.literal("medium"),
        v.literal("resolved"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const op = args.operationalState ?? "requires_advisor";
    await ctx.db.patch(args.conversationId, {
      status: "human",
      attended: false,
      operationalState: op,
      assignedUserId: args.assignedUserId,
      ...(args.priority != null ? { priority: args.priority } : {}),
    });
  },
});

/**
 * Añade UN tag a la conversación de forma idempotente (no duplica). Helper
 * para que `inbound.ts` pueda etiquetar conversaciones desde escalaciones
 * duras (emergencia, propietario) sin reimplementar la lógica de merge.
 */
export const addConversationTag = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    tag: v.string(),
  },
  handler: async (ctx, args) => {
    const conv = await ctx.db.get(args.conversationId);
    if (!conv) return;
    const existing = Array.isArray(conv.tags) ? conv.tags : [];
    const clean = args.tag.trim();
    if (!clean || existing.includes(clean)) return;
    await ctx.db.patch(args.conversationId, {
      tags: [...existing, clean].slice(0, 25),
    });
  },
});

/**
 * ALERTA BLANDA — añade tag + priority + system message a la conversación
 * SIN apagar el bot (≠ `escalate`, que sí setea `status='human'`).
 *
 * Patrón usado por las detecciones de oportunidad/caso especial donde la IA
 * PUEDE seguir conversando pero un asesor DEBE entrar pronto:
 *   - Estadías largas (3+ noches) → oportunidad comercial prioritaria.
 *   - Intención de cierre / pago → preparar humano para cerrar.
 *   - Cliente recurrente que vuelve → asesor con contexto previo.
 *
 * Idempotente vía `botSessions.firedAlerts` (mismo `alertReason` no se vuelve
 * a disparar en la misma sesión).
 */
export const flagPriorityAlert = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    /** Identificador estable del tipo de alerta (idempotencia + telemetría). */
    alertReason: v.string(),
    /** Prioridad para el inbox. */
    priority: v.union(
      v.literal("urgent"),
      v.literal("medium"),
      v.literal("low"),
    ),
    /** Etiqueta visible para el asesor (se añade al array `tags`). */
    tag: v.string(),
    /** Opcional — cambia el estado operativo del embudo. */
    operationalState: v.optional(operationalStateValidator),
    /** Texto del mensaje de sistema que ve el asesor en el inbox. */
    inboxMessage: v.string(),
  },
  handler: async (ctx, args) => {
    // 1) Idempotencia: ya disparada en esta sesión → no-op.
    const session = await ctx.db
      .query("botSessions")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", args.conversationId),
      )
      .first();
    const fired = session?.firedAlerts ?? [];
    if (fired.includes(args.alertReason)) return { fired: false };

    // 2) Patch conversación: tag + priority (+ operationalState si aplica).
    const conv = await ctx.db.get(args.conversationId);
    if (!conv) return { fired: false };
    const existingTags = Array.isArray(conv.tags) ? conv.tags : [];
    const cleanTag = args.tag.trim();
    const tags =
      cleanTag.length > 0 && !existingTags.includes(cleanTag)
        ? [...existingTags, cleanTag].slice(0, 25)
        : existingTags;

    // Solo subimos prioridad si la actual es más baja (no rebajamos urgent → medium).
    const PRIORITY_RANK: Record<string, number> = {
      low: 1,
      medium: 2,
      urgent: 3,
      resolved: 0,
    };
    const currentRank = PRIORITY_RANK[conv.priority ?? "low"] ?? 1;
    const newRank = PRIORITY_RANK[args.priority] ?? 1;
    const finalPriority =
      newRank > currentRank ? args.priority : conv.priority;

    await ctx.db.patch(args.conversationId, {
      tags,
      ...(finalPriority ? { priority: finalPriority } : {}),
      ...(args.operationalState
        ? { operationalState: args.operationalState }
        : {}),
    });

    // 3) System message visible solo en inbox (no se envía a WhatsApp).
    const now = Date.now();
    await ctx.db.insert("messages", {
      conversationId: args.conversationId,
      sender: "system",
      content: args.inboxMessage,
      type: "text",
      createdAt: now,
      metadata: {
        kind: "inbox_priority_alert",
        alertReason: args.alertReason,
        priority: args.priority,
        tag: cleanTag,
      },
    });
    await ctx.db.patch(args.conversationId, { lastMessageAt: now });

    // 4) Marcar disparada (sesión existe ya casi siempre; si no, la creamos
    //    vacía con firedAlerts para que la próxima vez sea no-op).
    if (session) {
      await ctx.db.patch(session._id, {
        firedAlerts: [...fired, args.alertReason],
        updatedAt: now,
      });
    } else {
      // Caso poco común: alerta antes de que el bot cree la sesión.
      const contactPhone =
        typeof (conv as { phone?: string }).phone === "string"
          ? ((conv as { phone?: string }).phone as string)
          : "";
      await ctx.db.insert("botSessions", {
        conversationId: args.conversationId,
        phone: contactPhone,
        phase: "welcome",
        entities: {},
        turnCount: 0,
        firedAlerts: [args.alertReason],
        createdAt: now,
        updatedAt: now,
      });
    }

    return { fired: true };
  },
});

/**
 * Pasar a modo IA: la IA vuelve a responder automáticamente.
 */
async function markBotResumeFromHumanIfNeeded(
  ctx: { db: any; runMutation: any },
  conversationId: Id<"conversations">,
  prevStatus?: string,
) {
  if (prevStatus !== "human") return;
  const conv = await ctx.db.get(conversationId);
  if (!conv) return;
  const contact = await ctx.db.get(conv.contactId);
  const phone = String(contact?.phone ?? "").trim();
  if (!phone) return;
  await ctx.runMutation(internal.botSessions.setPendingResumeFromHuman, {
    conversationId,
    phone,
  });
}

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
    await markBotResumeFromHumanIfNeeded(ctx, args.conversationId, prev?.status);
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
      unreadCount: doc.inboxUnreadCount ?? 0,
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

    // Push al staff
    try {
      const conv = await ctx.db.get(args.conversationId);
      const contact = conv ? await ctx.db.get(conv.contactId) : null;
      const name =
        (contact as { name?: string } | null)?.name ??
        (contact as { phone?: string } | null)?.phone ??
        "Cliente";
      const actor = (await ctx.auth.getUserIdentity())?.subject;
      await ctx.scheduler.runAfter(0, internal.push.notifyInboxStaff, {
        title: "Requiere asesor humano",
        body: `${name} necesita atención`,
        data: { type: "escalated", conversationId: args.conversationId },
        excludeUserId: actor,
      });
    } catch (e) {
      console.warn("[push] escalate notify failed", e);
    }
  },
});

/** Marcar conversación como atendida (se quita de notificaciones). */
export const markAsAttended = mutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.conversationId, { attended: true });
  },
});

/**
 * Quita todas las notificaciones del inbox: escalaciones pendientes y contadores
 * de no leídos. Usado desde la campana «Cuentas por Atender».
 */
export const dismissAllInboxNotifications = mutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const convs = await ctx.db.query("conversations").collect();
    let dismissedEscalations = 0;
    let markedRead = 0;

    for (const c of convs) {
      const patch: {
        attended?: boolean;
        inboxUnreadCount?: number;
        inboxLastReadAt?: number;
      } = {};

      if (c.status === "human" && c.attended !== true) {
        patch.attended = true;
        dismissedEscalations++;
      }
      if ((c.inboxUnreadCount ?? 0) > 0) {
        patch.inboxUnreadCount = 0;
        patch.inboxLastReadAt = now;
        markedRead++;
      }

      if (Object.keys(patch).length > 0) {
        await ctx.db.patch(c._id, patch);
      }
    }

    return { dismissedEscalations, markedRead };
  },
});

/** Marca la conversación como leída en el inbox (reinicia contador de no leídos). */
export const markInboxRead = mutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.conversationId, {
      inboxUnreadCount: 0,
      inboxLastReadAt: Date.now(),
    });
  },
});

function messageCursorMs(msg: {
  createdAt?: number;
  _creationTime: number;
}): number {
  return msg.createdAt ?? msg._creationTime;
}

function isInboxContactMessage(msg: {
  sender: string | { role?: string };
  metadata?: { kind?: string } | null;
}): boolean {
  if (msg.metadata?.kind === "inbox_escalation_alert") return false;
  const sender =
    typeof msg.sender === "string" ? msg.sender : msg.sender?.role;
  return sender === "user";
}

/** Marca la conversación como no leída (desde el último mensaje del cliente). */
export const markInboxUnread = mutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", args.conversationId),
      )
      .order("desc")
      .take(250);

    let lastContactAt: number | null = null;
    for (const msg of messages) {
      if (!isInboxContactMessage(msg)) continue;
      lastContactAt = messageCursorMs(msg);
      break;
    }

    if (lastContactAt === null) {
      await ctx.db.patch(args.conversationId, {
        inboxUnreadCount: 1,
        inboxLastReadAt: 0,
      });
      return { inboxUnreadCount: 1, inboxLastReadAt: 0 };
    }

    const inboxLastReadAt = lastContactAt - 1;
    let inboxUnreadCount = 0;
    for (const msg of messages) {
      if (!isInboxContactMessage(msg)) continue;
      if (messageCursorMs(msg) > inboxLastReadAt) inboxUnreadCount++;
    }
    if (inboxUnreadCount < 1) inboxUnreadCount = 1;

    await ctx.db.patch(args.conversationId, {
      inboxUnreadCount,
      inboxLastReadAt,
    });
    return { inboxUnreadCount, inboxLastReadAt };
  },
});

const MAX_CONVERSATION_TAGS = 25;
const MAX_TAG_LENGTH = 64;

function normalizeConversationTags(raw: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of raw) {
    const s = t.trim().slice(0, MAX_TAG_LENGTH);
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= MAX_CONVERSATION_TAGS) break;
  }
  return out;
}

/** Etiquetas de negocio (varias por conversación). No modifica status ai/human. */
export const setConversationTags = mutation({
  args: {
    conversationId: v.id("conversations"),
    tags: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const next = normalizeConversationTags(args.tags);
    await ctx.db.patch(args.conversationId, { tags: next });
  },
});

/** Volver a modo IA (respuesta automática). Limpia etiquetas "Requiere asesor" / validar dispo. */
export const setToAiPublic = mutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    const prev = await ctx.db.get(args.conversationId);
    if (!prev) {
      throw new Error("Conversación no encontrada");
    }
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
    await markBotResumeFromHumanIfNeeded(ctx, args.conversationId, prev?.status);
  },
});

/** Marcar conversación como resuelta. */
export const resolveConversation = mutation({
  args: {
    conversationId: v.id("conversations"),
    actorUserId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.conversationId, { status: "resolved" });
    if (args.actorUserId) {
      await ctx.runMutation(internal.conversationAudit.recordEvent, {
        conversationId: args.conversationId,
        eventType: "resolved",
        userId: args.actorUserId,
      });
    }
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
 * `actorUserId` es opcional: quién hace la acción (para auditoría).
 */
export const setAssignedUser = mutation({
  args: {
    conversationId: v.id("conversations"),
    assignedUserId: v.union(v.string(), v.null()),
    actorUserId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const prev = await ctx.db.get(args.conversationId);
    await ctx.db.patch(args.conversationId, {
      assignedUserId:
        args.assignedUserId === null ? undefined : args.assignedUserId,
    });

    if (args.assignedUserId === null) {
      // Unassigned
      await ctx.runMutation(internal.conversationAudit.recordEvent, {
        conversationId: args.conversationId,
        eventType: "unassigned",
        userId: args.actorUserId ?? "system",
      });
    } else {
      const prevAssigned = prev?.assignedUserId;
      if (prevAssigned && prevAssigned !== args.assignedUserId) {
        // Transferred from one advisor to another
        await ctx.runMutation(internal.conversationAudit.recordEvent, {
          conversationId: args.conversationId,
          eventType: "transferred",
          userId: args.assignedUserId,
          previousUserId: prevAssigned,
        });
      } else {
        // New assignment
        await ctx.runMutation(internal.conversationAudit.recordEvent, {
          conversationId: args.conversationId,
          eventType: "assigned",
          userId: args.assignedUserId,
        });
      }
    }
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
    /** Solo conversaciones con mensajes del cliente sin leer en el panel. */
    unreadOnly: v.optional(v.boolean()),
    /** La conversación debe tener al menos una de estas etiquetas (OR). */
    tagsAny: v.optional(v.array(v.string())),
    /** Último mensaje (o createdAt si no hay): timestamp >= */
    lastMessageFrom: v.optional(v.number()),
    /** Último mensaje (o createdAt si no hay): timestamp <= */
    lastMessageTo: v.optional(v.number()),
    /** Canal: whatsapp | web */
    channel: v.optional(v.union(v.literal("whatsapp"), v.literal("web"))),
    /** Nombre o teléfono del contacto (substring, case-insensitive). */
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
    /** Offset numérico (string) para paginación del inbox. */
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 1000);
    const offset = args.cursor
      ? Math.max(0, parseInt(args.cursor, 10) || 0)
      : 0;
    let convs = args.status
      ? await ctx.db
          .query("conversations")
          .withIndex("by_status", (q) => q.eq("status", args.status!))
          .collect()
      : await ctx.db.query("conversations").collect();

    const searchQ = args.search?.trim() ?? "";
    const needsContactLookup = Boolean(args.channel) || searchQ.length > 0;
    const contactById = new Map<
      string,
      { name?: string; phone?: string } | null
    >();

    if (needsContactLookup) {
      const getContact = async (contactId: typeof convs[number]["contactId"]) => {
        const key = String(contactId);
        if (!contactById.has(key)) {
          contactById.set(key, await ctx.db.get(contactId));
        }
        return contactById.get(key) ?? null;
      };

      if (args.channel) {
        const matched: typeof convs = [];
        for (const c of convs) {
          const contact = await getContact(c.contactId);
          if (
            resolveConversationChannel(c, contact) === args.channel
          ) {
            matched.push(c);
          }
        }
        convs = matched;
      }

      if (searchQ.length > 0) {
        const matched: typeof convs = [];
        for (const c of convs) {
          const contact = await getContact(c.contactId);
          if (contactMatchesInboxSearch(contact, c.channel, searchQ)) {
            matched.push(c);
          }
        }
        convs = matched;
      }
    }

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

    if (args.unreadOnly) {
      convs = convs.filter((c) => (c.inboxUnreadCount ?? 0) > 0);
    }

    if (args.tagsAny && args.tagsAny.length > 0) {
      const tagSet = new Set(args.tagsAny.map((t) => t.trim()).filter(Boolean));
      convs = convs.filter((c) => {
        const tags = c.tags ?? [];
        return tags.some((t) => tagSet.has(t));
      });
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
    const slice = convs.slice(offset, offset + limit);
    const hasMore = offset + slice.length < convs.length;
    const withContact = await Promise.all(
      slice.map(async (c) => {
        const { inboxUnreadCount: _u, ...rest } = c;
        const [contact, assignedUser, lastMessage] = await Promise.all([
          ctx.db.get(c.contactId),
          withAssignedUser(ctx, c.assignedUserId),
          getConversationLastMessageMeta(ctx, c._id),
        ]);
        return {
          ...rest,
          ...(rest.tags
            ? { tags: rest.tags.map((t) => jsonSafeString(t)) }
            : {}),
          ...(rest.lastCatalogSearch
            ? {
                lastCatalogSearch: {
                  ...rest.lastCatalogSearch,
                  location: jsonSafeString(rest.lastCatalogSearch.location),
                },
              }
            : {}),
          lastMessagePreview: lastMessage.preview,
          unreadCount: effectiveInboxUnreadCount(_u, lastMessage.sender),
          operationalState: effectiveState(
            c.operationalState as OperationalState | undefined
          ),
          assignedUser: assignedUser
            ? {
                ...assignedUser,
                name: jsonSafeString(assignedUser.name),
                email: jsonSafeString(assignedUser.email),
              }
            : null,
          contact: {
            phone: jsonSafeString(contact?.phone ?? ""),
            name: jsonSafeString(contact?.name ?? ""),
          },
        };
      })
    );
    return {
      items: withContact,
      nextCursor: hasMore ? String(offset + limit) : null,
      hasMore,
    };
  },
});

/**
 * Reprocesa el último mensaje del cliente con el bot (sin esperar uno nuevo).
 * Pone la conversación en modo IA y ejecuta el mismo pipeline que un inbound.
 */
export const retryBot = action({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    const conv = await ctx.runQuery(api.conversations.getById, {
      conversationId: args.conversationId,
    });
    if (!conv) {
      return { ok: false as const, reason: "not_found" as const };
    }
    if (conv.status === "resolved") {
      return { ok: false as const, reason: "resolved" as const };
    }

    const contact = await ctx.runQuery(api.contacts.getById, {
      contactId: conv.contactId,
    });
    if (!contact?.phone) {
      return { ok: false as const, reason: "no_contact" as const };
    }

    const channel = (conv.channel ?? "whatsapp") as "whatsapp" | "web";

    const latestMsg = (await ctx.runQuery(api.messages.getLatestUserMessage, {
      conversationId: args.conversationId,
      scanLimit: 50,
    })) as {
      _id: Id<"messages">;
      content?: string;
      type?: string;
      mediaUrl?: string;
    } | null;

    const msgType = (latestMsg?.type as string | undefined) ?? "text";
    const text = String(latestMsg?.content ?? "").trim();
    const hasMedia =
      Boolean(latestMsg?.mediaUrl) &&
      msgType !== "text" &&
      msgType !== "product";
    if (!text && !hasMedia) {
      return { ok: false as const, reason: "no_user_message" as const };
    }

    await ctx.runMutation(api.conversations.setToAiPublic, {
      conversationId: args.conversationId,
    });

    const { runBotTurn } = await import("./lib/bot/index");
    const { processInboundMessageV2 } = await import("./lib/ycloud/inbound");
    const { transcribeAudio } = await import("./lib/transcription");
    const { classifyContractImage } = await import("./lib/imageClassifier");

    await processInboundMessageV2(
      ctx,
      {
        eventId: `retry_${args.conversationId}_${Date.now()}`,
        phone: contact.phone,
        name: contact.name ?? "Cliente",
        text,
        type: (latestMsg?.type as
          | "text"
          | "image"
          | "audio"
          | "video"
          | "document"
          | undefined) ?? "text",
        mediaUrl: latestMsg?.mediaUrl,
        retryMode: true,
        existingMessageId: latestMsg!._id,
        conversationId: args.conversationId,
      },
      {
        internal,
        api,
        transcribeAudio,
        classifyImage: classifyContractImage,
        runBotTurn,
        channel,
        deliverText:
          channel === "web"
            ? async () => {}
            : async (payload) => {
                await ctx.runAction(internal.ycloud.sendWhatsAppMessage, payload);
              },
        deliverCatalog:
          channel === "web"
            ? async (payload) =>
                payload.productRetailerIds.map((productRetailerId) => ({
                  productRetailerId,
                  ok: true,
                }))
            : async (payload) =>
                (await ctx.runAction(internal.ycloud.sendWhatsAppCatalogList, {
                  to: payload.to,
                  productRetailerIds: payload.productRetailerIds,
                  productQuoteLines: payload.productQuoteLines,
                  bodyText: payload.bodyText,
                  catalogId: payload.catalogId,
                  wamid: payload.wamid,
                  conversationId: payload.conversationId,
                })) as Array<{
                  productRetailerId: string;
                  wamid?: string;
                  ok?: boolean;
                }>,
      },
    );

    return { ok: true as const };
  },
});
