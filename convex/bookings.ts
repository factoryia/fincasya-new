import { v } from 'convex/values';
import { query, mutation, internalQuery } from './_generated/server';
import { api, internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import { normalizeContractLookupQueryConvex } from './lib/contractLookup';
import {
  deriveBookingPaymentStatus,
  netPaidFromPayments,
  pendingFromTotal,
} from './lib/bookingPayments';

/** Fecha calendario YYYY-MM-DD en hora de Colombia (negocio). */
function calendarDateColombia(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
  }).format(new Date(ms));
}

function todayColombia(): string {
  return calendarDateColombia(Date.now());
}

/**
 * Impide reservas con entrada o salida ya pasadas (calendario Colombia) o rango inválido.
 */
function assertBookingDatesAreFuture(args: {
  fechaEntrada: number;
  fechaSalida: number;
  fechaCheckOut?: number;
}): void {
  if (
    !Number.isFinite(args.fechaEntrada) ||
    !Number.isFinite(args.fechaSalida)
  ) {
    throw new Error('Las fechas de la reserva no son válidas.');
  }
  const salidaEfectiva = args.fechaCheckOut ?? args.fechaSalida;
  if (!Number.isFinite(salidaEfectiva)) {
    throw new Error('La fecha de salida no es válida.');
  }
  if (salidaEfectiva <= args.fechaEntrada) {
    throw new Error(
      'La fecha de salida debe ser posterior a la fecha de entrada.',
    );
  }
  const today = todayColombia();
  const diaEntrada = calendarDateColombia(args.fechaEntrada);
  const diaSalida = calendarDateColombia(salidaEfectiva);
  // No se permite check-in hoy ni en pasado — mínimo mañana.
  if (diaEntrada <= today) {
    throw new Error(
      'La fecha de entrada debe ser a partir de mañana (no se acepta ingreso el mismo día, hora Colombia).',
    );
  }
  if (diaSalida < today) {
    throw new Error(
      'La fecha de salida no puede ser anterior a hoy (hora Colombia).',
    );
  }
}

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
                  q.eq('isDirect', args.isDirect),
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
 * Contar todas las reservas existentes para generación de IDs secuenciales
 */
export const countAll = query({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query('bookings').collect();
    return all.length;
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

/**
 * Rangos de fechas ocupadas para deshabilitar en el calendario público.
 * Usa la misma fuente que checkAvailability (reservas no canceladas).
 */
export const getBlockedDateRanges = query({
  args: {
    propertyId: v.id('properties'),
    monthsAhead: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const months = args.monthsAhead ?? 12;
    const futureLimit = now + months * 30 * 24 * 60 * 60 * 1000;

    const bookings = await ctx.db
      .query('bookings')
      .withIndex('by_property', (q) => q.eq('propertyId', args.propertyId))
      .filter((q) => q.neq(q.field('status'), 'CANCELLED'))
      .collect();

    return bookings
      .filter((b) => b.fechaSalida > now && b.fechaEntrada < futureLimit)
      .map((b) => ({
        fechaEntrada: b.fechaEntrada,
        fechaSalida: b.fechaSalida,
      }));
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
    groupType: v.optional(v.string()),
    isEvento: v.optional(v.boolean()),
    detallesEvento: v.optional(
      v.union(
        v.null(),
        v.object({
          extraSound: v.optional(v.string()),
          liveMusic: v.optional(v.string()),
          dj: v.optional(v.string()),
          decoration: v.optional(v.string()),
          additionalGuests: v.optional(v.string()),
        }),
      )
    ),
    reference: v.optional(v.string()),
    googleEventId: v.optional(v.string()),
    googleCalendarId: v.optional(v.string()),
    /** Código/etiqueta que reemplaza "Reserva:" en el título del evento. */
    calendarLabel: v.optional(v.string()),
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

    assertBookingDatesAreFuture({
      fechaEntrada: args.fechaEntrada,
      fechaSalida: args.fechaSalida,
      fechaCheckOut: args.fechaCheckOut,
    });

    const salidaParaDisponibilidad = args.fechaCheckOut ?? args.fechaSalida;

    // Verificar disponibilidad antes de crear
    const availability = await ctx.runQuery(api.bookings.checkAvailability, {
      propertyId: args.propertyId,
      fechaEntrada: args.fechaEntrada,
      fechaSalida: salidaParaDisponibilidad,
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
          crmType: 'client',
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
            crmType: 'client',
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
          crmType: 'client',
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
      groupType: args.groupType,
      isEvento: args.isEvento,
      detallesEvento: args.detallesEvento,
      googleEventId: args.googleEventId,
      googleCalendarId: args.googleCalendarId,
      calendarLabel: args.calendarLabel,
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
      fechaSalida: salidaParaDisponibilidad,
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

/** Pagos de una reserva (admin / detalle de reserva). */
export const getPaymentsByBooking = query({
  args: { bookingId: v.id('bookings') },
  handler: async (ctx, args) => {
    const booking = await ctx.db.get(args.bookingId);
    if (!booking) return null;

    const payments = await ctx.db
      .query('payments')
      .withIndex('by_booking', (q) => q.eq('bookingId', args.bookingId))
      .collect();

    payments.sort((a, b) => b.createdAt - a.createdAt);

    const netPaid = netPaidFromPayments(payments);
    const pending = pendingFromTotal(booking.precioTotal, netPaid);

    return {
      bookingId: booking._id,
      precioTotal: booking.precioTotal,
      paymentStatus: booking.paymentStatus,
      netPaid,
      pending,
      payments,
    };
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
    notes: v.optional(v.string()),
    wompiData: v.optional(v.any()),
    boldData: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const amount = Math.max(0, Math.floor(Number(args.amount) || 0));
    if (amount <= 0) {
      throw new Error('El monto del pago debe ser mayor a cero.');
    }

    const paymentId = await ctx.db.insert('payments', {
      bookingId: args.bookingId,
      type: args.type,
      amount,
      currency: args.currency ?? 'COP',
      transactionId: args.transactionId,
      reference: args.reference,
      paymentMethod: args.paymentMethod,
      checkoutUrl: args.checkoutUrl,
      status: args.status ?? 'PAID',
      notes: args.notes?.trim() || undefined,
      wompiData: args.wompiData,
      boldData: args.boldData,
      createdAt: now,
      updatedAt: now,
    });

    const booking = await ctx.db.get(args.bookingId);
    if (booking) {
      const payments = await ctx.db
        .query('payments')
        .withIndex('by_booking', (q) => q.eq('bookingId', args.bookingId))
        .collect();

      const netPaid = netPaidFromPayments(payments);
      const paymentStatus = deriveBookingPaymentStatus(
        booking.precioTotal,
        netPaid,
      );

      await ctx.db.patch(args.bookingId, {
        paymentStatus,
        updatedAt: now,
        ...(paymentStatus === 'PAID' && booking.status !== 'CANCELLED'
          ? { status: 'PAID' as const }
          : {}),
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

/**
 * Listar reservas que necesitan recordatorio (3 días antes)
 */
export const listForReminders = query({
  args: {
    minDate: v.number(),
    maxDate: v.number(),
  },
  handler: async (ctx, args) => {
    const bookings = await ctx.db
      .query('bookings')
      .withIndex('by_dates', (q) =>
        q.gte('fechaEntrada', args.minDate).lte('fechaEntrada', args.maxDate),
      )
      .filter((q) =>
        q.and(
          q.or(
            q.eq(q.field('status'), 'CONFIRMED'),
            q.eq(q.field('status'), 'PAID'),
          ),
          q.neq(q.field('reminderSent'), true),
        ),
      )
      .collect();

    // Enriquecer con título de propiedad
    return await Promise.all(
      bookings.map(async (b) => {
        const property = await ctx.db.get(b.propertyId);
        return {
          ...b,
          propertyTitle: property?.title || 'tu propiedad',
        };
      }),
    );
  },
});

/**
 * Marcar recordatorio como enviado
 */
export const markReminderSent = mutation({
  args: { id: v.id('bookings') },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      reminderSent: true,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Busca una reserva por número de contrato.
 * Coincidencias: texto en `observaciones` (p. ej. "Contrato: FY-2005"), `reference`, sin depender
 * solo de reservas "directas" ni de mayúsculas.
 */
export const getByContractNumber = query({
  args: { contractNumber: v.string() },
  handler: async (ctx, args) => {
    const raw = args.contractNumber.trim();
    if (!raw) return null;

    const normalized = normalizeContractLookupQueryConvex(raw);
    const needle = normalized.toLowerCase();
    const withoutContratoPrefix = normalized
      .replace(/^\s*contrato\s*:\s*/i, '')
      .trim()
      .toLowerCase();

    const enrich = async (match: Doc<'bookings'>) => {
      const property = match.propertyId
        ? await ctx.db.get(match.propertyId)
        : null;
      return {
        ...match,
        propertyTitle: (property as any)?.title ?? '',
        propertyLocation: (property as any)?.location ?? '',
      };
    };

    // Búsqueda rápida por índice (nuevo: reference = número de contrato al crear desde admin)
    const refCandidates = [...new Set([raw, normalized].filter((x) => x.length > 0))];
    for (const c of refCandidates) {
      const byRef = await ctx.db
        .query('bookings')
        .withIndex('by_reference', (q) => q.eq('reference', c))
        .first();
      if (byRef) {
        return await enrich(byRef);
      }
    }

    const all = await ctx.db.query('bookings').collect();
    const sorted = [...all].sort(
      (a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0),
    );
    const bookings = sorted.slice(0, 5000);

    const matches = (b: (typeof bookings)[number]) => {
      const obs = (b.observaciones ?? '').toLowerCase();
      const ref = (b.reference ?? '').toLowerCase();
      if (needle && obs.includes(needle)) return true;
      if (
        withoutContratoPrefix &&
        withoutContratoPrefix !== needle &&
        obs.includes(withoutContratoPrefix)
      )
        return true;
      if (needle && ref && (ref === needle || ref.includes(needle))) return true;
      const m = obs.match(/contrato\s*:\s*([^\s\n\r]+)/i);
      if (m && m[1].toLowerCase() === needle) return true;
      const rawLower = raw.toLowerCase();
      if (rawLower !== needle && obs.includes(rawLower)) return true;
      return false;
    };

    const match = bookings.find(matches);

    if (!match) return null;

    return await enrich(match);
  },
});

/**
 * ¿Este teléfono tiene una reserva VIGENTE o POR VENIR?
 *
 * Lo usa el bot (`processInboundMessageV2`) para que, cuando un cliente con
 * reserva activa o futura escriba, escale DE INMEDIATO a un asesor — su caso
 * es OPERATIVO (preguntas sobre la estadía, llegada, problemas), no
 * comercial. No debe pasar por el flujo de cotización del bot.
 *
 * Reglas:
 * - Match por `celular` normalizado a los ÚLTIMOS 10 DÍGITOS (cel móvil
 *   colombiano son 10 dígitos; así toleramos +57, espacios, paréntesis,
 *   guiones, sin importar el formato con que se guardó el booking).
 * - "Vigente o por venir" = status ∉ {CANCELLED, COMPLETED} **Y**
 *   fechaSalida ≥ ahora.
 * - Si hay varias coincidencias, devuelve la de `fechaEntrada` MÁS CERCANA
 *   a hoy (la más relevante para la atención).
 * - Devuelve `null` si no hay match (el bot sigue su flujo comercial normal).
 *
 * Performance: 4 queries indexadas (`by_status` para cada estado activo),
 * cada una filtra `fechaSalida >= now` antes de leer documentos. Aunque haya
 * miles de bookings históricos, solo se escanean los actualmente "vivos".
 */
export const findActiveOrUpcomingByGuestPhone = internalQuery({
  args: { phone: v.string() },
  handler: async (ctx, { phone }) => {
    const target = phone.replace(/\D/g, '').slice(-10);
    if (target.length < 7) return null;
    const now = Date.now();

    const ACTIVE_STATUSES = [
      'PENDING',
      'PENDING_PAYMENT',
      'CONFIRMED',
      'PAID',
    ] as const;

    const matches: Doc<'bookings'>[] = [];
    for (const status of ACTIVE_STATUSES) {
      const rows = await ctx.db
        .query('bookings')
        .withIndex('by_status', (q) => q.eq('status', status))
        .filter((q) => q.gte(q.field('fechaSalida'), now))
        .collect();
      for (const r of rows) {
        const c = String(r.celular ?? '').replace(/\D/g, '').slice(-10);
        if (c.length >= 7 && c === target) matches.push(r);
      }
    }
    if (matches.length === 0) return null;
    matches.sort(
      (a, b) =>
        Math.abs(a.fechaEntrada - now) - Math.abs(b.fechaEntrada - now),
    );
    return matches[0];
  },
});
