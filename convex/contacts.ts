import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query, internalMutation, type QueryCtx } from "./_generated/server";

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

async function enrichContactWithInbox(
  ctx: QueryCtx,
  contact: { _id: Id<"contacts">; [key: string]: unknown },
) {
  const conversations = await ctx.db
    .query("conversations")
    .withIndex("by_contact", (q) => q.eq("contactId", contact._id))
    .collect();

  const tagSet = new Set<string>();
  let primaryConversationId: Id<"conversations"> | null = null;
  let maxLast = -1;

  for (const conv of conversations) {
    for (const t of conv.tags ?? []) {
      const s = String(t).trim();
      if (s) tagSet.add(s);
    }
    const lm = conv.lastMessageAt ?? conv.createdAt ?? 0;
    if (lm > maxLast) {
      maxLast = lm;
      primaryConversationId = conv._id;
    }
  }

  return {
    ...contact,
    tags: Array.from(tagSet),
    primaryConversationId,
    hasConversation: conversations.length > 0,
  };
}

/**
 * Auto-etiqueta el contacto con el contexto del deal cuando el bot ya tiene
 * suficiente info comercial (finca elegida + cupo, opcionalmente fechas).
 *
 *  Resultado en el inbox:  `Camilo R · Quinta Montebello · 15pax · 07-08→10-08`
 *
 * Reglas:
 * - Preserva el nombre ORIGINAL (perfil de WhatsApp / panel) en `baseName`
 *   la primera vez que se etiqueta — para no perderlo cuando enriquecemos
 *   `name`.
 * - Idempotente: si el `dealLabel` propuesto es idéntico al actual, no-op.
 * - NO degrada `crmType='client'` a `'lead'` (cuando el cliente ya reservó,
 *   queda como `client` aunque el bot vuelva a recoger info).
 */
export const setLeadDealLabel = internalMutation({
  args: {
    contactId: v.id("contacts"),
    dealLabel: v.string(),
  },
  handler: async (ctx, args) => {
    const contact = await ctx.db.get(args.contactId);
    if (!contact) return { updated: false };

    const newLabel = args.dealLabel.trim();
    if (!newLabel) return { updated: false };
    if (contact.dealLabel === newLabel) return { updated: false };

    const baseName =
      contact.baseName && contact.baseName.length > 0
        ? contact.baseName
        : contact.name;

    await ctx.db.patch(args.contactId, {
      baseName,
      dealLabel: newLabel,
      name: `${baseName} · ${newLabel}`,
      // Solo subimos a 'lead' si no es ya 'client' (cliente ya cerró).
      ...(contact.crmType === "client" ? {} : { crmType: "lead" as const }),
      updatedAt: Date.now(),
    });
    return { updated: true };
  },
});

export const getById = query({
  args: { contactId: v.id("contacts") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.contactId);
  },
});

/**
 * Actualizar ficha de contacto (CRM / inbox). No modifica teléfono (clave de WhatsApp).
 */
export const update = mutation({
  args: {
    contactId: v.id("contacts"),
    name: v.optional(v.string()),
    cedula: v.optional(v.string()),
    email: v.optional(v.string()),
    city: v.optional(v.string()),
    crmType: v.optional(v.union(v.literal("lead"), v.literal("client"))),
  },
  handler: async (ctx, args) => {
    const { contactId, ...rest } = args;
    const current = await ctx.db.get(contactId);
    if (!current) throw new Error("Contacto no encontrado");
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (rest.name !== undefined) {
      const t = String(rest.name).trim();
      if (t.length < 1) throw new Error("El nombre no puede estar vacío");
      patch.name = t;
    }
    if (rest.cedula !== undefined) {
      const t = String(rest.cedula).trim();
      patch.cedula = t.length > 0 ? t : undefined;
    }
    if (rest.email !== undefined) {
      const t = String(rest.email).trim();
      patch.email = t.length > 0 ? t : undefined;
    }
    if (rest.city !== undefined) {
      const t = String(rest.city).trim();
      patch.city = t.length > 0 ? t : undefined;
    }
    if (rest.crmType !== undefined) patch.crmType = rest.crmType;
    await ctx.db.patch(contactId, patch);
    return await ctx.db.get(contactId);
  },
});

export const list = query({
  args: {
    limit: v.optional(v.number()),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;
    const contactsQuery = ctx.db.query("contacts");

    const allContacts = await contactsQuery.order("desc").collect();

    if (args.search) {
      const searchLower = args.search.toLowerCase();
      const filtered = allContacts.filter(c => 
        c.name.toLowerCase().includes(searchLower) || 
        c.phone.includes(searchLower) || 
        (c.cedula && c.cedula.includes(searchLower)) ||
        (c.email && c.email.toLowerCase().includes(searchLower))
      );
      const slice = filtered.slice(0, limit);
      return Promise.all(slice.map((c) => enrichContactWithInbox(ctx, c)));
    }

    const slice = allContacts.slice(0, limit);
    return Promise.all(slice.map((c) => enrichContactWithInbox(ctx, c)));
  },
});

/** Sincroniza etiquetas en todas las conversaciones del contacto (inbox). */
export const setTagsForContact = mutation({
  args: {
    contactId: v.id("contacts"),
    tags: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const contact = await ctx.db.get(args.contactId);
    if (!contact) throw new Error("Contacto no encontrado");

    const conversations = await ctx.db
      .query("conversations")
      .withIndex("by_contact", (q) => q.eq("contactId", args.contactId))
      .collect();

    if (conversations.length === 0) {
      throw new Error("Este contacto no tiene conversaciones en el inbox");
    }

    const next = normalizeConversationTags(args.tags);
    for (const conv of conversations) {
      await ctx.db.patch(conv._id, { tags: next });
    }

    return { tags: next, updatedConversations: conversations.length };
  },
});

export const getWithHistory = query({
  args: { 
    contactId: v.id("contacts") 
  },
  handler: async (ctx, args) => {
    const contact = await ctx.db.get(args.contactId);
    if (!contact) return null;

    // Buscar reservas por cédula o celular
    const bookingsByCedula = contact.cedula 
      ? await ctx.db
          .query("bookings")
          .withIndex("by_cedula", (q) => q.eq("cedula", contact.cedula!))
          .collect()
      : [];

    const bookingsByPhone = await ctx.db
      .query("bookings")
      .collect(); // Fallback filter for phone if no index exists easily or just collect all and filter
    
    const phoneFiltered = bookingsByPhone.filter(b => b.celular === contact.phone);

    // Unificar y quitar duplicados por _id
    const allBookings = [...bookingsByCedula, ...phoneFiltered];
    const uniqueBookings = Array.from(new Map(allBookings.map(b => [b._id, b])).values());

    // Enriquecer con títulos e imágenes de propiedades
    const enrichedBookings = await Promise.all(
      uniqueBookings.map(async (b) => {
        const property = await ctx.db.get(b.propertyId);
        
        // Obtener la primera imagen de la propiedad (menor valor de 'order')
        const allPropImages = await ctx.db
          .query("propertyImages")
          .withIndex("by_property", (q) => q.eq("propertyId", b.propertyId))
          .collect();
        
        const propImage = allPropImages.sort((x, y) => (x.order ?? 100) - (y.order ?? 100))[0];

        return {
          ...b,
          propertyTitle: property?.title || "Propiedad eliminada",
          propertyImage: propImage?.url,
        };
      })
    );

    return {
      ...contact,
      bookings: enrichedBookings.sort((a, b) => b.fechaEntrada - a.fechaEntrada),
    };
  },
});

