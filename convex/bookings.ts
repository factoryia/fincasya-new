import { v } from 'convex/values';
import { query, mutation } from './_generated/server';
import { api, internal } from './_generated/api';

// ============ QUERIES ============

/**
 * Listar reservas con filtros
 */
export const list = query({
  args: {
    propertyId: v.optional(v.id('properties')),
    userId: v.optional(v.id('user')),
    status: v.optional(
      v.union(
        v.literal('PENDING'),
        v.literal('CONFIRMED'),
        v.literal('PAID'),
        v.literal('CANCELLED'),
        v.literal('COMPLETED'),
      ),
    ),
    limit: v.optional(v.number()),
    cursor: v.optional(v.id('bookings')),
    month: v.optional(v.string()),
    year: v.optional(v.string()),
    isDirect: v.optional(v.boolean()),
    userEmail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;

    // Aplicar filtros con índices y obtener todas las reservas
    const allBookings = args.propertyId
      ? await ctx.db
          .query('bookings')
          .withIndex('by_property', (q) => q.eq('propertyId', args.propertyId!))
          .collect()
      : args.status
        ? await ctx.db
            .query('bookings')
            .withIndex('by_status', (q) => q.eq('status', args.status!))
            .collect()
        : args.userId
          ? await ctx.db
              .query('bookings')
              .withIndex('by_user', (q) => q.eq('userId', args.userId as any))
              .collect()
          : args.isDirect !== undefined
            ? await ctx.db
                .query('bookings')
                .withIndex('by_is_direct', (q) =>
                  q.eq('isDirect', args.isDirect!),
                )
                .collect()
            : await ctx.db.query('bookings').collect();

    let filtered = allBookings;

    // Filtrar por mes y año si se proporcionan (rango de fechas)
    if (args.month && args.year) {
      const year = parseInt(args.year, 10);
      const month = parseInt(args.month, 10) - 1; // 0-based
      const startMs = new Date(year, month, 1).getTime();
      const endMs = new Date(year, month + 1, 0, 23, 59, 59, 999).getTime();

      filtered = filtered.filter(
        (b) => b.fechaEntrada <= endMs && b.fechaSalida >= startMs,
      );
    }

    if (args.isDirect !== undefined) {
      filtered = filtered.filter((b) => b.isDirect === args.isDirect);
    }

    if (args.userEmail !== undefined) {
      filtered = filtered.filter((b) => b.correo === args.userEmail);
    }

    // Aplicar cursor si existe (filtrar manualmente después de obtener los resultados)
    if (args.cursor) {
      filtered = filtered.filter((b) => b._id > args.cursor!);
    }

    // Ordenar por fecha de creación (más recientes primero)
    filtered = filtered.sort((a, b) => b.createdAt - a.createdAt);

    // Determinar si hay más resultados
    const hasMore = filtered.length > limit;
    const bookingsToReturn = hasMore ? filtered.slice(0, limit) : filtered;

    // Obtener detalles de la propiedad para cada reserva
    const bookingsWithDetails = await Promise.all(
      bookingsToReturn.map(async (booking: (typeof allBookings)[number]) => {
        const property = await ctx.db.get(booking.propertyId);
        let firstImage = null;
        if (property) {
          const images = await ctx.db
            .query('propertyImages')
            .withIndex('by_property', (q) => q.eq('propertyId', property._id))
            .collect();
          if (images.length > 0) {
            firstImage = images.sort(
              (a, b) => (a.order || 0) - (b.order || 0),
            )[0]?.url;
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
      }),
    );

    // Obtener el cursor para la siguiente página
    const nextCursor =
      hasMore && bookingsWithDetails.length > 0
        ? bookingsWithDetails[bookingsWithDetails.length - 1]._id
        : undefined;

    return {
      bookings: bookingsWithDetails,
      hasMore,
      nextCursor,
    };
  },
});

/**
 * Obtener reserva por ID
 */
export const getById = query({
  args: { id: v.id('bookings') },
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

/**
 * Obtener reservas por referencia
 */
export const getByReference = query({
  args: { reference: v.string() },
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

/**
 * Verificar disponibilidad de una propiedad
 */
export const checkAvailability = query({
  args: {
    propertyId: v.id('properties'),
    fechaEntrada: v.number(),
    fechaSalida: v.number(),
  },
  handler: async (ctx, args) => {
    // Buscar reservas que se solapen con las fechas solicitadas
    const conflictingBookings = await ctx.db
      .query('bookings')
      .withIndex('by_property', (q) => q.eq('propertyId', args.propertyId))
      .filter((q) =>
        q.or(
          // La nueva fecha de entrada cae dentro de una reserva existente (incluyendo el día de salida)
          q.and(
            q.lte(q.field('fechaEntrada'), args.fechaEntrada),
            q.gte(q.field('fechaSalida'), args.fechaEntrada),
          ),
          // La nueva fecha de salida cae dentro de una reserva existente (incluyendo el día de entrada)
          q.and(
            q.lte(q.field('fechaEntrada'), args.fechaSalida),
            q.gte(q.field('fechaSalida'), args.fechaSalida),
          ),
          // Una reserva existente está completamente contenida en el nuevo rango
          q.and(
            q.gte(q.field('fechaEntrada'), args.fechaEntrada),
            q.lte(q.field('fechaSalida'), args.fechaSalida),
          ),
        ),
      )
      .filter((q) => q.neq(q.field('status'), 'CANCELLED'))
      .collect();

    return {
      available: conflictingBookings.length === 0,
      conflictingBookings: conflictingBookings.map((b) => ({
        id: b._id,
        fechaEntrada: b.fechaEntrada,
        fechaSalida: b.fechaSalida,
        status: b.status,
        nombreCompleto: b.nombreCompleto,
        cedula: b.cedula,
        celular: b.celular,
      })),
    };
  },
});

// ============ MUTATIONS ============

/**
 * Crear una nueva reserva
 */
export const create = mutation({
  args: {
    propertyId: v.id('properties'),
    userId: v.optional(v.string()),
    nombreCompleto: v.string(),
    cedula: v.string(),
    celular: v.string(),
    correo: v.string(),
    fechaEntrada: v.number(),
    fechaSalida: v.number(),
    numeroNoches: v.number(),
    numeroPersonas: v.number(),
    personasAdicionales: v.optional(v.number()),
    tieneMascotas: v.optional(v.boolean()),
    numeroMascotas: v.optional(v.number()),
    detallesMascotas: v.optional(v.string()),
    subtotal: v.number(),
    costoPersonasAdicionales: v.optional(v.number()),
    costoMascotas: v.optional(v.number()),
    depositoMascotas: v.optional(v.number()),
    sobrecargoMascotas: v.optional(v.number()),
    costoPersonalServicio: v.optional(v.number()),
    depositoGarantia: v.optional(v.number()),
    depositoAseo: v.optional(v.number()),
    discountCode: v.optional(v.string()),
    discountAmount: v.optional(v.number()),
    precioTotal: v.number(),
    currency: v.optional(v.string()),
    temporada: v.string(),
    observaciones: v.optional(v.string()),
    city: v.optional(v.string()),
    address: v.optional(v.string()),
    isDirect: v.optional(v.boolean()),
    userEmail: v.optional(v.string()),
    purpose: v.optional(v.string()),
    reference: v.optional(v.string()),
    googleEventId: v.optional(v.string()),
    googleCalendarId: v.optional(v.string()),
    horaEntrada: v.optional(v.string()), // "15:00"
    horaSalida: v.optional(v.string()), // "11:00"
    fechaCheckOut: v.optional(v.number()), // Para compatibilidad con nombres de UI
    status: v.optional(
      v.union(
        v.literal('PENDING'),
        v.literal('PENDING_PAYMENT'),
        v.literal('CONFIRMED'),
        v.literal('PAID'),
        v.literal('CANCELLED'),
        v.literal('COMPLETED'),
      ),
    ),
    multimedia: v.optional(
      v.array(
        v.object({
          url: v.string(),
          name: v.string(),
          type: v.string(),
        }),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Verificar disponibilidad antes de crear
    const availability = await ctx.runQuery(api.bookings.checkAvailability, {
      propertyId: args.propertyId,
      fechaEntrada: args.fechaEntrada,
      fechaSalida: args.fechaSalida,
    });

    if (!availability.available) {
      throw new Error(
        'La propiedad no está disponible para las fechas seleccionadas',
      );
    }

    let resolvedUserId: any | undefined;

    // Crear/Enlazar cliente (Contacto CRM)
    if (args.celular) {
      // Buscar por celular
      const contactByPhone = await ctx.db
        .query('contacts')
        .withIndex('by_phone', (q) => q.eq('phone', args.celular))
        .first();

      if (contactByPhone) {
        resolvedUserId = contactByPhone._id;
        // Actualizar datos del contacto existente
        await ctx.db.patch(resolvedUserId, {
          name: args.nombreCompleto,
          email: args.correo || contactByPhone.email,
          cedula: args.cedula || contactByPhone.cedula,
          city: args.city || contactByPhone.city,
          lastReservationAt: now,
          updatedAt: now,
        });
      } else if (args.correo) {
        // Buscar por email
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

      // Si no existe de ninguna forma, crearlo
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
      userId: resolvedUserId as any,
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
      depositoMascotas: args.depositoMascotas ?? 0,
      sobrecargoMascotas: args.sobrecargoMascotas ?? 0,
      costoPersonalServicio: args.costoPersonalServicio ?? 0,
      depositoGarantia: args.depositoGarantia ?? 0,
      depositoAseo: args.depositoAseo ?? 0,
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

    // Crear bloque de disponibilidad
    await ctx.db.insert('propertyAvailability', {
      propertyId: args.propertyId,
      bookingId,
      fechaEntrada: args.fechaEntrada,
      fechaSalida: args.fechaSalida,
      blocked: true,
      reason: 'Reserva confirmada',
      googleEventId: args.googleEventId,
    });

    // Sincronizar con Google Calendar en segundo plano
    await ctx.scheduler.runAfter(
      0,
      internal.googleCalendar.syncBookingToCalendar,
      {
        bookingId,
      },
    );

    return bookingId;
  },
});

/**
 * Actualizar una reserva
 */
export const update = mutation({
  args: {
    id: v.id('bookings'),
    status: v.optional(
      v.union(
        v.literal('PENDING'),
        v.literal('PENDING_PAYMENT'),
        v.literal('CONFIRMED'),
        v.literal('PAID'),
        v.literal('CANCELLED'),
        v.literal('COMPLETED'),
      ),
    ),
    paymentStatus: v.optional(
      v.union(
        v.literal('PENDING'),
        v.literal('PARTIAL'),
        v.literal('PAID'),
        v.literal('REFUNDED'),
      ),
    ),
    observaciones: v.optional(v.string()),
    googleEventId: v.optional(v.string()),
    googleCalendarId: v.optional(v.string()),
    horaEntrada: v.optional(v.string()),
    horaSalida: v.optional(v.string()),
    isDirect: v.optional(v.boolean()),
    userEmail: v.optional(v.string()),
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

    // Sincronizar cambios con Google Calendar
    await ctx.scheduler.runAfter(
      0,
      internal.googleCalendar.syncBookingToCalendar,
      {
        bookingId: id,
      },
    );

    return id;
  },
});

/**
 * Cancelar una reserva
 */
export const cancel = mutation({
  args: {
    id: v.id('bookings'),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const booking = await ctx.db.get(args.id);

    if (!booking) {
      throw new Error('Reserva no encontrada');
    }

    // Actualizar estado de la reserva
    await ctx.db.patch(args.id, {
      status: 'CANCELLED',
      updatedAt: Date.now(),
    });

    // Eliminar bloque de disponibilidad
    const availability = await ctx.db
      .query('propertyAvailability')
      .withIndex('by_booking', (q) => q.eq('bookingId', args.id))
      .collect();

    await Promise.all(availability.map((a) => ctx.db.delete(a._id)));

    // Eliminar de Google Calendar si existe
    if (booking.googleEventId) {
      await ctx.scheduler.runAfter(
        0,
        internal.googleCalendar.deleteBookingFromCalendar,
        {
          googleEventId: booking.googleEventId,
          googleCalendarId: booking.googleCalendarId,
        },
      );
    }

    return { success: true };
  },
});

/**
 * Crear un pago
 */
export const createPayment = mutation({
  args: {
    bookingId: v.id('bookings'),
    type: v.union(
      v.literal('ABONO_50'),
      v.literal('SALDO_50'),
      v.literal('COMPLETO'),
      v.literal('REEMBOLSO'),
    ),
    amount: v.number(),
    currency: v.optional(v.string()),
    transactionId: v.optional(v.string()),
    reference: v.optional(v.string()),
    paymentMethod: v.optional(v.string()),
    checkoutUrl: v.optional(v.string()),
    status: v.optional(v.string()),
    wompiData: v.optional(v.any()),
    boldData: v.optional(v.any()),
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
      boldData: args.boldData,
      createdAt: now,
      updatedAt: now,
    });

    // Actualizar estado de pago de la reserva si es necesario
    const booking = await ctx.db.get(args.bookingId);
    if (booking) {
      let paymentStatus: 'PENDING' | 'PARTIAL' | 'PAID' | 'REFUNDED' =
        'PENDING';

      // Calcular total pagado
      const payments = await ctx.db
        .query('payments')
        .withIndex('by_booking', (q) => q.eq('bookingId', args.bookingId))
        .filter((q) => q.neq(q.field('status'), 'refunded'))
        .collect();

      const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);

      if (totalPaid >= booking.precioTotal) {
        paymentStatus = 'PAID';
      } else if (totalPaid > 0) {
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

/**
 * Eliminar una reserva y sus pagos
 */
export const remove = mutation({
  args: { id: v.id('bookings') },
  handler: async (ctx, args) => {
    const booking = await ctx.db.get(args.id);
    if (!booking) return null;

    const payments = await ctx.db
      .query('payments')
      .withIndex('by_booking', (q) => q.eq('bookingId', args.id))
      .collect();

    for (const p of payments) {
      await ctx.db.delete(p._id);
    }

    // Eliminar bloque de disponibilidad
    const availability = await ctx.db
      .query('propertyAvailability')
      .withIndex('by_booking', (q) => q.eq('bookingId', args.id))
      .collect();

    for (const a of availability) {
      await ctx.db.delete(a._id);
    }

    // Eliminar de Google Calendar si existe (background worker)
    if (booking.googleEventId) {
      await ctx.scheduler.runAfter(
        0,
        internal.googleCalendar.deleteBookingFromCalendar,
        {
          googleEventId: booking.googleEventId,
          googleCalendarId: booking.googleCalendarId,
        },
      );
    }

    await ctx.db.delete(args.id);
    return booking;
  },
});


export const appendMultimedia = mutation({
  args: {
    bookingId: v.id('bookings'),
    file: v.object({
      url: v.string(),
      name: v.string(),
      type: v.string(),
      size: v.optional(v.number()),
      uploadedAt: v.optional(v.number())
    })
  },
  handler: async (ctx, args) => {
    const booking = await ctx.db.get(args.bookingId);
    if (!booking) throw new Error('Reserva no encontrada');
    
    const multimedia = booking.multimedia || [];
    multimedia.push(args.file as any);
    
    await ctx.db.patch(args.bookingId, { multimedia });
    return true;
  }
});


export const removeMultimedia = mutation({
  args: {
    bookingId: v.id('bookings'),
    url: v.string(),
  },
  handler: async (ctx, args) => {
    const booking = await ctx.db.get(args.bookingId);
    if (!booking) throw new Error('Reserva no encontrada');

    const multimedia = (booking.multimedia || []).filter((m: any) => m.url !== args.url);

    await ctx.db.patch(args.bookingId, { multimedia });
    return true;
  },
});

