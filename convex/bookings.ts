import { v } from 'convex/values';
import { query, mutation, internalQuery, internalMutation } from './_generated/server';
import { api, internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { normalizeContractLookupQueryConvex } from './lib/contractLookup';
import {
  deriveBookingPaymentStatus,
  netPaidFromPayments,
  pendingFromTotal,
} from './lib/bookingPayments';
import { resolveOwnerContactFields } from './lib/ownerSalutation';
import {
  buildOwnerPayoutFromAbonos,
  normalizeOwnerAbonos,
  sumOwnerAbonos,
  type OwnerPayoutRecord,
} from './lib/ownerPayout';
import { resolveRefundableDeposit } from './lib/bookingDeposit';
import { resolveSaleLinkReference } from './lib/saleLinkReference';

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

    // Filtrar por año (vista meses del calendario admin)
    if (args.year && !args.month) {
      const year = parseInt(args.year, 10);
      const startMs = new Date(year, 0, 1).getTime();
      const endMs = new Date(year, 11, 31, 23, 59, 59, 999).getTime();

      filtered = filtered.filter(
        (b) => b.fechaEntrada <= endMs && b.fechaSalida >= startMs,
      );
    } else if (args.month && args.year) {
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
        let ownerContact: {
          propietarioNombre?: string;
          propietarioTelefono?: string;
          propietarioTratamiento?: string;
        } = {};
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
          ownerContact = await resolveOwnerContactFields(
            ctx,
            property._id,
            property as Record<string, unknown>,
          );
        }

        return {
          ...booking,
          property: property
            ? {
                id: property._id,
                title: property.title,
                location: property.location,
                image: firstImage,
                propietarioNombre: ownerContact.propietarioNombre ?? null,
                propietarioTelefono: ownerContact.propietarioTelefono ?? null,
                propietarioTratamiento:
                  ownerContact.propietarioTratamiento ?? null,
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

/** Datos para reportes admin (reservas y pagos al propietario). */
export const listForReports = query({
  args: {
    propertyId: v.optional(v.id('properties')),
    dateFrom: v.optional(v.number()),
    dateTo: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const allBookings = args.propertyId
      ? await ctx.db
          .query('bookings')
          .withIndex('by_property', (q) => q.eq('propertyId', args.propertyId!))
          .collect()
      : await ctx.db.query('bookings').collect();

    let filtered = allBookings.filter((b) => b.status !== 'CANCELLED');

    if (args.dateFrom != null) {
      filtered = filtered.filter((b) => b.fechaEntrada >= args.dateFrom!);
    }
    if (args.dateTo != null) {
      filtered = filtered.filter((b) => b.fechaEntrada <= args.dateTo!);
    }

    filtered.sort((a, b) => b.fechaEntrada - a.fechaEntrada);

    const rows = await Promise.all(
      filtered.map(async (booking) => {
        const property = await ctx.db.get(booking.propertyId);
        let propietarioNombre: string | null = null;
        if (property) {
          const ownerContact = await resolveOwnerContactFields(
            ctx,
            property._id,
            property as Record<string, unknown>,
          );
          propietarioNombre = ownerContact.propietarioNombre ?? null;
        }

        const payments = await ctx.db
          .query('payments')
          .withIndex('by_booking', (q) => q.eq('bookingId', booking._id))
          .collect();
        const turistaPagado = netPaidFromPayments(payments);

        const adjustments = Array.isArray(booking.economicAdjustments)
          ? booking.economicAdjustments
          : [];
        const adjustmentsNet = adjustments.reduce((sum, item) => {
          const amt = Number(item.amount) || 0;
          return item.type === 'INCREMENT' ? sum + amt : sum - amt;
        }, 0);
        const descuentos =
          (Number(booking.discountAmount) || 0) +
          adjustments
            .filter((item) => item.type === 'DISCOUNT')
            .reduce((sum, item) => sum + (Number(item.amount) || 0), 0);

        const valorAlquiler = Number(booking.subtotal) || 0;
        const valorNetoAlquiler =
          valorAlquiler +
          (Number(booking.costoPersonasAdicionales) || 0) +
          (Number(booking.costoMascotas) || 0) +
          (Number(booking.costoPersonalServicio) || 0) +
          adjustmentsNet -
          (Number(booking.discountAmount) || 0);

        const deposito = resolveRefundableDeposit(
          booking,
          Math.max(0, valorNetoAlquiler),
          (property as { depositoDanosReembolsable?: number } | null)
            ?.depositoDanosReembolsable,
        );
        const aseo = Number(booking.depositoAseo) || 0;
        const ownerPayout = (booking.ownerPayout ?? null) as OwnerPayoutRecord | null;
        const valorOfertaPropietario = Number(ownerPayout?.valorAcordado) || 0;
        const abonosProp = ownerPayout
          ? normalizeOwnerAbonos(ownerPayout, String(booking._id))
          : [];
        const propietarioPagado = sumOwnerAbonos(abonosProp);
        const ganancia = Math.max(0, Math.max(0, valorNetoAlquiler) - valorOfertaPropietario);
        const invitadosRegistrados = Array.isArray(booking.checkinGuests)
          ? booking.checkinGuests.length
          : 0;

        const paidPayments = payments
          .filter((p) => String(p.status ?? '').toUpperCase() === 'PAID')
          .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
        const latestPaid = paidPayments[0];
        const banco = latestPaid?.paymentMethod?.trim() || '';
        const monto =
          turistaPagado > 0
            ? turistaPagado
            : Number(latestPaid?.amount) || booking.precioTotal;

        return {
          id: booking._id,
          propertyId: booking.propertyId,
          reference: booking.reference ?? null,
          propertyTitle: property?.title ?? '',
          propietarioNombre,
          numeroPersonas: booking.numeroPersonas,
          invitadosRegistrados,
          valorAlquiler,
          descuentos,
          valorNetoAlquiler: Math.max(0, valorNetoAlquiler),
          deposito,
          aseo,
          precioTotal: booking.precioTotal,
          turistaPagado,
          turistaPendiente: pendingFromTotal(booking.precioTotal, turistaPagado),
          valorOfertaPropietario,
          propietarioPagado,
          ganancia,
          netoAlquiler: Math.max(0, valorNetoAlquiler),
          fechaEntrada: booking.fechaEntrada,
          fechaSalida: booking.fechaSalida,
          status: booking.status,
          paymentStatus: booking.paymentStatus,
          clienteNombre: booking.nombreCompleto,
          checkinCompleted: Boolean(booking.checkinCompleted),
          ownerPayout: booking.ownerPayout ?? null,
          reconciliationSheet: booking.reconciliationSheet ?? null,
          banco,
          monto,
        };
      }),
    );

    return { rows, total: rows.length };
  },
});

/** Guarda casillas del cuadro de rendimientos (admin). */
export const saveReconciliationSheet = mutation({
  args: {
    id: v.id('bookings'),
    turistaPago: v.optional(v.union(v.boolean(), v.null())),
    turistaLlego: v.optional(v.union(v.boolean(), v.null())),
    propietarioPago: v.optional(v.union(v.boolean(), v.null())),
    checkinListo: v.optional(v.union(v.boolean(), v.null())),
    notas: v.optional(v.string()),
    updatedBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const booking = await ctx.db.get(args.id);
    if (!booking) throw new Error('Reserva no encontrada');
    const prev = { ...(booking.reconciliationSheet ?? {}) };
    const ts = Date.now();

    const apply = (key: keyof typeof prev, value: boolean | null | undefined) => {
      if (value === undefined) return;
      if (value === null) {
        delete prev[key];
        return;
      }
      (prev as Record<string, unknown>)[key] = value;
    };

    apply('turistaPago', args.turistaPago);
    apply('turistaLlego', args.turistaLlego);
    apply('propietarioPago', args.propietarioPago);
    apply('checkinListo', args.checkinListo);
    if (args.notas !== undefined) {
      prev.notas = args.notas.trim() || undefined;
      if (!prev.notas) delete prev.notas;
    }
    prev.updatedAt = ts;
    prev.updatedBy = (args.updatedBy ?? '').trim() || prev.updatedBy;

    await ctx.db.patch(args.id, {
      reconciliationSheet: prev,
      updatedAt: ts,
    });
    return { ok: true as const, reconciliationSheet: prev };
  },
});

/**
 * Marca como revisados (approved) los soportes de pago pendientes de una reserva.
 * Al no quedar 'pending', la reserva sale del color naranja del semáforo.
 */
export const markPaymentReceiptsReviewed = mutation({
  args: { bookingId: v.id('bookings') },
  handler: async (ctx, args) => {
    const booking = await ctx.db.get(args.bookingId);
    if (!booking) return { ok: false as const, reason: 'not_found' };
    const receipts = booking.paymentPortalReceipts ?? [];
    let updated = 0;
    const next = receipts.map((r) => {
      if (r.status === 'pending') {
        updated++;
        return { ...r, status: 'approved' as const };
      }
      return r;
    });
    if (updated > 0) {
      await ctx.db.patch(args.bookingId, {
        paymentPortalReceipts: next,
        hasPendingReceipt: next.some((r) => r.status === 'pending'),
        updatedAt: Date.now(),
      });
    }
    return { ok: true as const, updated };
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

    let saleLink = booking.saleLinkId
      ? await ctx.db.get(booking.saleLinkId)
      : await ctx.db
          .query('saleLinks')
          .withIndex('by_booking', (q) => q.eq('bookingId', booking._id))
          .first();

    const clientPaidAbono = payments
      .filter((p) => String(p.status ?? '').toUpperCase() === 'PAID')
      .reduce((sum, p) => sum + Math.max(0, Math.floor(Number(p.amount) || 0)), 0);

    // Respaldo de datos del propietario desde propertyOwnerInfo (para el saludo
    // Sr/Sra y el teléfono en /anfitrion y el mensaje al propietario).
    let propertyEnriched = property as any;
    if (property) {
      const ownerContact = await resolveOwnerContactFields(
        ctx,
        property._id,
        property as Record<string, unknown>,
      );
      propertyEnriched = {
        ...(property as object),
        ...ownerContact,
      };
    }

    return {
      ...booking,
      property: propertyEnriched,
      payments,
      saleLink: saleLink ?? null,
      clientPaidAbono,
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
    excludeBookingId: v.optional(v.id('bookings')),
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

    const filtered = args.excludeBookingId
      ? conflictingBookings.filter((b) => b._id !== args.excludeBookingId)
      : conflictingBookings;

    return {
      available: filtered.length === 0,
      conflictingBookings: filtered.map((b) => ({
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
    issueDate: v.optional(v.string()),
    economicAdjustments: v.optional(
      v.array(
        v.object({
          id: v.string(),
          date: v.string(),
          description: v.string(),
          amount: v.number(),
          type: v.union(v.literal('INCREMENT'), v.literal('DISCOUNT')),
          createdBy: v.optional(v.string()),
          createdAt: v.number(),
        }),
      ),
    ),
    precioTotal: v.number(),
    currency: v.optional(v.string()),
    temporada: v.string(),
    observaciones: v.optional(v.string()),
    city: v.optional(v.string()),
    address: v.optional(v.string()),
    fechaNacimiento: v.optional(v.string()),
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

    const fechaNacimiento = (() => {
      const raw = args.fechaNacimiento?.trim();
      if (!raw) return undefined;
      return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : undefined;
    })();

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
          ...(fechaNacimiento ? { fechaNacimiento } : {}),
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
            ...(fechaNacimiento ? { fechaNacimiento } : {}),
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
          fechaNacimiento,
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
      issueDate: args.issueDate,
      economicAdjustments: args.economicAdjustments,
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
 * Actualización completa de reserva (admin). Permite cambiar finca, fechas,
 * huésped, precios y observaciones. Excluye la reserva actual al validar cupo.
 */
export const adminUpdate = mutation({
  args: {
    id: v.id('bookings'),
    propertyId: v.optional(v.id('properties')),
    nombreCompleto: v.optional(v.string()),
    cedula: v.optional(v.string()),
    celular: v.optional(v.string()),
    correo: v.optional(v.string()),
    fechaEntrada: v.optional(v.number()),
    fechaSalida: v.optional(v.number()),
    horaEntrada: v.optional(v.string()),
    horaSalida: v.optional(v.string()),
    numeroNoches: v.optional(v.number()),
    numeroPersonas: v.optional(v.number()),
    personasAdicionales: v.optional(v.number()),
    tieneMascotas: v.optional(v.boolean()),
    numeroMascotas: v.optional(v.number()),
    subtotal: v.optional(v.number()),
    costoPersonasAdicionales: v.optional(v.number()),
    costoMascotas: v.optional(v.number()),
    depositoMascotas: v.optional(v.number()),
    sobrecargoMascotas: v.optional(v.number()),
    costoPersonalServicio: v.optional(v.number()),
    depositoGarantia: v.optional(v.number()),
    depositoAseo: v.optional(v.number()),
    discountAmount: v.optional(v.number()),
    issueDate: v.optional(v.string()),
    economicAdjustments: v.optional(
      v.array(
        v.object({
          id: v.string(),
          date: v.string(),
          description: v.string(),
          amount: v.number(),
          type: v.union(v.literal('INCREMENT'), v.literal('DISCOUNT')),
          createdBy: v.optional(v.string()),
          createdAt: v.number(),
        }),
      ),
    ),
    precioTotal: v.optional(v.number()),
    temporada: v.optional(v.string()),
    observaciones: v.optional(v.string()),
    city: v.optional(v.string()),
    purpose: v.optional(v.string()),
    groupType: v.optional(v.string()),
    reference: v.optional(v.string()),
    address: v.optional(v.string()),
    fechaNacimiento: v.optional(v.string()),
    calendarLabel: v.optional(v.string()),
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
          size: v.optional(v.number()),
          uploadedAt: v.optional(v.number()),
        }),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    const booking = await ctx.db.get(id);

    if (!booking) {
      throw new Error('Reserva no encontrada');
    }

    const propertyId = updates.propertyId ?? booking.propertyId;
    const fechaEntrada = updates.fechaEntrada ?? booking.fechaEntrada;
    const fechaSalida = updates.fechaSalida ?? booking.fechaSalida;

    if (fechaSalida <= fechaEntrada) {
      throw new Error('La fecha de salida debe ser posterior a la de entrada');
    }

    const availability = await ctx.runQuery(api.bookings.checkAvailability, {
      propertyId,
      fechaEntrada,
      fechaSalida,
      excludeBookingId: id,
    });

    if (!availability.available) {
      throw new Error(
        'La propiedad no está disponible para las fechas seleccionadas',
      );
    }

    const fechaNacimiento = (() => {
      const raw = updates.fechaNacimiento?.trim();
      if (!raw) return undefined;
      return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : undefined;
    })();
    const { fechaNacimiento: _dropBirthdate, ...bookingUpdates } = updates;

    const patch: Record<string, unknown> = {
      ...bookingUpdates,
      propertyId,
      fechaEntrada,
      fechaSalida,
      updatedAt: Date.now(),
    };

    await ctx.db.patch(id, patch);

    const celular = updates.celular ?? booking.celular;
    const nombreCompleto = updates.nombreCompleto ?? booking.nombreCompleto;
    const correo = updates.correo ?? booking.correo;
    const cedula = updates.cedula ?? booking.cedula;
    const city = updates.city ?? booking.city;
    const now = Date.now();

    if (celular && (fechaNacimiento || booking.userId)) {
      let contactId = booking.userId;

      if (!contactId) {
        const contactByPhone = await ctx.db
          .query('contacts')
          .withIndex('by_phone', (q) => q.eq('phone', celular))
          .first();
        contactId = contactByPhone?._id;
      }

      if (contactId) {
        await ctx.db.patch(contactId, {
          name: nombreCompleto,
          phone: celular,
          email: correo,
          cedula,
          city,
          ...(fechaNacimiento ? { fechaNacimiento } : {}),
          crmType: 'client',
          lastReservationAt: now,
          updatedAt: now,
        });
      } else if (fechaNacimiento) {
        const newContactId = await ctx.db.insert('contacts', {
          name: nombreCompleto,
          phone: celular,
          email: correo,
          cedula,
          city,
          fechaNacimiento,
          crmType: 'client',
          createdAt: now,
          lastReservationAt: now,
          updatedAt: now,
        });
        await ctx.db.patch(id, { userId: newContactId });
      }
    }

    const availabilityBlocks = await ctx.db
      .query('propertyAvailability')
      .withIndex('by_booking', (q) => q.eq('bookingId', id))
      .collect();

    if (availabilityBlocks.length > 0) {
      await Promise.all(
        availabilityBlocks.map((block) =>
          ctx.db.patch(block._id, {
            propertyId,
            fechaEntrada,
            fechaSalida,
          }),
        ),
      );
    } else {
      await ctx.db.insert('propertyAvailability', {
        propertyId,
        bookingId: id,
        fechaEntrada,
        fechaSalida,
        blocked: true,
        reason: 'Reserva confirmada',
        googleEventId: booking.googleEventId,
      });
    }

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

    const approvedReceipts = (booking.paymentPortalReceipts ?? []).filter(
      (r) => r.status === 'approved',
    );
    const enrichedPayments = payments.map((payment) => {
      if (payment.verifiedBy?.trim()) return payment;
      const notesMatch = String(payment.notes ?? '').match(/\bpor\s+([^·.\n]+)/i);
      if (notesMatch?.[1]?.trim()) {
        return {
          ...payment,
          verifiedBy: notesMatch[1].trim(),
        };
      }
      const match = approvedReceipts.find((receipt) => {
        const receiptAmount = Math.floor(
          Number(receipt.reviewedAmount ?? receipt.amount ?? 0),
        );
        if (receiptAmount !== payment.amount) return false;
        const receiptAt = receipt.reviewedAt ?? receipt.submittedAt;
        return Math.abs(receiptAt - payment.createdAt) <= 5 * 60 * 1000;
      });
      if (!match?.reviewedBy) return payment;
      return {
        ...payment,
        verifiedBy: match.reviewedBy,
        verifiedAt: match.reviewedAt ?? payment.verifiedAt,
      };
    });

    const netPaid = netPaidFromPayments(payments);
    const pending = pendingFromTotal(booking.precioTotal, netPaid);

    return {
      bookingId: booking._id,
      precioTotal: booking.precioTotal,
      paymentStatus: booking.paymentStatus,
      netPaid,
      pending,
      payments: enrichedPayments,
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
    receiptUrl: v.optional(v.string()),
    verifiedBy: v.optional(v.string()),
    verifiedAt: v.optional(v.number()),
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
      receiptUrl: args.receiptUrl?.trim() || undefined,
      verifiedBy: args.verifiedBy?.trim() || undefined,
      verifiedAt: args.verifiedAt,
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

/** Elimina un abono/pago cargado por error y recalcula el estado de pago. */
export const deletePayment = mutation({
  args: { paymentId: v.id('payments') },
  handler: async (ctx, args) => {
    const payment = await ctx.db.get(args.paymentId);
    if (!payment) throw new Error('Pago no encontrado');
    const bookingId = payment.bookingId;
    await ctx.db.delete(args.paymentId);

    const booking = await ctx.db.get(bookingId);
    if (booking) {
      const payments = await ctx.db
        .query('payments')
        .withIndex('by_booking', (q) => q.eq('bookingId', bookingId))
        .collect();
      const netPaid = netPaidFromPayments(payments);
      const paymentStatus = deriveBookingPaymentStatus(
        booking.precioTotal,
        netPaid,
      );
      await ctx.db.patch(bookingId, {
        paymentStatus,
        updatedAt: Date.now(),
        // Si ya no está pagado del todo, revierte el estado PAID de la reserva.
        ...(booking.status === 'PAID' && paymentStatus !== 'PAID'
          ? { status: 'CONFIRMED' as const }
          : {}),
      });
    }
    return { ok: true as const, bookingId };
  },
});

/** Devuelve el estado fresco de la devolución del depósito (cuenta, estado, etc.). */
export const getDepositReturn = query({
  args: { bookingId: v.id('bookings') },
  handler: async (ctx, args) => {
    const booking = await ctx.db.get(args.bookingId);
    if (!booking) return null;
    return booking.depositReturn ?? null;
  },
});

/** Override del equipo: habilitar/bloquear la edición de la lista de invitados. */
export const setGuestListUnlocked = mutation({
  args: { bookingId: v.id('bookings'), unlocked: v.boolean() },
  handler: async (ctx, args) => {
    const booking = await ctx.db.get(args.bookingId);
    if (!booking) throw new Error('Reserva no encontrada');
    await ctx.db.patch(args.bookingId, {
      guestListUnlocked: args.unlocked,
      updatedAt: Date.now(),
    });
    return { ok: true as const, guestListUnlocked: args.unlocked };
  },
});

const MANUAL_ABONO_TYPES = new Set(['ABONO_50', 'SALDO_50', 'COMPLETO']);

function isGatewayPayment(payment: Doc<'payments'>): boolean {
  return !!(
    payment.wompiData ||
    payment.boldData ||
    (payment.transactionId && payment.transactionId.trim())
  );
}

/** Reemplaza abonos manuales al editar una reserva desde el modal admin. */
export const syncReservationAbono = mutation({
  args: {
    bookingId: v.id('bookings'),
    paymentStatus: v.optional(v.string()),
    abono: v.optional(
      v.object({
        type: v.union(v.literal('ABONO_50'), v.literal('COMPLETO')),
        amount: v.number(),
        paymentMethod: v.optional(v.string()),
        notes: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const booking = await ctx.db.get(args.bookingId);
    if (!booking) throw new Error('Reserva no encontrada');

    const now = Date.now();
    const payments = await ctx.db
      .query('payments')
      .withIndex('by_booking', (q) => q.eq('bookingId', args.bookingId))
      .collect();

    for (const payment of payments) {
      if (
        MANUAL_ABONO_TYPES.has(payment.type) &&
        !isGatewayPayment(payment)
      ) {
        await ctx.db.delete(payment._id);
      }
    }

    const abono = args.abono;
    if (abono && abono.amount > 0) {
      await ctx.db.insert('payments', {
        bookingId: args.bookingId,
        type: abono.type,
        amount: Math.floor(abono.amount),
        currency: 'COP',
        paymentMethod: abono.paymentMethod?.trim() || 'Manual',
        status: 'PAID',
        notes: abono.notes?.trim() || undefined,
        createdAt: now,
        updatedAt: now,
      });
    }

    const updatedPayments = await ctx.db
      .query('payments')
      .withIndex('by_booking', (q) => q.eq('bookingId', args.bookingId))
      .collect();

    const netPaid = netPaidFromPayments(updatedPayments);
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

    return {
      bookingId: args.bookingId,
      precioTotal: booking.precioTotal,
      paymentStatus,
      netPaid,
      pending: pendingFromTotal(booking.precioTotal, netPaid),
      payments: updatedPayments.sort((a, b) => b.createdAt - a.createdAt),
    };
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

/** Marca/desmarca manualmente el check-in como enviado (etapa morado). */
export const markCheckinSent = mutation({
  args: { id: v.id('bookings'), sent: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const sent = args.sent ?? true;
    await ctx.db.patch(args.id, {
      checkinSentManualAt: sent ? Date.now() : undefined,
      updatedAt: Date.now(),
    });
    return { ok: true, sent };
  },
});

/** Check-out propietario (Fase 1): guarda/edita las observaciones del cliente con log. */
export const saveClientObservaciones = mutation({
  args: {
    id: v.id('bookings'),
    valor: v.string(),
    actor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const booking = await ctx.db.get(args.id);
    if (!booking) throw new Error('Reserva no encontrada');
    const valor = args.valor.trim();
    const actor = (args.actor ?? '').trim() || 'Equipo';
    const ts = Date.now();
    const prevLog = Array.isArray(booking.clientObservacionesLog)
      ? booking.clientObservacionesLog
      : [];
    // Solo agrega al log si el texto cambió.
    const log =
      valor !== String(booking.clientObservaciones ?? '')
        ? [...prevLog, { valor, actor, ts }].slice(-30)
        : prevLog;
    await ctx.db.patch(args.id, {
      clientObservaciones: valor,
      clientObservacionesUpdatedAt: ts,
      clientObservacionesLog: log,
      updatedAt: ts,
    });
    return { ok: true };
  },
});

/** Visibilidad de datos en el portal del propietario (/anfitrion). */
export const saveOwnerPortalShare = mutation({
  args: {
    id: v.id('bookings'),
    showGuestList: v.optional(v.boolean()),
    showPlates: v.optional(v.boolean()),
    showEmpleada: v.optional(v.boolean()),
    showInternalNotes: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const booking = await ctx.db.get(args.id);
    if (!booking) throw new Error('Reserva no encontrada');
    const prev = (booking.ownerPortalShare ?? {}) as Record<string, boolean | undefined>;
    const ts = Date.now();
    await ctx.db.patch(args.id, {
      ownerPortalShare: {
        showGuestList:
          args.showGuestList !== undefined
            ? args.showGuestList
            : prev.showGuestList,
        showPlates:
          args.showPlates !== undefined ? args.showPlates : prev.showPlates,
        showEmpleada:
          args.showEmpleada !== undefined
            ? args.showEmpleada
            : prev.showEmpleada,
        showInternalNotes:
          args.showInternalNotes !== undefined
            ? args.showInternalNotes
            : prev.showInternalNotes,
      },
      updatedAt: ts,
    });
    return { ok: true };
  },
});

/** Persona que recibe a los turistas: la diligencia el propietario desde su enlace. */
export const saveOwnerReceiver = mutation({
  args: {
    id: v.id('bookings'),
    nombre: v.optional(v.string()),
    contacto: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const booking = await ctx.db.get(args.id);
    if (!booking) throw new Error('Reserva no encontrada');
    const ts = Date.now();
    await ctx.db.patch(args.id, {
      ownerReceiver: {
        nombre: (args.nombre ?? '').trim() || undefined,
        contacto: (args.contacto ?? '').trim() || undefined,
        updatedAt: ts,
      },
      updatedAt: ts,
    });
    return { ok: true };
  },
});

/** Check-out propietario: guarda valor acordado (sin abonos). */
export const saveOwnerPayout = mutation({
  args: {
    id: v.id('bookings'),
    valorAcordado: v.optional(v.number()),
    abono: v.optional(v.number()),
    valor: v.optional(v.number()),
    fecha: v.optional(v.string()),
    medio: v.optional(v.string()),
    comprobanteUrl: v.optional(v.string()),
    actor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const booking = await ctx.db.get(args.id);
    if (!booking) throw new Error('Reserva no encontrada');
    const actor = (args.actor ?? '').trim() || 'Equipo';
    const ts = Date.now();
    const prev = (booking.ownerPayout ?? {}) as OwnerPayoutRecord;
    const prevLog = Array.isArray(prev.log) ? prev.log : [];
    const abonos = normalizeOwnerAbonos(prev, String(args.id), ts);

    let ownerPayout: OwnerPayoutRecord = {
      ...prev,
      valorAcordado:
        args.valorAcordado !== undefined ? args.valorAcordado : prev.valorAcordado,
      updatedAt: ts,
      log: [
        ...prevLog,
        {
          accion:
            prevLog.length === 0 ? 'Pago registrado' : 'Valor acordado actualizado',
          actor,
          ts,
        },
      ].slice(-30),
      abonos: abonos.length > 0 ? abonos : prev.abonos,
      abono:
        abonos.length > 0
          ? abonos.reduce((s, a) => s + a.amount, 0)
          : args.abono ?? prev.abono,
    };

    // Compatibilidad: si llega valor desde clientes antiguos, registrar abono.
    const valorPago =
      args.valor !== undefined && Number.isFinite(args.valor) ? args.valor : undefined;
    if (valorPago !== undefined && valorPago > 0) {
      const merged = [
        ...abonos,
        {
          id: `${ts}-${abonos.length}`,
          amount: valorPago,
          fecha: args.fecha ?? prev.fecha,
          medio: args.medio ?? prev.medio,
          comprobanteUrl: args.comprobanteUrl ?? prev.comprobanteUrl,
          createdAt: ts,
          actor,
        },
      ];
      ownerPayout = buildOwnerPayoutFromAbonos(
        { ...prev, valorAcordado: ownerPayout.valorAcordado },
        merged,
        ts,
        { accion: 'Abono registrado', actor, ts },
      );
    }

    await ctx.db.patch(args.id, { ownerPayout, updatedAt: ts });
    return { ok: true as const, ownerPayout };
  },
});

/** Registra un abono individual al propietario. */
export const addOwnerPayoutAbono = mutation({
  args: {
    id: v.id('bookings'),
    amount: v.number(),
    fecha: v.optional(v.string()),
    medio: v.optional(v.string()),
    comprobanteUrl: v.optional(v.string()),
    actor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const amount = Math.floor(Number(args.amount) || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('El monto debe ser mayor a cero.');
    }
    const booking = await ctx.db.get(args.id);
    if (!booking) throw new Error('Reserva no encontrada');
    const actor = (args.actor ?? '').trim() || 'Equipo';
    const ts = Date.now();
    const prev = (booking.ownerPayout ?? {}) as OwnerPayoutRecord;
    const abonos = normalizeOwnerAbonos(prev, String(args.id), ts);
    abonos.push({
      id: `${ts}-${abonos.length}`,
      amount,
      fecha: args.fecha?.trim() || undefined,
      medio: args.medio?.trim() || undefined,
      comprobanteUrl: args.comprobanteUrl,
      createdAt: ts,
      actor,
    });
    const ownerPayout = buildOwnerPayoutFromAbonos(prev, abonos, ts, {
      accion: 'Abono registrado',
      actor,
      ts,
    });
    await ctx.db.patch(args.id, { ownerPayout, updatedAt: ts });
    return { ok: true as const, ownerPayout };
  },
});

/** Elimina un abono al propietario por id. */
export const removeOwnerPayoutAbono = mutation({
  args: {
    id: v.id('bookings'),
    abonoId: v.string(),
    actor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const booking = await ctx.db.get(args.id);
    if (!booking) throw new Error('Reserva no encontrada');
    const actor = (args.actor ?? '').trim() || 'Equipo';
    const ts = Date.now();
    const prev = (booking.ownerPayout ?? {}) as OwnerPayoutRecord;
    const abonos = normalizeOwnerAbonos(prev, String(args.id), ts).filter(
      (item) => item.id !== args.abonoId,
    );
    const ownerPayout = buildOwnerPayoutFromAbonos(prev, abonos, ts, {
      accion: 'Abono eliminado',
      actor,
      ts,
    });
    await ctx.db.patch(args.id, { ownerPayout, updatedAt: ts });
    return { ok: true as const, ownerPayout };
  },
});

/** El propietario acepta el valor ofrecido desde /anfitrion (links de venta). */
export const acceptOwnerOffer = mutation({
  args: { reference: v.string() },
  handler: async (ctx, { reference }) => {
    const trimmed = reference.trim();
    if (!trimmed) return { ok: false as const, reason: 'invalid_reference' as const };

    const byRef = await ctx.db
      .query('bookings')
      .withIndex('by_reference', (q) => q.eq('reference', trimmed))
      .first();
    const booking = byRef ?? (await ctx.db.get(trimmed as Id<'bookings'>));
    if (!booking || !('numeroPersonas' in booking)) {
      return { ok: false as const, reason: 'not_found' as const };
    }

    const valorAcordado = Number(
      (booking.ownerPayout as { valorAcordado?: number } | undefined)?.valorAcordado,
    );
    let saleLinkId = booking.saleLinkId;
    if (!saleLinkId) {
      const linked = await ctx.db
        .query('saleLinks')
        .withIndex('by_booking', (q) => q.eq('bookingId', booking._id))
        .first();
      saleLinkId = linked?._id;
      if (saleLinkId) {
        await ctx.db.patch(booking._id, { saleLinkId, updatedAt: Date.now() });
      }
    }
    if (!saleLinkId || valorAcordado <= 0) {
      return { ok: false as const, reason: 'no_pending_offer' as const };
    }
    if (booking.ownerOfferAcceptedAt) {
      return { ok: true as const, alreadyAccepted: true as const };
    }
    if (booking.ownerOfferRejectedAt) {
      return { ok: false as const, reason: 'offer_rejected' as const };
    }

    const now = Date.now();
    await ctx.db.patch(booking._id, {
      ownerOfferAcceptedAt: now,
      saleLinkId,
      ownerPortalShare: {
        showGuestList: true,
        showPlates: true,
        showEmpleada: true,
        showInternalNotes: false,
      },
      updatedAt: now,
    });

    await ctx.runMutation(internal.saleLinks.onOwnerOfferAcceptedInternal, {
      saleLinkId,
    });

    return { ok: true as const };
  },
});

async function resolveSaleLinkIdForOwnerOffer(
  ctx: { db: any },
  booking: { _id: Id<'bookings'>; saleLinkId?: Id<'saleLinks'> },
): Promise<Id<'saleLinks'> | null> {
  let saleLinkId = booking.saleLinkId;
  if (!saleLinkId) {
    const linked = await ctx.db
      .query('saleLinks')
      .withIndex('by_booking', (q: any) => q.eq('bookingId', booking._id))
      .first();
    saleLinkId = linked?._id;
    if (saleLinkId) {
      await ctx.db.patch(booking._id, { saleLinkId, updatedAt: Date.now() });
    }
  }
  return saleLinkId ?? null;
}

/** El propietario rechaza el valor ofrecido desde /anfitrion. */
export const rejectOwnerOffer = mutation({
  args: { reference: v.string(), reason: v.string() },
  handler: async (ctx, { reference, reason }) => {
    const trimmed = reference.trim();
    const trimmedReason = reason.trim();
    if (!trimmed) return { ok: false as const, reason: 'invalid_reference' as const };
    if (!trimmedReason) return { ok: false as const, reason: 'reason_required' as const };

    const byRef = await ctx.db
      .query('bookings')
      .withIndex('by_reference', (q) => q.eq('reference', trimmed))
      .first();
    const booking = byRef ?? (await ctx.db.get(trimmed as Id<'bookings'>));
    if (!booking || !('numeroPersonas' in booking)) {
      return { ok: false as const, reason: 'not_found' as const };
    }

    const valorAcordado = Number(
      (booking.ownerPayout as { valorAcordado?: number } | undefined)?.valorAcordado,
    );
    const saleLinkId = await resolveSaleLinkIdForOwnerOffer(ctx, booking);
    if (!saleLinkId || valorAcordado <= 0) {
      return { ok: false as const, reason: 'no_pending_offer' as const };
    }
    if (booking.ownerOfferAcceptedAt) {
      return { ok: false as const, reason: 'already_accepted' as const };
    }
    if (booking.ownerOfferRejectedAt) {
      return { ok: true as const, alreadyRejected: true as const };
    }

    const now = Date.now();
    await ctx.db.patch(booking._id, {
      ownerOfferRejectedAt: now,
      ownerOfferRejectedReason: trimmedReason,
      saleLinkId,
      updatedAt: now,
    });

    await ctx.runMutation(internal.saleLinks.onOwnerOfferRejectedInternal, {
      saleLinkId,
      reason: trimmedReason,
    });

    return { ok: true as const };
  },
});

/** Observación del propietario sin rechazar la oferta. */
export const commentOwnerOffer = mutation({
  args: { reference: v.string(), comment: v.string() },
  handler: async (ctx, { reference, comment }) => {
    const trimmed = reference.trim();
    const trimmedComment = comment.trim();
    if (!trimmed) return { ok: false as const, reason: 'invalid_reference' as const };
    if (!trimmedComment) return { ok: false as const, reason: 'comment_required' as const };

    const byRef = await ctx.db
      .query('bookings')
      .withIndex('by_reference', (q) => q.eq('reference', trimmed))
      .first();
    const booking = byRef ?? (await ctx.db.get(trimmed as Id<'bookings'>));
    if (!booking || !('numeroPersonas' in booking)) {
      return { ok: false as const, reason: 'not_found' as const };
    }

    const valorAcordado = Number(
      (booking.ownerPayout as { valorAcordado?: number } | undefined)?.valorAcordado,
    );
    const saleLinkId = await resolveSaleLinkIdForOwnerOffer(ctx, booking);
    if (!saleLinkId || valorAcordado <= 0) {
      return { ok: false as const, reason: 'no_pending_offer' as const };
    }
    if (booking.ownerOfferAcceptedAt) {
      return { ok: false as const, reason: 'already_accepted' as const };
    }
    if (booking.ownerOfferRejectedAt) {
      return { ok: false as const, reason: 'offer_rejected' as const };
    }

    const now = Date.now();
    await ctx.db.patch(booking._id, {
      ownerOfferComment: trimmedComment,
      ownerOfferCommentAt: now,
      saleLinkId,
      updatedAt: now,
    });

    await ctx.runMutation(internal.saleLinks.onOwnerOfferCommentInternal, {
      saleLinkId,
      comment: trimmedComment,
    });

    return { ok: true as const };
  },
});

/** Check-out cliente (Fase 3): validación del propietario sobre la devolución del depósito. */
export const saveDepositApproval = mutation({
  args: {
    id: v.id('bookings'),
    estado: v.string(), // aprobado | rechazado | en_revision | pendiente_validacion
    por: v.optional(v.string()), // 'admin' | 'propietario'
    nombre: v.optional(v.string()),
    motivo: v.optional(v.string()),
    obsPropietario: v.optional(v.string()),
    valorRetenido: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const booking = await ctx.db.get(args.id);
    if (!booking) throw new Error('Reserva no encontrada');
    const ts = Date.now();
    const prev = (booking.depositReturn ?? {}) as NonNullable<
      typeof booking.depositReturn
    >;
    const por = (args.por ?? 'admin').trim();
    const nombre = (args.nombre ?? '').trim() || (por === 'propietario' ? 'Propietario' : 'Equipo');
    const prevLog = Array.isArray(prev.log) ? prev.log : [];

    const next: NonNullable<typeof booking.depositReturn> = {
      ...prev,
      estado: args.estado,
      aprobacion: { por, nombre, ts },
      updatedAt: ts,
    };
    if (args.estado === 'rechazado' || args.estado === 'en_revision') {
      next.retencion = {
        motivo: args.motivo?.trim() || prev.retencion?.motivo,
        obsPropietario:
          args.obsPropietario?.trim() || prev.retencion?.obsPropietario,
        valorRetenido:
          args.valorRetenido != null
            ? args.valorRetenido
            : prev.retencion?.valorRetenido,
        evidencias: prev.retencion?.evidencias,
      };
    }
    const accionMap: Record<string, string> = {
      aprobado: 'Propietario aprobó la devolución',
      rechazado: 'Propietario reportó novedades',
      en_revision: 'Devolución en revisión',
      pendiente_validacion: 'Reinicio a pendiente de validación',
    };
    next.log = [
      ...prevLog,
      { accion: accionMap[args.estado] || `Estado: ${args.estado}`, actor: nombre, ts },
    ].slice(-30);

    await ctx.db.patch(args.id, { depositReturn: next, updatedAt: ts });
    return { ok: true };
  },
});

/** Check-out cliente (Fase 3): adjunta evidencias de retención (urls ya subidas a S3). */
export const addDepositEvidencias = mutation({
  args: { id: v.id('bookings'), urls: v.array(v.string()) },
  handler: async (ctx, args) => {
    const booking = await ctx.db.get(args.id);
    if (!booking) throw new Error('Reserva no encontrada');
    const ts = Date.now();
    const prev = (booking.depositReturn ?? {}) as NonNullable<
      typeof booking.depositReturn
    >;
    const evid = [
      ...(prev.retencion?.evidencias ?? []),
      ...args.urls.filter(Boolean),
    ];
    await ctx.db.patch(args.id, {
      depositReturn: {
        ...prev,
        retencion: { ...(prev.retencion ?? {}), evidencias: evid },
        updatedAt: ts,
      },
      updatedAt: ts,
    });
    return { ok: true };
  },
});

/** Check-out cliente (Fase 3): registra el pago de devolución al cliente. */
export const saveDepositRefund = mutation({
  args: {
    id: v.id('bookings'),
    valor: v.optional(v.number()),
    fecha: v.optional(v.string()),
    medio: v.optional(v.string()),
    numTransaccion: v.optional(v.string()),
    observaciones: v.optional(v.string()),
    comprobanteUrl: v.optional(v.string()),
    actor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const booking = await ctx.db.get(args.id);
    if (!booking) throw new Error('Reserva no encontrada');
    const ts = Date.now();
    const actor = (args.actor ?? '').trim() || 'Equipo';
    const prev = (booking.depositReturn ?? {}) as NonNullable<
      typeof booking.depositReturn
    >;
    const prevDev = prev.devolucion ?? {};
    const prevLog = Array.isArray(prev.log) ? prev.log : [];
    const accion = prevDev.ts ? 'Devolución actualizada' : 'Devolución registrada';

    await ctx.db.patch(args.id, {
      depositReturn: {
        ...prev,
        // Marca como devuelto cuando ya está aprobado; si no, conserva el estado.
        estado:
          prev.estado === 'aprobado' || prev.estado === 'devuelto'
            ? 'devuelto'
            : prev.estado || 'aprobado',
        devolucion: {
          valor: args.valor ?? prevDev.valor,
          fecha: args.fecha ?? prevDev.fecha,
          medio: args.medio ?? prevDev.medio,
          numTransaccion: args.numTransaccion ?? prevDev.numTransaccion,
          observaciones: args.observaciones ?? prevDev.observaciones,
          comprobanteUrl: args.comprobanteUrl ?? prevDev.comprobanteUrl,
          registradoPor: actor,
          ts,
        },
        updatedAt: ts,
        log: [...prevLog, { accion, actor, ts }].slice(-30),
      },
      updatedAt: ts,
    });
    return { ok: true };
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

/** Reservas elegibles para re-sincronizar con Google Calendar (sin paginar). */
export const listForCalendarResync = internalQuery({
  args: { includePast: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const now = Date.now();
    const all = await ctx.db.query('bookings').collect();
    return all.filter(
      (booking) =>
        booking.status !== 'CANCELLED' &&
        (args.includePast === true || booking.fechaSalida >= now),
    );
  },
});

/** Quita el vínculo con un evento de Google Calendar sin disparar sync. */
export const clearGoogleCalendarLink = internalMutation({
  args: { id: v.id('bookings') },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      googleEventId: undefined,
      googleCalendarId: undefined,
      updatedAt: Date.now(),
    });
  },
});

/** Limpia vínculos de calendario en lote (p. ej. al cambiar de cuenta Google). */
export const clearAllGoogleCalendarLinks = internalMutation({
  args: {},
  handler: async (ctx) => {
    const bookings = await ctx.db.query('bookings').collect();
    let cleared = 0;
    for (const booking of bookings) {
      if (booking.status === 'CANCELLED' || !booking.googleEventId) continue;
      await ctx.db.patch(booking._id, {
        googleEventId: undefined,
        googleCalendarId: undefined,
        updatedAt: Date.now(),
      });
      cleared++;
    }
    return { cleared };
  },
});

/** Persiste el ID del evento de Google sin re-disparar sincronización. */
export const setGoogleCalendarLink = internalMutation({
  args: {
    id: v.id('bookings'),
    googleEventId: v.string(),
    googleCalendarId: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      googleEventId: args.googleEventId,
      googleCalendarId: args.googleCalendarId,
      updatedAt: Date.now(),
    });
  },
});

const saleLinkGuestValidator = v.object({
  nombreCompleto: v.string(),
  cedula: v.optional(v.string()),
  tipoDocumento: v.optional(v.string()),
  esMenor: v.optional(v.boolean()),
});

/** Crea la reserva del calendario al confirmar el CR (paso 5 → 6), sin completar check-in. */
export const provisionFromSaleLink = internalMutation({
  args: { saleLinkId: v.id('saleLinks') },
  handler: async (ctx, { saleLinkId }) => {
    const link = await ctx.db.get(saleLinkId);
    if (!link) return { ok: false as const, reason: 'not_found' as const };
    const client = link.clientData;
    if (!client) return { ok: false as const, reason: 'no_client' as const };

    if (link.bookingId) {
      const existing = await ctx.db.get(link.bookingId);
      if (existing) {
        return {
          ok: true as const,
          bookingId: link.bookingId,
          reference: existing.reference ?? String(existing._id),
        };
      }
    }

    const availability = await ctx.runQuery(api.bookings.checkAvailability, {
      propertyId: link.propertyId,
      fechaEntrada: link.checkIn,
      fechaSalida: link.checkOut,
    });
    if (!availability.available) {
      return { ok: false as const, reason: 'unavailable' as const };
    }

    const now = Date.now();
    const reference = resolveSaleLinkReference(link);
    let userId: Id<'contacts'> | undefined;
    const byPhone = await ctx.db
      .query('contacts')
      .withIndex('by_phone', (q) => q.eq('phone', client.telefono))
      .first();
    if (byPhone) userId = byPhone._id;

    const bookingId = await ctx.db.insert('bookings', {
      propertyId: link.propertyId,
      userId,
      cedula: client.cedula,
      celular: client.telefono,
      correo: client.email,
      nombreCompleto: client.nombre,
      fechaEntrada: link.checkIn,
      fechaSalida: link.checkOut,
      numeroNoches: link.nights,
      numeroPersonas: link.guests,
      personasAdicionales: 0,
      tieneMascotas: (link.petCount ?? 0) > 0,
      numeroMascotas: link.petCount ?? 0,
      subtotal: link.rentalValue,
      costoPersonasAdicionales: 0,
      costoMascotas: link.petSurcharge ?? 0,
      depositoMascotas: link.petDeposit ?? 0,
      sobrecargoMascotas: link.petSurcharge ?? 0,
      costoPersonalServicio: 0,
      depositoGarantia: link.depositAmount,
      depositoAseo: link.cleaningFee,
      discountAmount: 0,
      precioTotal: link.totalValue,
      currency: 'COP',
      temporada: 'ESTANDAR',
      status: 'CONFIRMED',
      paymentStatus: 'PARTIAL',
      reference,
      city: client.ciudad,
      address: client.direccion,
      horaEntrada: link.checkInTime,
      horaSalida: link.checkOutTime,
      isDirect: true,
      calendarLabel: '',
      paymentPortalConfig:
        link.selectedBankAccountIds.length > 0
          ? {
              bankAccountIds: link.selectedBankAccountIds,
              paymentMediaIds: [],
              updatedAt: now,
            }
          : undefined,
      observaciones: `Link venta: ${link.token}`,
      saleLinkId: link._id,
      createdAt: now,
      updatedAt: now,
    });

    const paidAmount = Math.max(
      0,
      Math.floor(
        Number(link.paymentProofAmount) ||
          Math.round(Number(link.totalValue) / 2),
      ),
    );
    if (paidAmount > 0) {
      await ctx.db.insert('payments', {
        bookingId,
        type: 'ABONO_50',
        amount: paidAmount,
        currency: 'COP',
        paymentMethod: 'Transferencia (link venta)',
        status: 'PAID',
        notes: 'Anticipo validado desde link de venta',
        verifiedBy: link.paymentValidatedBy,
        verifiedAt: link.paymentValidatedAt ?? now,
        createdAt: now,
        updatedAt: now,
      });
      const paymentStatus =
        paidAmount >= Number(link.totalValue) ? 'PAID' : 'PARTIAL';
      await ctx.db.patch(bookingId, {
        paymentStatus,
        updatedAt: now,
      });
    }

    await ctx.db.insert('propertyAvailability', {
      propertyId: link.propertyId,
      bookingId,
      fechaEntrada: link.checkIn,
      fechaSalida: link.checkOut,
      blocked: true,
      reason: 'Reserva confirmada (venta link)',
    });

    await ctx.db.patch(saleLinkId, {
      bookingId,
      updatedAt: now,
    });

    await ctx.scheduler.runAfter(0, internal.googleCalendar.syncBookingToCalendar, {
      bookingId,
    });

    return { ok: true as const, bookingId, reference };
  },
});

/** Crea o actualiza la reserva del calendario al completar check-in de un link de venta. */
export const createFromSaleLink = internalMutation({
  args: {
    saleLinkId: v.id('saleLinks'),
    guestDisplayName: v.string(),
    guests: v.array(saleLinkGuestValidator),
    menoresDe2: v.optional(v.number()),
    mascotas: v.optional(v.number()),
    placas: v.optional(v.string()),
    observaciones: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const link = await ctx.db.get(args.saleLinkId);
    if (!link) return { ok: false as const, reason: 'not_found' as const };
    const client = link.clientData;
    if (!client) return { ok: false as const, reason: 'no_client' as const };

    const now = Date.now();
    const observaciones = [
      args.observaciones?.trim(),
      args.placas?.trim() ? `Placas: ${args.placas.trim()}` : null,
      args.guests.length
        ? `Huéspedes: ${args.guests.map((g) => g.nombreCompleto).join(', ')}`
        : null,
      `Link venta: ${link.token}`,
    ]
      .filter(Boolean)
      .join('\n');

    const checkinPatch = {
      checkinGuests: args.guests,
      checkinMenoresDe2: args.menoresDe2,
      checkinMascotas: args.mascotas,
      checkinPlacas: args.placas,
      checkinObservaciones: args.observaciones,
      checkinCompleted: true,
      checkinCompletedAt: now,
      checkinUpdatedAt: now,
      nombreCompleto: args.guestDisplayName,
      observaciones,
      updatedAt: now,
    };

    if (link.bookingId) {
      await ctx.db.patch(link.bookingId, checkinPatch);
      await ctx.scheduler.runAfter(0, internal.googleCalendar.syncBookingToCalendar, {
        bookingId: link.bookingId,
      });
      return { ok: true as const, bookingId: link.bookingId };
    }

    const provisioned = (await ctx.runMutation(
      internal.bookings.provisionFromSaleLink,
      { saleLinkId: link._id },
    )) as
      | { ok: true; bookingId: Id<'bookings'>; reference: string }
      | { ok: false; reason: string };
    if (!provisioned.ok) {
      return provisioned;
    }

    await ctx.db.patch(provisioned.bookingId, checkinPatch);
    await ctx.scheduler.runAfter(0, internal.googleCalendar.syncBookingToCalendar, {
      bookingId: provisioned.bookingId,
    });
    return { ok: true as const, bookingId: provisioned.bookingId };
  },
});
