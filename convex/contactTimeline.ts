/**
 * Timeline unificado del cliente (CRM-1).
 *
 * Query de agregación en LECTURA — NO crea tabla de eventos.
 * Lee de: conversations, messages (hitos), conversationOperationalStateEvents,
 * saleLinks, bookings, contracts, contactNotes.
 *
 * No toca contacts.ts, bookings.ts, fincas.ts ni saleLinks.ts.
 */
import { v } from "convex/values";
import { query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

export type TimelineEvent = {
  id: string;
  type:
    | "conversation_started"
    | "conversation_resolved"
    | "state_change"
    | "sale_link_created"
    | "sale_link_step"
    | "booking_created"
    | "booking_paid"
    | "booking_confirmed"
    | "booking_cancelled"
    | "booking_checkin"
    | "booking_checkout"
    | "contract_created"
    | "contract_paid"
    | "note";
  timestamp: number;
  title: string;
  description?: string;
  metadata?: Record<string, unknown>;
};

/** Ficha 360: datos del contacto + métricas comerciales. */
export const getContactProfile = query({
  args: { contactId: v.id("contacts") },
  handler: async (ctx, args) => {
    const contact = await ctx.db.get(args.contactId);
    if (!contact) return null;

    const conversations = await ctx.db
      .query("conversations")
      .withIndex("by_contact", (q) => q.eq("contactId", args.contactId))
      .collect();

    const tagSet = new Set<string>();
    for (const conv of conversations) {
      for (const t of conv.tags ?? []) {
        const s = String(t).trim();
        if (s) tagSet.add(s);
      }
    }

    const bookings = await ctx.db
      .query("bookings")
      .withIndex("by_user", (q) => q.eq("userId", args.contactId))
      .collect();

    const propertyIds = [...new Set(bookings.map((b) => b.propertyId))];
    const properties = await Promise.all(
      propertyIds.map((id) => ctx.db.get(id)),
    );
    const propertyMap = new Map(
      properties
        .filter(Boolean)
        .map((p) => [p!._id, { title: p!.title, location: p!.location }]),
    );

    const now = Date.now();
    const pastBookings = bookings
      .filter((b) => b.fechaSalida < now && b.status !== "CANCELLED")
      .sort((a, b) => b.fechaEntrada - a.fechaEntrada);

    const futureBookings = bookings
      .filter((b) => b.fechaEntrada >= now && b.status !== "CANCELLED")
      .sort((a, b) => a.fechaEntrada - b.fechaEntrada);

    const ltv = bookings
      .filter((b) => b.status !== "CANCELLED")
      .reduce((sum, b) => sum + (b.precioTotal ?? 0), 0);

    const visitedProperties = pastBookings
      .map((b) => {
        const prop = propertyMap.get(b.propertyId);
        return prop ? { id: b.propertyId, ...prop } : null;
      })
      .filter(Boolean);
    const uniqueVisited = [
      ...new Map(visitedProperties.map((p) => [p!.id, p])).values(),
    ];

    return {
      ...contact,
      tags: Array.from(tagSet),
      totalBookings: bookings.filter((b) => b.status !== "CANCELLED").length,
      ltv,
      pastBookings: pastBookings.slice(0, 10).map((b) => ({
        _id: b._id,
        propertyTitle: propertyMap.get(b.propertyId)?.title ?? "Finca",
        propertyLocation: propertyMap.get(b.propertyId)?.location,
        fechaEntrada: b.fechaEntrada,
        fechaSalida: b.fechaSalida,
        precioTotal: b.precioTotal,
        status: b.status,
        reference: b.reference,
        numeroPersonas: b.numeroPersonas,
      })),
      futureBookings: futureBookings.map((b) => ({
        _id: b._id,
        propertyTitle: propertyMap.get(b.propertyId)?.title ?? "Finca",
        propertyLocation: propertyMap.get(b.propertyId)?.location,
        fechaEntrada: b.fechaEntrada,
        fechaSalida: b.fechaSalida,
        precioTotal: b.precioTotal,
        status: b.status,
        reference: b.reference,
        numeroPersonas: b.numeroPersonas,
      })),
      visitedProperties: uniqueVisited.map((p) => ({
        id: p!.id,
        title: p!.title,
        location: p!.location,
      })),
      conversationCount: conversations.length,
    };
  },
});

/** Timeline unificado: agrega eventos desde tablas existentes. */
export const getTimeline = query({
  args: {
    contactId: v.id("contacts"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const contact = await ctx.db.get(args.contactId);
    if (!contact) return [];

    const events: TimelineEvent[] = [];

    // 1. Conversaciones: inicio y resolución
    const conversations = await ctx.db
      .query("conversations")
      .withIndex("by_contact", (q) => q.eq("contactId", args.contactId))
      .collect();

    const convMap = new Map<Id<"conversations">, Doc<"conversations">>();
    for (const conv of conversations) {
      convMap.set(conv._id, conv);
      events.push({
        id: `conv-start-${conv._id}`,
        type: "conversation_started",
        timestamp: conv.createdAt,
        title: `Conversación iniciada (${conv.channel === "web" ? "chat web" : "WhatsApp"})`,
        metadata: { conversationId: conv._id, channel: conv.channel },
      });
      if (conv.status === "resolved" && conv.lastMessageAt) {
        events.push({
          id: `conv-resolved-${conv._id}`,
          type: "conversation_resolved",
          timestamp: conv.lastMessageAt,
          title: "Conversación resuelta",
          metadata: { conversationId: conv._id },
        });
      }
    }

    // 2. Cambios de estado operativo (conversationOperationalStateEvents)
    for (const conv of conversations) {
      const stateEvents = await ctx.db
        .query("conversationOperationalStateEvents")
        .withIndex("by_conversation", (q) =>
          q.eq("conversationId", conv._id),
        )
        .collect();

      for (const se of stateEvents) {
        events.push({
          id: `state-${se._id}`,
          type: "state_change",
          timestamp: se.createdAt,
          title: `Estado: ${stateLabel(se.fromState)} → ${stateLabel(se.toState)}`,
          description: se.source === "bot" ? "Cambio automático (bot)" : "Cambio manual (asesor)",
          metadata: { from: se.fromState, to: se.toState, source: se.source },
        });
      }
    }

    // 3. Sale links (links de venta)
    const saleLinks = await findSaleLinksByContact(ctx, contact, conversations);
    for (const sl of saleLinks) {
      const prop = sl.propertyId ? await ctx.db.get(sl.propertyId) : null;
      events.push({
        id: `sl-created-${sl._id}`,
        type: "sale_link_created",
        timestamp: sl.createdAt,
        title: `Link de venta creado`,
        description: prop ? `${prop.title} · ${sl.guests} personas · $${formatNum(sl.totalValue)}` : undefined,
        metadata: { saleLinkId: sl._id, clientStep: sl.clientStep },
      });

      if (sl.clientData?.filledAt) {
        events.push({
          id: `sl-data-${sl._id}`,
          type: "sale_link_step",
          timestamp: sl.clientData.filledAt,
          title: "Cliente llenó datos personales",
          metadata: { saleLinkId: sl._id },
        });
      }
      if (sl.paymentProofSubmittedAt) {
        events.push({
          id: `sl-proof-${sl._id}`,
          type: "sale_link_step",
          timestamp: sl.paymentProofSubmittedAt,
          title: "Cliente subió comprobante de pago",
          metadata: { saleLinkId: sl._id },
        });
      }
      if (sl.paymentValidatedAt) {
        events.push({
          id: `sl-validated-${sl._id}`,
          type: "sale_link_step",
          timestamp: sl.paymentValidatedAt,
          title: "Pago validado por admin",
          metadata: { saleLinkId: sl._id },
        });
      }
      if (sl.contractGeneratedAt) {
        events.push({
          id: `sl-contract-${sl._id}`,
          type: "sale_link_step",
          timestamp: sl.contractGeneratedAt,
          title: "Contrato generado",
          metadata: { saleLinkId: sl._id },
        });
      }
      if (sl.crGeneratedAt) {
        events.push({
          id: `sl-cr-${sl._id}`,
          type: "sale_link_step",
          timestamp: sl.crGeneratedAt,
          title: "Confirmación de reserva (CR) generada",
          metadata: { saleLinkId: sl._id },
        });
      }
    }

    // 4. Bookings
    const bookings = await ctx.db
      .query("bookings")
      .withIndex("by_user", (q) => q.eq("userId", args.contactId))
      .collect();

    for (const b of bookings) {
      const prop = await ctx.db.get(b.propertyId);
      const propTitle = prop?.title ?? "Finca";
      const ref = b.reference ? ` (${b.reference})` : "";

      events.push({
        id: `bk-created-${b._id}`,
        type: "booking_created",
        timestamp: b.createdAt,
        title: `Reserva creada${ref}`,
        description: `${propTitle} · ${b.numeroPersonas} personas`,
        metadata: { bookingId: b._id, status: b.status },
      });

      if (b.status === "PAID" || b.paymentStatus === "PAID") {
        events.push({
          id: `bk-paid-${b._id}`,
          type: "booking_paid",
          timestamp: b.updatedAt ?? b.createdAt,
          title: `Pago validado${ref}`,
          description: `$${formatNum(b.precioTotal)}`,
          metadata: { bookingId: b._id },
        });
      }
      if (b.status === "CONFIRMED") {
        events.push({
          id: `bk-confirmed-${b._id}`,
          type: "booking_confirmed",
          timestamp: b.updatedAt ?? b.createdAt,
          title: `Reserva confirmada${ref}`,
          metadata: { bookingId: b._id },
        });
      }
      if (b.status === "CANCELLED") {
        events.push({
          id: `bk-cancelled-${b._id}`,
          type: "booking_cancelled",
          timestamp: b.updatedAt ?? b.createdAt,
          title: `Reserva cancelada${ref}`,
          metadata: { bookingId: b._id },
        });
      }

      const checkinSent = (b.scheduledMessages ?? []).find(
        (m) => m.key === "tourist_checkin_start",
      );
      if (checkinSent) {
        events.push({
          id: `bk-checkin-${b._id}`,
          type: "booking_checkin",
          timestamp: checkinSent.sentAt,
          title: `Check-in enviado${ref}`,
          metadata: { bookingId: b._id },
        });
      }

      const checkoutSent = (b.scheduledMessages ?? []).find(
        (m) => m.key === "tourist_departure",
      );
      if (checkoutSent) {
        events.push({
          id: `bk-checkout-${b._id}`,
          type: "booking_checkout",
          timestamp: checkoutSent.sentAt,
          title: `Salida / checkout${ref}`,
          metadata: { bookingId: b._id },
        });
      }
    }

    // 5. Contracts (match by phone or cedula)
    const contracts = await findContractsByContact(ctx, contact);
    for (const c of contracts) {
      events.push({
        id: `ct-created-${c._id}`,
        type: "contract_created",
        timestamp: c.createdAt,
        title: `Contrato ${c.contractNumber}`,
        description: c.propertyTitle
          ? `${c.propertyTitle} · ${c.estado}`
          : c.estado,
        metadata: { contractId: c._id, estado: c.estado },
      });
      if (c.estado === "pagado" && c.updatedAt !== c.createdAt) {
        events.push({
          id: `ct-paid-${c._id}`,
          type: "contract_paid",
          timestamp: c.updatedAt,
          title: `Contrato ${c.contractNumber} pagado`,
          metadata: { contractId: c._id },
        });
      }
    }

    // 6. Notas del asesor
    const notes = await ctx.db
      .query("contactNotes")
      .withIndex("by_contact", (q) => q.eq("contactId", args.contactId))
      .collect();

    for (const n of notes) {
      events.push({
        id: `note-${n._id}`,
        type: "note",
        timestamp: n.createdAt,
        title: "Nota del asesor",
        description: n.content,
        metadata: {
          noteId: n._id,
          authorName: n.authorName,
          authorUserId: n.authorUserId,
        },
      });
    }

    // Ordenar cronológicamente descendente y limitar
    events.sort((a, b) => b.timestamp - a.timestamp);
    return events.slice(0, args.limit ?? 100);
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers (funciones puras, exportadas para testing futuro)
// ─────────────────────────────────────────────────────────────────────────────

const STATE_LABELS: Record<string, string> = {
  pending_data: "Datos pendientes",
  validate_availability: "Validar disponibilidad",
  ready_to_book: "Listo para reservar",
  pending_payment: "Pago pendiente",
  requires_advisor: "Requiere asesor",
};

export function stateLabel(state: string | undefined | null): string {
  if (!state) return "—";
  return STATE_LABELS[state] ?? state;
}

export function formatNum(n: number): string {
  return new Intl.NumberFormat("es-CO", {
    maximumFractionDigits: 0,
  }).format(n);
}

async function findSaleLinksByContact(
  ctx: { db: any },
  contact: Doc<"contacts">,
  conversations: Doc<"conversations">[],
): Promise<Doc<"saleLinks">[]> {
  // saleLinks don't have contactId; match via bookingId→booking.userId or clientData.telefono
  const phone = contact.phone?.replace(/[^\d]/g, "") ?? "";
  const allLinks = await ctx.db.query("saleLinks").collect();

  return allLinks.filter((sl: Doc<"saleLinks">) => {
    const slPhone = sl.clientData?.telefono?.replace(/[^\d]/g, "") ?? "";
    if (phone && slPhone && (slPhone.endsWith(phone) || phone.endsWith(slPhone))) {
      return true;
    }
    return false;
  });
}

async function findContractsByContact(
  ctx: { db: any },
  contact: Doc<"contacts">,
): Promise<Doc<"contracts">[]> {
  const phone = contact.phone?.replace(/[^\d]/g, "") ?? "";
  const cedula = contact.cedula ?? "";
  const allContracts = await ctx.db.query("contracts").collect();

  return allContracts.filter((c: Doc<"contracts">) => {
    if (cedula && c.clienteCedula === cedula) return true;
    const cPhone = c.clienteTelefono?.replace(/[^\d]/g, "") ?? "";
    if (phone && cPhone && (cPhone.endsWith(phone) || phone.endsWith(cPhone))) {
      return true;
    }
    return false;
  });
}
