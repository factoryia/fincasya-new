"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.remove = exports.createPayment = exports.cancel = exports.update = exports.create = exports.checkAvailability = exports.getByReference = exports.getById = exports.list = void 0;
const values_1 = require("convex/values");
const server_1 = require("./_generated/server");
const api_1 = require("./_generated/api");
exports.list = (0, server_1.query)({
    args: {
        propertyId: values_1.v.optional(values_1.v.id('properties')),
        userId: values_1.v.optional(values_1.v.id('user')),
        status: values_1.v.optional(values_1.v.union(values_1.v.literal('PENDING'), values_1.v.literal('CONFIRMED'), values_1.v.literal('PAID'), values_1.v.literal('CANCELLED'), values_1.v.literal('COMPLETED'))),
        limit: values_1.v.optional(values_1.v.number()),
        cursor: values_1.v.optional(values_1.v.id('bookings')),
        month: values_1.v.optional(values_1.v.string()),
        year: values_1.v.optional(values_1.v.string()),
        isDirect: values_1.v.optional(values_1.v.boolean()),
    },
    handler: async (ctx, args) => {
        const limit = args.limit ?? 50;
        const allBookings = args.propertyId
            ? await ctx.db
                .query('bookings')
                .withIndex('by_property', (q) => q.eq('propertyId', args.propertyId))
                .collect()
            : args.status
                ? await ctx.db
                    .query('bookings')
                    .withIndex('by_status', (q) => q.eq('status', args.status))
                    .collect()
                : args.userId
                    ? await ctx.db
                        .query('bookings')
                        .withIndex('by_user', (q) => q.eq('userId', args.userId))
                        .collect()
                    : args.isDirect !== undefined
                        ? await ctx.db
                            .query('bookings')
                            .withIndex('by_is_direct', (q) => q.eq('isDirect', args.isDirect))
                            .collect()
                        : await ctx.db.query('bookings').collect();
        let filtered = allBookings;
        if (args.month && args.year) {
            const year = parseInt(args.year, 10);
            const month = parseInt(args.month, 10) - 1;
            const startMs = new Date(year, month, 1).getTime();
            const endMs = new Date(year, month + 1, 0, 23, 59, 59, 999).getTime();
            filtered = filtered.filter((b) => b.fechaEntrada <= endMs && b.fechaSalida >= startMs);
        }
        if (args.isDirect !== undefined) {
            filtered = filtered.filter((b) => b.isDirect === args.isDirect);
        }
        if (args.cursor) {
            filtered = filtered.filter((b) => b._id > args.cursor);
        }
        filtered = filtered.sort((a, b) => b.createdAt - a.createdAt);
        const hasMore = filtered.length > limit;
        const bookingsToReturn = hasMore ? filtered.slice(0, limit) : filtered;
        const bookingsWithDetails = await Promise.all(bookingsToReturn.map(async (booking) => {
            const property = await ctx.db.get(booking.propertyId);
            let firstImage = null;
            if (property) {
                const images = await ctx.db
                    .query('propertyImages')
                    .withIndex('by_property', (q) => q.eq('propertyId', property._id))
                    .collect();
                if (images.length > 0) {
                    firstImage = images.sort((a, b) => (a.order || 0) - (b.order || 0))[0]?.url;
                }
            }
            return {
                ...booking,
                property: property
                    ? {
                        id: property._id,
                        title: property.title,
                        location: property.location,
                        image: firstImage,
                    }
                    : null,
            };
        }));
        const nextCursor = hasMore && bookingsWithDetails.length > 0
            ? bookingsWithDetails[bookingsWithDetails.length - 1]._id
            : undefined;
        return {
            bookings: bookingsWithDetails,
            hasMore,
            nextCursor,
        };
    },
});
exports.getById = (0, server_1.query)({
    args: { id: values_1.v.id('bookings') },
    handler: async (ctx, args) => {
        const booking = await ctx.db.get(args.id);
        if (!booking) {
            return null;
        }
        const property = await ctx.db.get(booking.propertyId);
        const payments = await ctx.db
            .query('payments')
            .withIndex('by_booking', (q) => q.eq('bookingId', args.id))
            .collect();
        return {
            ...booking,
            property,
            payments,
        };
    },
});
exports.getByReference = (0, server_1.query)({
    args: { reference: values_1.v.string() },
    handler: async (ctx, args) => {
        const booking = await ctx.db
            .query('bookings')
            .withIndex('by_reference', (q) => q.eq('reference', args.reference))
            .first();
        if (!booking) {
            return null;
        }
        const property = await ctx.db.get(booking.propertyId);
        const payments = await ctx.db
            .query('payments')
            .withIndex('by_booking', (q) => q.eq('bookingId', booking._id))
            .collect();
        return {
            ...booking,
            property,
            payments,
        };
    },
});
exports.checkAvailability = (0, server_1.query)({
    args: {
        propertyId: values_1.v.id('properties'),
        fechaEntrada: values_1.v.number(),
        fechaSalida: values_1.v.number(),
    },
    handler: async (ctx, args) => {
        const conflictingBookings = await ctx.db
            .query('bookings')
            .withIndex('by_property', (q) => q.eq('propertyId', args.propertyId))
            .filter((q) => q.or(q.and(q.lte(q.field('fechaEntrada'), args.fechaEntrada), q.gte(q.field('fechaSalida'), args.fechaEntrada)), q.and(q.lte(q.field('fechaEntrada'), args.fechaSalida), q.gte(q.field('fechaSalida'), args.fechaSalida)), q.and(q.gte(q.field('fechaEntrada'), args.fechaEntrada), q.lte(q.field('fechaSalida'), args.fechaSalida))))
            .filter((q) => q.neq(q.field('status'), 'CANCELLED'))
            .collect();
        return {
            available: conflictingBookings.length === 0,
            conflictingBookings: conflictingBookings.map((b) => ({
                id: b._id,
                fechaEntrada: b.fechaEntrada,
                fechaSalida: b.fechaSalida,
                status: b.status,
            })),
        };
    },
});
exports.create = (0, server_1.mutation)({
    args: {
        propertyId: values_1.v.id('properties'),
        userId: values_1.v.optional(values_1.v.string()),
        nombreCompleto: values_1.v.string(),
        cedula: values_1.v.string(),
        celular: values_1.v.string(),
        correo: values_1.v.string(),
        fechaEntrada: values_1.v.number(),
        fechaSalida: values_1.v.number(),
        numeroNoches: values_1.v.number(),
        numeroPersonas: values_1.v.number(),
        personasAdicionales: values_1.v.optional(values_1.v.number()),
        tieneMascotas: values_1.v.optional(values_1.v.boolean()),
        numeroMascotas: values_1.v.optional(values_1.v.number()),
        detallesMascotas: values_1.v.optional(values_1.v.string()),
        subtotal: values_1.v.number(),
        costoPersonasAdicionales: values_1.v.optional(values_1.v.number()),
        costoMascotas: values_1.v.optional(values_1.v.number()),
        costoPersonalServicio: values_1.v.optional(values_1.v.number()),
        depositoGarantia: values_1.v.optional(values_1.v.number()),
        depositoAseo: values_1.v.optional(values_1.v.number()),
        discountCode: values_1.v.optional(values_1.v.string()),
        discountAmount: values_1.v.optional(values_1.v.number()),
        precioTotal: values_1.v.number(),
        currency: values_1.v.optional(values_1.v.string()),
        temporada: values_1.v.string(),
        observaciones: values_1.v.optional(values_1.v.string()),
        city: values_1.v.optional(values_1.v.string()),
        address: values_1.v.optional(values_1.v.string()),
        isDirect: values_1.v.optional(values_1.v.boolean()),
        purpose: values_1.v.optional(values_1.v.string()),
        reference: values_1.v.optional(values_1.v.string()),
        googleEventId: values_1.v.optional(values_1.v.string()),
        googleCalendarId: values_1.v.optional(values_1.v.string()),
        horaEntrada: values_1.v.optional(values_1.v.string()),
        horaSalida: values_1.v.optional(values_1.v.string()),
        fechaCheckOut: values_1.v.optional(values_1.v.number()),
        status: values_1.v.optional(values_1.v.union(values_1.v.literal('PENDING'), values_1.v.literal('PENDING_PAYMENT'), values_1.v.literal('CONFIRMED'), values_1.v.literal('PAID'), values_1.v.literal('CANCELLED'), values_1.v.literal('COMPLETED'))),
        multimedia: values_1.v.optional(values_1.v.array(values_1.v.object({
            url: values_1.v.string(),
            name: values_1.v.string(),
            type: values_1.v.string(),
        }))),
    },
    handler: async (ctx, args) => {
        const now = Date.now();
        const availability = await ctx.runQuery(api_1.api.bookings.checkAvailability, {
            propertyId: args.propertyId,
            fechaEntrada: args.fechaEntrada,
            fechaSalida: args.fechaSalida,
        });
        if (!availability.available) {
            throw new Error('La propiedad no está disponible para las fechas seleccionadas');
        }
        let resolvedUserId;
        if (args.celular) {
            const contactByPhone = await ctx.db
                .query('contacts')
                .withIndex('by_phone', (q) => q.eq('phone', args.celular))
                .first();
            if (contactByPhone) {
                resolvedUserId = contactByPhone._id;
                await ctx.db.patch(resolvedUserId, {
                    name: args.nombreCompleto,
                    email: args.correo || contactByPhone.email,
                    cedula: args.cedula || contactByPhone.cedula,
                    city: args.city || contactByPhone.city,
                    lastReservationAt: now,
                    updatedAt: now,
                });
            }
            else if (args.correo) {
                const contactByEmail = await ctx.db
                    .query('contacts')
                    .filter((q) => q.eq(q.field('email'), args.correo))
                    .first();
                if (contactByEmail) {
                    resolvedUserId = contactByEmail._id;
                    await ctx.db.patch(resolvedUserId, {
                        name: args.nombreCompleto,
                        phone: args.celular || contactByEmail.phone,
                        cedula: args.cedula || contactByEmail.cedula,
                        city: args.city || contactByEmail.city,
                        lastReservationAt: now,
                        updatedAt: now,
                    });
                }
            }
            if (!resolvedUserId) {
                resolvedUserId = await ctx.db.insert('contacts', {
                    name: args.nombreCompleto,
                    phone: args.celular,
                    email: args.correo,
                    cedula: args.cedula,
                    city: args.city,
                    createdAt: now,
                    lastReservationAt: now,
                    updatedAt: now,
                });
            }
        }
        const bookingId = await ctx.db.insert('bookings', {
            propertyId: args.propertyId,
            userId: resolvedUserId,
            nombreCompleto: args.nombreCompleto,
            cedula: args.cedula,
            celular: args.celular,
            correo: args.correo,
            fechaEntrada: args.fechaEntrada,
            fechaSalida: args.fechaCheckOut || args.fechaSalida,
            numeroNoches: args.numeroNoches,
            numeroPersonas: args.numeroPersonas,
            personasAdicionales: args.personasAdicionales ?? 0,
            tieneMascotas: args.tieneMascotas ?? false,
            numeroMascotas: args.numeroMascotas ?? 0,
            detallesMascotas: args.detallesMascotas,
            subtotal: args.subtotal,
            costoPersonasAdicionales: args.costoPersonasAdicionales ?? 0,
            costoMascotas: args.costoMascotas ?? 0,
            costoPersonalServicio: args.costoPersonalServicio ?? 0,
            depositoGarantia: args.depositoGarantia ?? 300000,
            depositoAseo: args.depositoAseo ?? 90000,
            discountCode: args.discountCode,
            discountAmount: args.discountAmount ?? 0,
            precioTotal: args.precioTotal,
            currency: args.currency ?? 'COP',
            temporada: args.temporada,
            status: args.status ?? 'PENDING',
            paymentStatus: 'PENDING',
            reference: args.reference,
            observaciones: args.observaciones,
            city: args.city,
            purpose: args.purpose,
            googleEventId: args.googleEventId,
            googleCalendarId: args.googleCalendarId,
            horaSalida: args.horaSalida,
            address: args.address,
            multimedia: args.multimedia,
            isDirect: args.isDirect,
            createdAt: now,
            updatedAt: now,
        });
        await ctx.db.insert('propertyAvailability', {
            propertyId: args.propertyId,
            bookingId,
            fechaEntrada: args.fechaEntrada,
            fechaSalida: args.fechaSalida,
            blocked: true,
            reason: 'Reserva confirmada',
            googleEventId: args.googleEventId,
        });
        await ctx.scheduler.runAfter(0, api_1.internal.googleCalendar.syncBookingToCalendar, {
            bookingId,
        });
        return bookingId;
    },
});
exports.update = (0, server_1.mutation)({
    args: {
        id: values_1.v.id('bookings'),
        status: values_1.v.optional(values_1.v.union(values_1.v.literal('PENDING'), values_1.v.literal('PENDING_PAYMENT'), values_1.v.literal('CONFIRMED'), values_1.v.literal('PAID'), values_1.v.literal('CANCELLED'), values_1.v.literal('COMPLETED'))),
        paymentStatus: values_1.v.optional(values_1.v.union(values_1.v.literal('PENDING'), values_1.v.literal('PARTIAL'), values_1.v.literal('PAID'), values_1.v.literal('REFUNDED'))),
        observaciones: values_1.v.optional(values_1.v.string()),
        googleEventId: values_1.v.optional(values_1.v.string()),
        googleCalendarId: values_1.v.optional(values_1.v.string()),
        horaEntrada: values_1.v.optional(values_1.v.string()),
        horaSalida: values_1.v.optional(values_1.v.string()),
        isDirect: values_1.v.optional(values_1.v.boolean()),
    },
    handler: async (ctx, args) => {
        const { id, ...updates } = args;
        const booking = await ctx.db.get(id);
        if (!booking) {
            throw new Error('Reserva no encontrada');
        }
        await ctx.db.patch(id, {
            ...updates,
            updatedAt: Date.now(),
        });
        await ctx.scheduler.runAfter(0, api_1.internal.googleCalendar.syncBookingToCalendar, {
            bookingId: id,
        });
        return id;
    },
});
exports.cancel = (0, server_1.mutation)({
    args: {
        id: values_1.v.id('bookings'),
        reason: values_1.v.optional(values_1.v.string()),
    },
    handler: async (ctx, args) => {
        const booking = await ctx.db.get(args.id);
        if (!booking) {
            throw new Error('Reserva no encontrada');
        }
        await ctx.db.patch(args.id, {
            status: 'CANCELLED',
            updatedAt: Date.now(),
        });
        const availability = await ctx.db
            .query('propertyAvailability')
            .withIndex('by_booking', (q) => q.eq('bookingId', args.id))
            .collect();
        await Promise.all(availability.map((a) => ctx.db.delete(a._id)));
        if (booking.googleEventId) {
            await ctx.scheduler.runAfter(0, api_1.internal.googleCalendar.deleteBookingFromCalendar, {
                googleEventId: booking.googleEventId,
                googleCalendarId: booking.googleCalendarId,
            });
        }
        return { success: true };
    },
});
exports.createPayment = (0, server_1.mutation)({
    args: {
        bookingId: values_1.v.id('bookings'),
        type: values_1.v.union(values_1.v.literal('ABONO_50'), values_1.v.literal('SALDO_50'), values_1.v.literal('COMPLETO'), values_1.v.literal('REEMBOLSO')),
        amount: values_1.v.number(),
        currency: values_1.v.optional(values_1.v.string()),
        transactionId: values_1.v.optional(values_1.v.string()),
        reference: values_1.v.optional(values_1.v.string()),
        paymentMethod: values_1.v.optional(values_1.v.string()),
        checkoutUrl: values_1.v.optional(values_1.v.string()),
        status: values_1.v.optional(values_1.v.string()),
        wompiData: values_1.v.optional(values_1.v.any()),
    },
    handler: async (ctx, args) => {
        const now = Date.now();
        const paymentId = await ctx.db.insert('payments', {
            bookingId: args.bookingId,
            type: args.type,
            amount: args.amount,
            currency: args.currency ?? 'COP',
            transactionId: args.transactionId,
            reference: args.reference,
            paymentMethod: args.paymentMethod,
            checkoutUrl: args.checkoutUrl,
            status: args.status ?? 'pending',
            wompiData: args.wompiData,
            createdAt: now,
            updatedAt: now,
        });
        const booking = await ctx.db.get(args.bookingId);
        if (booking) {
            let paymentStatus = 'PENDING';
            const payments = await ctx.db
                .query('payments')
                .withIndex('by_booking', (q) => q.eq('bookingId', args.bookingId))
                .filter((q) => q.neq(q.field('status'), 'refunded'))
                .collect();
            const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
            if (totalPaid >= booking.precioTotal) {
                paymentStatus = 'PAID';
            }
            else if (totalPaid > 0) {
                paymentStatus = 'PARTIAL';
            }
            await ctx.db.patch(args.bookingId, {
                paymentStatus,
                updatedAt: now,
            });
        }
        return paymentId;
    },
});
exports.remove = (0, server_1.mutation)({
    args: { id: values_1.v.id('bookings') },
    handler: async (ctx, args) => {
        const booking = await ctx.db.get(args.id);
        if (!booking)
            return null;
        const payments = await ctx.db
            .query('payments')
            .withIndex('by_booking', (q) => q.eq('bookingId', args.id))
            .collect();
        for (const p of payments) {
            await ctx.db.delete(p._id);
        }
        const availability = await ctx.db
            .query('propertyAvailability')
            .withIndex('by_booking', (q) => q.eq('bookingId', args.id))
            .collect();
        for (const a of availability) {
            await ctx.db.delete(a._id);
        }
        if (booking.googleEventId) {
            await ctx.scheduler.runAfter(0, api_1.internal.googleCalendar.deleteBookingFromCalendar, {
                googleEventId: booking.googleEventId,
                googleCalendarId: booking.googleCalendarId,
            });
        }
        await ctx.db.delete(args.id);
        return booking;
    },
});
//# sourceMappingURL=bookings.js.map