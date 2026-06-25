import { v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { sendTemplateToYcloud } from "./lib/ycloud/senders";
import {
  ALL_TEMPLATE_KEYS,
  ALL_TEMPLATES,
  buildBodyParams,
  buildRegisterPayload,
  buildSendComponents,
  CHECKIN_TEMPLATES,
  getTemplateDef,
  MANUAL_TEMPLATE_KEYS,
  renderTemplateBody,
  type CheckinTemplateKey,
  type TemplateDef,
} from "./lib/ycloud/templateCatalog";
import { normalizeWhatsappPhone } from "./lib/ycloud/parseMessage";

const YCLOUD_TEMPLATES_BASE = "https://api.ycloud.com/v2/whatsapp/templates";

function checkinPortalBase(): string {
  return (
    process.env.CHECKIN_PORTAL_BASE_URL || "https://fincasya.com/checkin"
  ).replace(/\/+$/, "");
}

/** Primer nombre, para un saludo más natural en la plantilla. */
function firstName(full: string | undefined | null): string {
  const s = String(full ?? "").trim();
  if (!s) return "";
  return s.split(/\s+/)[0];
}

function formatHoraEntrada(hora?: string | null, ms?: number): string {
  const s = String(hora ?? "").trim();
  const match = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (match) {
    let h = parseInt(match[1], 10);
    const m = match[2];
    const ampm = h >= 12 ? "PM" : "AM";
    if (h === 0) h = 12;
    else if (h > 12) h -= 12;
    return `${h}:${m} ${ampm}`;
  }
  if (s) return s; // ya viene formateada (ej. "10:00 AM")
  // Sin campo horaEntrada: derivar la hora del timestamp de llegada
  // (hora Colombia), igual que la página de check-in.
  if (ms != null && Number.isFinite(ms)) {
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: "America/Bogota",
    }).format(new Date(ms));
  }
  return "10:00 AM";
}

/** Fecha de llegada legible en español (hora Colombia). Ej: "sábado 15 de junio de 2026, 3:00 PM". */
function formatFechaLlegada(ms: number): string {
  if (!Number.isFinite(ms)) return "tu fecha de llegada";
  const date = new Date(ms);
  const dia = new Intl.DateTimeFormat("es-CO", {
    weekday: "long",
    timeZone: "America/Bogota",
  }).format(date);
  const fecha = new Intl.DateTimeFormat("es-CO", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "America/Bogota",
  }).format(date);
  const diaCapitalizado = dia.charAt(0).toUpperCase() + dia.slice(1);
  // Solo la fecha: la hora de ingreso va en su propia línea/variable.
  return `${diaCapitalizado} ${fecha}`;
}

/**
 * Normaliza un teléfono a formato apto para YCloud (E.164 sin `+`, con
 * indicativo). Asume Colombia (57) para celulares locales de 10 dígitos.
 */
function normalizeOutboundPhone(raw: string | undefined | null): string {
  const cleaned = String(raw ?? "").replace(/[^\d]/g, "");
  if (!cleaned) return "";
  if (cleaned.length === 10 && cleaned.startsWith("3")) return `57${cleaned}`;
  return cleaned;
}

// ─────────────────────────────────────────────────────────────────────────────
// Catálogo (lectura para UI / NestJS)
// ─────────────────────────────────────────────────────────────────────────────

export const listCheckinTemplates = query({
  args: {},
  handler: async () =>
    ALL_TEMPLATE_KEYS.map((key) => {
      const def = CHECKIN_TEMPLATES[key];
      return {
        key: def.key,
        name: def.name,
        language: def.language,
        category: def.category,
        bodyText: def.bodyText,
        paramKeys: def.paramKeys,
        footer: def.footer ?? null,
      };
    }),
});

// ─────────────────────────────────────────────────────────────────────────────
// Envío MANUAL de plantillas desde el inbox (cualquier conversación)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lista las plantillas que un asesor puede enviar manualmente desde el chat
 * (set curado: check-in + transaccionales como `tratamiento_de_datos`). Cada
 * una expone su cuerpo, las variables `{{n}}` a rellenar y sus botones.
 */
export const listManualTemplates = query({
  args: {},
  handler: async () =>
    MANUAL_TEMPLATE_KEYS.map((key) => {
      const def = ALL_TEMPLATES[key];
      const buttons = def.buttons ?? (def.button ? [def.button] : []);
      return {
        key: def.key,
        name: def.name,
        language: def.language,
        category: def.category,
        bodyText: def.bodyText,
        paramKeys: def.paramKeys,
        exampleParams: def.exampleParams,
        footer: def.footer ?? null,
        buttons: buttons.map((b) => ({ type: b.type, text: b.text })),
      };
    }),
});

/** Destinatario (teléfono + nombre) de una conversación, para el envío manual. */
export const getConversationRecipient = internalQuery({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    const conv = await ctx.db.get(args.conversationId);
    if (!conv) return null;
    const contact = await ctx.db.get(conv.contactId);
    if (!contact) return null;
    return {
      channel: conv.channel,
      phone: contact.phone,
      name: contact.baseName?.trim() || contact.name?.trim() || "",
    };
  },
});

/**
 * Envía una plantilla preaprobada a la conversación abierta en el inbox (envío
 * manual del asesor). Resuelve el teléfono del contacto, manda la plantilla por
 * YCloud y deja registrado en el inbox el texto renderizado (con los mismos
 * `{{n}}` que verá el cliente) marcado como envío humano.
 */
export const sendTemplateToConversation = action({
  args: {
    conversationId: v.id("conversations"),
    templateKey: v.string(),
    bodyParams: v.optional(v.array(v.string())),
    sentByUserId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const def = getTemplateDef(args.templateKey);
    if (!def) throw new Error(`Plantilla desconocida: ${args.templateKey}`);

    const recipient = (await ctx.runQuery(
      internal.checkinMessaging.getConversationRecipient,
      { conversationId: args.conversationId },
    )) as { channel: string; phone: string; name: string } | null;
    if (!recipient) throw new Error("Conversación o contacto no encontrado");
    if (recipient.channel === "web") {
      throw new Error(
        "Las plantillas de WhatsApp solo se pueden enviar a conversaciones de WhatsApp.",
      );
    }

    const to = normalizeOutboundPhone(recipient.phone);
    if (!to) throw new Error("El contacto no tiene un teléfono válido.");

    const bodyParams = (args.bodyParams ?? []).map((p) => String(p ?? ""));
    const components = buildSendComponents(def, bodyParams);
    const { wamid, status } = await sendTemplateToYcloud({
      to,
      templateName: def.name,
      languageCode: def.language,
      ...(components ? { components } : { bodyParams }),
    });

    const tplButtons = (def.buttons ?? (def.button ? [def.button] : [])).map(
      (b) => ({ type: b.type, text: b.text }),
    );
    await ctx.runMutation(internal.messages.insertAssistantMessage, {
      conversationId: args.conversationId,
      content: renderTemplateBody(def, bodyParams),
      createdAt: Date.now(),
      sentByUserId: args.sentByUserId,
      wamid: wamid && wamid.length > 6 ? wamid : undefined,
      metadata: {
        source: "manual_template",
        templateName: def.name,
        templateKey: def.key,
        templateFooter: def.footer ?? undefined,
        templateButtons: tplButtons,
      },
    });
    await ctx.runMutation(internal.conversations.updateLastMessageAt, {
      conversationId: args.conversationId,
    });

    return {
      ok: true as const,
      to,
      wamid,
      status,
      preview: renderTemplateBody(def, bodyParams),
    };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Registro de plantillas en YCloud/Meta ("toca hacerlas")
// ─────────────────────────────────────────────────────────────────────────────

export const registerCheckinTemplates = action({
  args: {
    wabaId: v.optional(v.string()),
    onlyKeys: v.optional(v.array(v.string())),
  },
  handler: async (_ctx, args) => {
    const apiKey = process.env.YCLOUD_API_KEY;
    if (!apiKey) throw new Error("Configura YCLOUD_API_KEY en Convex");
    const wabaId = (args.wabaId || process.env.YCLOUD_WABA_ID || "").trim();
    if (!wabaId) {
      throw new Error(
        "Falta wabaId (arg) o la variable YCLOUD_WABA_ID en Convex",
      );
    }

    const keys = (
      args.onlyKeys && args.onlyKeys.length > 0
        ? args.onlyKeys
        : ALL_TEMPLATE_KEYS
    ).filter((k): k is CheckinTemplateKey => Boolean(getTemplateDef(k)));

    const results: Array<{
      key: string;
      name: string;
      ok: boolean;
      status?: number;
      error?: string;
    }> = [];

    for (const key of keys) {
      const def = CHECKIN_TEMPLATES[key];
      const payload = buildRegisterPayload(def, wabaId);
      try {
        const res = await fetch(YCLOUD_TEMPLATES_BASE, {
          method: "POST",
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "X-API-Key": apiKey,
          },
          body: JSON.stringify(payload),
        });
        const text = await res.text();
        results.push({
          key: def.key,
          name: def.name,
          ok: res.ok,
          status: res.status,
          error: res.ok ? undefined : text.slice(0, 300),
        });
      } catch (e) {
        results.push({
          key: def.key,
          name: def.name,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    return results;
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Trazabilidad: dedupe + log a inbox
// ─────────────────────────────────────────────────────────────────────────────

export const recordScheduledMessage = internalMutation({
  args: {
    bookingId: v.id("bookings"),
    key: v.string(),
    recipient: v.string(),
    wamid: v.optional(v.string()),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const booking = await ctx.db.get(args.bookingId);
    if (!booking) return;
    const entries = booking.scheduledMessages ?? [];
    entries.push({
      key: args.key,
      recipient: args.recipient,
      sentAt: Date.now(),
      wamid: args.wamid,
      status: args.status,
    });
    await ctx.db.patch(args.bookingId, {
      scheduledMessages: entries,
      updatedAt: Date.now(),
    });
  },
});

/** Persiste en el inbox lo que se envió por plantilla (texto renderizado). */
export const logTemplateToInbox = internalMutation({
  args: {
    phone: v.string(),
    name: v.optional(v.string()),
    content: v.string(),
    wamid: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const phone = normalizeWhatsappPhone(args.phone);
    if (!phone) return;
    const contactId = await ctx.runMutation(internal.ycloud.getOrCreateContact, {
      phone,
      name: (args.name || "").trim() || phone,
    });
    const { conversationId } = await ctx.runMutation(
      internal.ycloud.getOrCreateConversation,
      { contactId },
    );
    await ctx.runMutation(internal.messages.insertAssistantMessage, {
      conversationId,
      content: args.content,
      createdAt: Date.now(),
      metadata: { source: "checkin_scheduled_template" },
      wamid: args.wamid && args.wamid.length > 6 ? args.wamid : undefined,
    });
    await ctx.runMutation(internal.conversations.updateLastMessageAt, {
      conversationId,
    });
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Destinatarios por momento del timeline (spec §3)
// ─────────────────────────────────────────────────────────────────────────────

type EnrichedBooking = {
  _id: Id<"bookings">;
  nombreCompleto: string;
  celular: string;
  fechaEntrada: number;
  fechaSalida: number;
  horaEntrada?: string;
  horaSalida?: string;
  reference?: string;
  checkinCompleted?: boolean;
  broadcastTag?: string;
  scheduledMessages?: Array<{ key: string; recipient: string }>;
  propertyTitle: string;
  propietarioNombre?: string;
  propietarioTelefono?: string;
  encargadoNombre?: string;
  encargadoTelefono?: string;
};

export const bookingsInWindow = internalQuery({
  args: {
    dateField: v.union(v.literal("fechaEntrada"), v.literal("fechaSalida")),
    minDate: v.number(),
    maxDate: v.number(),
    tag: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<EnrichedBooking[]> => {
    const all = await ctx.db.query("bookings").collect();

    const inWindow = all.filter((b) => {
      const value = args.dateField === "fechaEntrada" ? b.fechaEntrada : b.fechaSalida;
      const okDate = value >= args.minDate && value <= args.maxDate;
      const okStatus = b.status === "CONFIRMED" || b.status === "PAID";
      const okTag = !args.tag || b.broadcastTag === args.tag;
      return okDate && okStatus && okTag;
    });

    return await Promise.all(
      inWindow.map(async (b) => {
        const property = await ctx.db.get(b.propertyId);
        return {
          _id: b._id,
          nombreCompleto: b.nombreCompleto,
          celular: b.celular,
          fechaEntrada: b.fechaEntrada,
          fechaSalida: b.fechaSalida,
          horaEntrada: b.horaEntrada,
          horaSalida: b.horaSalida,
          reference: b.reference,
          checkinCompleted: b.checkinCompleted,
          broadcastTag: b.broadcastTag,
          scheduledMessages: (b.scheduledMessages ?? []).map((m) => ({
            key: m.key,
            recipient: m.recipient,
          })),
          propertyTitle: (property as { title?: string } | null)?.title || "tu finca",
          propietarioNombre: (property as { propietarioNombre?: string } | null)
            ?.propietarioNombre,
          propietarioTelefono: (property as { propietarioTelefono?: string } | null)
            ?.propietarioTelefono,
          encargadoNombre: (property as { encargadoNombre?: string } | null)
            ?.encargadoNombre,
          encargadoTelefono: (property as { encargadoTelefono?: string } | null)
            ?.encargadoTelefono,
        };
      }),
    );
  },
});

type PlannedSend = {
  bookingId: Id<"bookings">;
  to: string;
  recipientName: string;
  recipientType: "tourist" | "owner" | "manager";
  bodyParams: string[];
  logToInbox: boolean;
};

/** Traduce un momento del timeline en envíos concretos para cada reserva. */
function planSendsForMoment(
  key: CheckinTemplateKey,
  def: TemplateDef,
  bookings: EnrichedBooking[],
): PlannedSend[] {
  const portal = checkinPortalBase();
  const plans: PlannedSend[] = [];

  const alreadySent = (b: EnrichedBooking, recipient: string) =>
    (b.scheduledMessages ?? []).some(
      (m) => m.key === key && m.recipient === recipient,
    );

  for (const b of bookings) {
    const finca = b.propertyTitle;
    const cr = (b.reference || b._id) as string;
    const link = `${portal}/${cr}`;
    const touristTo = normalizeOutboundPhone(b.celular);
    const ownerTo = normalizeOutboundPhone(b.propietarioTelefono);
    const managerTo = normalizeOutboundPhone(b.encargadoTelefono);

    switch (key) {
      case "owner_week_reminder":
        if (ownerTo && !alreadySent(b, ownerTo)) {
          plans.push({
            bookingId: b._id,
            to: ownerTo,
            recipientName: b.propietarioNombre || "propietario",
            recipientType: "owner",
            bodyParams: buildBodyParams(def, {
              nombrePropietario: firstName(b.propietarioNombre) || "propietario",
              nombreFinca: finca,
            }),
            logToInbox: false,
          });
        }
        break;
      case "tourist_checkin_start":
        if (touristTo && !alreadySent(b, touristTo)) {
          plans.push({
            bookingId: b._id,
            to: touristTo,
            recipientName: b.nombreCompleto,
            recipientType: "tourist",
            bodyParams: buildBodyParams(def, {
              nombreTurista: firstName(b.nombreCompleto),
              nombreFinca: finca,
              referenciaReserva: cr,
              fechaLlegada: formatFechaLlegada(b.fechaEntrada),
              horaIngreso: formatHoraEntrada(b.horaEntrada, b.fechaEntrada),
              linkCheckin: link,
            }),
            logToInbox: true,
          });
        }
        break;
      case "tourist_checkin_pending":
        if (touristTo && b.checkinCompleted !== true && !alreadySent(b, touristTo)) {
          plans.push({
            bookingId: b._id,
            to: touristTo,
            recipientName: b.nombreCompleto,
            recipientType: "tourist",
            bodyParams: buildBodyParams(def, {
              nombreTurista: firstName(b.nombreCompleto),
              nombreFinca: finca,
              linkCheckin: link,
            }),
            logToInbox: true,
          });
        }
        break;
      case "tourist_travel_tomorrow":
        // Solo a quien YA hizo check-in (a los pendientes los cubre
        // `tourist_checkin_pending`) para no duplicar el mensaje del día antes.
        if (touristTo && b.checkinCompleted === true && !alreadySent(b, touristTo)) {
          plans.push({
            bookingId: b._id,
            to: touristTo,
            recipientName: b.nombreCompleto,
            recipientType: "tourist",
            bodyParams: buildBodyParams(def, {
              nombreTurista: firstName(b.nombreCompleto),
              nombreFinca: finca,
            }),
            logToInbox: true,
          });
        }
        break;
      case "owner_arrival_tomorrow":
        if (ownerTo && !alreadySent(b, ownerTo)) {
          plans.push({
            bookingId: b._id,
            to: ownerTo,
            recipientName: b.propietarioNombre || "propietario",
            recipientType: "owner",
            bodyParams: buildBodyParams(def, {
              nombrePropietario: firstName(b.propietarioNombre) || "propietario",
              nombreFinca: finca,
            }),
            logToInbox: false,
          });
        }
        if (managerTo && !alreadySent(b, managerTo)) {
          plans.push({
            bookingId: b._id,
            to: managerTo,
            recipientName: b.encargadoNombre || "encargado",
            recipientType: "manager",
            bodyParams: buildBodyParams(def, {
              nombrePropietario: firstName(b.encargadoNombre) || "encargado",
              nombreFinca: finca,
            }),
            logToInbox: false,
          });
        }
        break;
      case "tourist_departure":
        if (touristTo && !alreadySent(b, touristTo)) {
          plans.push({
            bookingId: b._id,
            to: touristTo,
            recipientName: b.nombreCompleto,
            recipientType: "tourist",
            bodyParams: buildBodyParams(def, {
              nombreTurista: firstName(b.nombreCompleto),
              nombreFinca: finca,
              horaSalida: b.horaSalida || "la hora acordada",
            }),
            logToInbox: true,
          });
        }
        break;
    }
  }
  return plans;
}

// ─────────────────────────────────────────────────────────────────────────────
// Envío manual por reserva (desde el modal de Reservas)
// ─────────────────────────────────────────────────────────────────────────────

export const getBookingForSend = internalQuery({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, args): Promise<EnrichedBooking | null> => {
    const b = await ctx.db.get(args.bookingId);
    if (!b) return null;
    const property = await ctx.db.get(b.propertyId);
    return {
      _id: b._id,
      nombreCompleto: b.nombreCompleto,
      celular: b.celular,
      fechaEntrada: b.fechaEntrada,
      fechaSalida: b.fechaSalida,
      horaEntrada: b.horaEntrada,
      horaSalida: b.horaSalida,
      reference: b.reference,
      checkinCompleted: b.checkinCompleted,
      broadcastTag: b.broadcastTag,
      scheduledMessages: (b.scheduledMessages ?? []).map((m) => ({
        key: m.key,
        recipient: m.recipient,
      })),
      propertyTitle: (property as { title?: string } | null)?.title || "tu finca",
      propietarioNombre: (property as { propietarioNombre?: string } | null)
        ?.propietarioNombre,
      propietarioTelefono: (property as { propietarioTelefono?: string } | null)
        ?.propietarioTelefono,
      encargadoNombre: (property as { encargadoNombre?: string } | null)
        ?.encargadoNombre,
      encargadoTelefono: (property as { encargadoTelefono?: string } | null)
        ?.encargadoTelefono,
    };
  },
});

/** Resuelve destinatario y variables para un envío manual (sin dedupe ni fecha). */
function resolveManualSend(
  key: CheckinTemplateKey,
  def: TemplateDef,
  b: EnrichedBooking,
): { to: string; recipientName: string; recipientType: string; bodyParams: string[] } | null {
  const finca = b.propertyTitle;
  const cr = (b.reference || b._id) as string;
  const link = `${checkinPortalBase()}/${cr}`;
  const isOwnerTemplate =
    key === "owner_week_reminder" || key === "owner_arrival_tomorrow";

  if (isOwnerTemplate) {
    const to = normalizeOutboundPhone(b.propietarioTelefono);
    if (!to) return null;
    return {
      to,
      recipientName: b.propietarioNombre || "propietario",
      recipientType: "owner",
      bodyParams: buildBodyParams(def, {
        nombrePropietario: firstName(b.propietarioNombre) || "propietario",
        nombreFinca: finca,
      }),
    };
  }

  const to = normalizeOutboundPhone(b.celular);
  if (!to) return null;
  return {
    to,
    recipientName: b.nombreCompleto,
    recipientType: "tourist",
    bodyParams: buildBodyParams(def, {
      nombreTurista: firstName(b.nombreCompleto),
      nombreFinca: finca,
      referenciaReserva: cr,
      fechaLlegada: formatFechaLlegada(b.fechaEntrada),
      horaIngreso: formatHoraEntrada(b.horaEntrada, b.fechaEntrada),
      linkCheckin: link,
      horaSalida: b.horaSalida || "la hora acordada",
    }),
  };
}

/**
 * Devuelve el link del portal de check-in de una reserva (mismo que va en la
 * plantilla de WhatsApp), para copiarlo manualmente cuando NO se quiere enviar
 * por WhatsApp.
 */
export const getCheckinLink = query({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, args): Promise<{
    link: string;
    reference: string;
    checkinUbicacionUrl?: string;
    checkinIndicacionesLlegada?: string;
    checkinRecomendaciones?: string;
    checkinUbicacionImageUrl?: string;
    checkinUbicacionImageUrls?: string[];
  }> => {
    const b = await ctx.db.get(args.bookingId);
    if (!b) throw new Error("Reserva no encontrada");
    const cr = ((b as { reference?: string }).reference ||
      (b._id as string)) as string;

    const ownerInfo = await ctx.db
      .query("propertyOwnerInfo")
      .withIndex("by_property", (q) => q.eq("propertyId", b.propertyId))
      .unique();
    const mapsUrl = String(ownerInfo?.checkinUbicacionUrl ?? "").trim();
    const indicaciones = String(
      ownerInfo?.checkinIndicacionesLlegada ?? "",
    ).trim();
    const recomendaciones = String(
      ownerInfo?.checkinRecomendaciones ?? "",
    ).trim();
    const legacyImage = String(
      ownerInfo?.checkinUbicacionImageUrl ?? "",
    ).trim();
    const rawUrls = Array.isArray(ownerInfo?.checkinUbicacionImageUrls)
      ? (ownerInfo.checkinUbicacionImageUrls as unknown[])
      : [];
    let imageUrls = rawUrls
      .map((u) => String(u ?? "").trim())
      .filter((u) => u.length > 0);
    if (imageUrls.length === 0 && legacyImage) imageUrls = [legacyImage];
    const imageUrl = imageUrls[0] ?? "";

    return {
      link: `${checkinPortalBase()}/${cr}`,
      reference: cr,
      ...(mapsUrl ? { checkinUbicacionUrl: mapsUrl } : {}),
      ...(indicaciones ? { checkinIndicacionesLlegada: indicaciones } : {}),
      ...(recomendaciones ? { checkinRecomendaciones: recomendaciones } : {}),
      ...(imageUrl ? { checkinUbicacionImageUrl: imageUrl } : {}),
      ...(imageUrls.length ? { checkinUbicacionImageUrls: imageUrls } : {}),
    };
  },
});

/**
 * Envía manualmente una plantilla a UNA reserva concreta (desde el modal de
 * Reservas). Resuelve el teléfono y las variables a partir de la reserva; no
 * aplica dedupe ni filtro de fecha (el equipo decide cuándo mandarlo).
 */
export const sendTemplateToBooking = action({
  args: {
    bookingId: v.id("bookings"),
    templateKey: v.string(),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const def = getTemplateDef(args.templateKey);
    if (!def) throw new Error(`Plantilla desconocida: ${args.templateKey}`);
    const key = args.templateKey as CheckinTemplateKey;

    const b: EnrichedBooking | null = await ctx.runQuery(
      internal.checkinMessaging.getBookingForSend,
      { bookingId: args.bookingId },
    );
    if (!b) throw new Error("Reserva no encontrada");

    const resolved = resolveManualSend(key, def, b);
    if (!resolved) {
      return {
        ok: false as const,
        error:
          key === "owner_week_reminder" || key === "owner_arrival_tomorrow"
            ? "La finca no tiene teléfono de propietario configurado."
            : "La reserva no tiene un celular válido.",
      };
    }

    if (args.dryRun) {
      return {
        ok: true as const,
        dryRun: true,
        to: resolved.to,
        preview: renderTemplateBody(def, resolved.bodyParams),
      };
    }

    try {
      const components = buildSendComponents(def, resolved.bodyParams);
      const { wamid, status } = await sendTemplateToYcloud({
        to: resolved.to,
        templateName: def.name,
        languageCode: def.language,
        ...(components ? { components } : { bodyParams: resolved.bodyParams }),
      });
      await ctx.runMutation(internal.checkinMessaging.recordScheduledMessage, {
        bookingId: b._id,
        key,
        recipient: resolved.to,
        wamid,
        status,
      });
      if (resolved.recipientType === "tourist") {
        await ctx.runMutation(internal.checkinMessaging.logTemplateToInbox, {
          phone: resolved.to,
          name: resolved.recipientName,
          content: renderTemplateBody(def, resolved.bodyParams),
          wamid,
        });
      }
      return { ok: true as const, to: resolved.to, wamid, status };
    } catch (e) {
      return {
        ok: false as const,
        to: resolved.to,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Motor: ejecutar un momento del timeline (lo llama el cron de NestJS)
// ─────────────────────────────────────────────────────────────────────────────

export const runScheduledMoment = action({
  args: {
    key: v.string(),
    minDate: v.number(),
    maxDate: v.number(),
    tag: v.optional(v.string()),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const def = getTemplateDef(args.key);
    if (!def) throw new Error(`Plantilla desconocida: ${args.key}`);
    const key = args.key as CheckinTemplateKey;

    const dateField =
      key === "tourist_departure" ? "fechaSalida" : "fechaEntrada";
    const bookings: EnrichedBooking[] = await ctx.runQuery(
      internal.checkinMessaging.bookingsInWindow,
      { dateField, minDate: args.minDate, maxDate: args.maxDate, tag: args.tag },
    );

    const plans = planSendsForMoment(key, def, bookings);

    let sent = 0;
    let failed = 0;
    const details: Array<{
      to: string;
      recipientType: string;
      ok: boolean;
      wamid?: string;
      error?: string;
    }> = [];

    for (const plan of plans) {
      if (args.dryRun) {
        details.push({ to: plan.to, recipientType: plan.recipientType, ok: true });
        continue;
      }
      try {
        const components = buildSendComponents(def, plan.bodyParams);
        const { wamid, status } = await sendTemplateToYcloud({
          to: plan.to,
          templateName: def.name,
          languageCode: def.language,
          ...(components ? { components } : { bodyParams: plan.bodyParams }),
        });
        await ctx.runMutation(internal.checkinMessaging.recordScheduledMessage, {
          bookingId: plan.bookingId,
          key,
          recipient: plan.to,
          wamid,
          status,
        });
        if (plan.logToInbox) {
          await ctx.runMutation(internal.checkinMessaging.logTemplateToInbox, {
            phone: plan.to,
            name: plan.recipientName,
            content: renderTemplateBody(def, plan.bodyParams),
            wamid,
          });
        }
        sent++;
        details.push({ to: plan.to, recipientType: plan.recipientType, ok: true, wamid });
      } catch (e) {
        failed++;
        details.push({
          to: plan.to,
          recipientType: plan.recipientType,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return {
      key,
      template: def.name,
      candidates: bookings.length,
      planned: plans.length,
      sent,
      failed,
      dryRun: Boolean(args.dryRun),
      details,
    };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Envío en lote con selección + edición previa (spec §10)
// ─────────────────────────────────────────────────────────────────────────────

/** Lista reservas (con params por defecto) para poblar la UI de envío en lote. */
export const listBookingsForBatch = query({
  args: {
    templateKey: v.string(),
    minDate: v.number(),
    maxDate: v.number(),
    tag: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const def = getTemplateDef(args.templateKey);
    if (!def) throw new Error(`Plantilla desconocida: ${args.templateKey}`);
    const key = args.templateKey as CheckinTemplateKey;
    const dateField =
      key === "tourist_departure" ? "fechaSalida" : "fechaEntrada";

    const all = await ctx.db.query("bookings").collect();

    const portal = checkinPortalBase();
    const rows = [];
    for (const b of all) {
      const value = dateField === "fechaEntrada" ? b.fechaEntrada : b.fechaSalida;
      if (value < args.minDate || value > args.maxDate) continue;
      if (b.status !== "CONFIRMED" && b.status !== "PAID") continue;
      if (args.tag && b.broadcastTag !== args.tag) continue;
      const property = await ctx.db.get(b.propertyId);
      const finca = (property as { title?: string } | null)?.title || "tu finca";
      const cr = (b.reference || b._id) as string;
      const defaults: Record<string, string> = {
        nombreTurista: firstName(b.nombreCompleto),
        nombrePropietario: firstName(
          (property as { propietarioNombre?: string } | null)?.propietarioNombre,
        ),
        nombreFinca: finca,
        referenciaReserva: cr,
        fechaLlegada: formatFechaLlegada(b.fechaEntrada),
        horaIngreso: formatHoraEntrada(b.horaEntrada, b.fechaEntrada),
        linkCheckin: `${portal}/${cr}`,
        horaSalida: b.horaSalida || "la hora acordada",
      };
      rows.push({
        bookingId: b._id,
        cr,
        nombreCompleto: b.nombreCompleto,
        celular: normalizeOutboundPhone(b.celular),
        propertyTitle: finca,
        fechaEntrada: b.fechaEntrada,
        fechaSalida: b.fechaSalida,
        checkinCompleted: b.checkinCompleted === true,
        broadcastTag: b.broadcastTag ?? null,
        defaultParams: def.paramKeys.map((k2) => defaults[k2] ?? ""),
      });
    }
    return { template: { key: def.key, name: def.name, paramKeys: def.paramKeys }, rows };
  },
});

/**
 * Envía una plantilla a destinatarios ya resueltos por la UI (con sus params
 * editados). Itera 1-a-1 (no hay broadcast nativo en WhatsApp/Meta).
 */
export const sendBatchTemplate = action({
  args: {
    templateKey: v.string(),
    recipients: v.array(
      v.object({
        bookingId: v.optional(v.id("bookings")),
        to: v.string(),
        recipientName: v.optional(v.string()),
        bodyParams: v.array(v.string()),
        logToInbox: v.optional(v.boolean()),
      }),
    ),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const def = getTemplateDef(args.templateKey);
    if (!def) throw new Error(`Plantilla desconocida: ${args.templateKey}`);

    let sent = 0;
    let failed = 0;
    const details: Array<{ to: string; ok: boolean; wamid?: string; error?: string }> = [];

    for (const r of args.recipients) {
      const to = normalizeOutboundPhone(r.to);
      if (!to) {
        failed++;
        details.push({ to: r.to, ok: false, error: "Teléfono inválido" });
        continue;
      }
      if (args.dryRun) {
        details.push({ to, ok: true });
        continue;
      }
      try {
        const components = buildSendComponents(def, r.bodyParams);
        const { wamid, status } = await sendTemplateToYcloud({
          to,
          templateName: def.name,
          languageCode: def.language,
          ...(components ? { components } : { bodyParams: r.bodyParams }),
        });
        if (r.bookingId) {
          await ctx.runMutation(internal.checkinMessaging.recordScheduledMessage, {
            bookingId: r.bookingId,
            key: def.key,
            recipient: to,
            wamid,
            status,
          });
        }
        if (r.logToInbox ?? true) {
          await ctx.runMutation(internal.checkinMessaging.logTemplateToInbox, {
            phone: to,
            name: r.recipientName,
            content: renderTemplateBody(def, r.bodyParams),
            wamid,
          });
        }
        sent++;
        details.push({ to, ok: true, wamid });
      } catch (e) {
        failed++;
        details.push({
          to,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
      // Pequeña pausa entre envíos para no saturar la API.
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return { template: def.name, total: args.recipients.length, sent, failed, details };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Soporte: etiqueta de lote + check-in manual (spec §8.1 / §10)
// ─────────────────────────────────────────────────────────────────────────────

export const setBroadcastTag = mutation({
  args: { bookingId: v.id("bookings"), tag: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.bookingId, {
      broadcastTag: args.tag ?? undefined,
      updatedAt: Date.now(),
    });
  },
});

export const setCheckinCompleted = mutation({
  args: { bookingId: v.id("bookings"), completed: v.boolean() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.bookingId, {
      checkinCompleted: args.completed,
      checkinCompletedAt: args.completed ? Date.now() : undefined,
      updatedAt: Date.now(),
    });
  },
});

/** Envío individual de un template ad-hoc (uso interno / pruebas). */
export const sendSingleTemplate = internalAction({
  args: {
    to: v.string(),
    templateKey: v.string(),
    bodyParams: v.array(v.string()),
  },
  handler: async (_ctx, args) => {
    const def = getTemplateDef(args.templateKey);
    if (!def) throw new Error(`Plantilla desconocida: ${args.templateKey}`);
    return sendTemplateToYcloud({
      to: normalizeOutboundPhone(args.to),
      templateName: def.name,
      languageCode: def.language,
      bodyParams: args.bodyParams,
    });
  },
});
