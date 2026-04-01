import { v } from "convex/values";
import { query } from "./_generated/server";

export const getById = query({
  args: { contactId: v.id("contacts") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.contactId);
  },
});

export const list = query({
  args: {
    limit: v.optional(v.number()),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;
    let contactsQuery = ctx.db.query("contacts");

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

