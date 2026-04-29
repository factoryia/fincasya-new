import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

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
      return filtered.slice(0, limit);
    }

    return allContacts.slice(0, limit);
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

