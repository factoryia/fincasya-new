"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getWithHistory = exports.list = exports.getById = void 0;
const values_1 = require("convex/values");
const server_1 = require("./_generated/server");
exports.getById = (0, server_1.query)({
    args: { contactId: values_1.v.id("contacts") },
    handler: async (ctx, args) => {
        return await ctx.db.get(args.contactId);
    },
});
exports.list = (0, server_1.query)({
    args: {
        limit: values_1.v.optional(values_1.v.number()),
        search: values_1.v.optional(values_1.v.string()),
    },
    handler: async (ctx, args) => {
        const limit = args.limit ?? 50;
        let contactsQuery = ctx.db.query("contacts");
        const allContacts = await contactsQuery.order("desc").collect();
        if (args.search) {
            const searchLower = args.search.toLowerCase();
            const filtered = allContacts.filter(c => c.name.toLowerCase().includes(searchLower) ||
                c.phone.includes(searchLower) ||
                (c.cedula && c.cedula.includes(searchLower)) ||
                (c.email && c.email.toLowerCase().includes(searchLower)));
            return filtered.slice(0, limit);
        }
        return allContacts.slice(0, limit);
    },
});
exports.getWithHistory = (0, server_1.query)({
    args: {
        contactId: values_1.v.id("contacts")
    },
    handler: async (ctx, args) => {
        const contact = await ctx.db.get(args.contactId);
        if (!contact)
            return null;
        const bookingsByCedula = contact.cedula
            ? await ctx.db
                .query("bookings")
                .withIndex("by_cedula", (q) => q.eq("cedula", contact.cedula))
                .collect()
            : [];
        const bookingsByPhone = await ctx.db
            .query("bookings")
            .collect();
        const phoneFiltered = bookingsByPhone.filter(b => b.celular === contact.phone);
        const allBookings = [...bookingsByCedula, ...phoneFiltered];
        const uniqueBookings = Array.from(new Map(allBookings.map(b => [b._id, b])).values());
        const enrichedBookings = await Promise.all(uniqueBookings.map(async (b) => {
            const property = await ctx.db.get(b.propertyId);
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
        }));
        return {
            ...contact,
            bookings: enrichedBookings.sort((a, b) => b.fechaEntrada - a.fechaEntrada),
        };
    },
});
//# sourceMappingURL=contacts.js.map