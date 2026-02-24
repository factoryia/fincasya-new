import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { api } from "./_generated/api";

// ============ QUERIES ============

/**
 * Listar reservas con filtros
 */
export const list = query({
  args: {
    propertyId: v.optional(v.id("properties")),
    userId: v.optional(v.id("users")),
    status: v.optional(
      v.union(
        v.literal("PENDING"),
        v.literal("CONFIRMED"),
        v.literal("PAID"),
        v.literal("CANCELLED"),
        v.literal("COMPLETED")
      )
    ),
    limit: v.optional(v.number()),
    cursor: v.optional(v.id("bookings")),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;
    
    // Aplicar filtros con índices y obtener todas las reservas
    const allBookings = args.propertyId
      ? await ctx.db.query("bookings").withIndex("by_property", (q) => q.eq("propertyId", args.propertyId!)).collect()
      : args.status
      ? await ctx.db.query("bookings").withIndex("by_status", (q) => q.eq("status", args.status!)).collect()
      : args.userId
      ? await ctx.db.query("bookings").withIndex("by_user", (q) => q.eq("userId", args.userId)).collect()
      : await ctx.db.query("bookings").collect();

    // Aplicar cursor si existe (filtrar manualmente después de obtener los resultados)
    let filtered = allBookings;
    if (args.cursor) {
      filtered = filtered.filter((b: typeof allBookings[number]) => b._id > args.cursor!);
    }

    // Ordenar por fecha de creación (más recientes primero)
    filtered = filtered.sort((a, b) => b.createdAt - a.createdAt);

    // Determinar si hay más resultados
    const hasMore = filtered.length > limit;
    const bookingsToReturn = hasMore ? filtered.slice(0, limit) : filtered;

    // Obtener detalles de la propiedad para cada reserva
    const bookingsWithDetails = await Promise.all(
      bookingsToReturn.map(async (booking: typeof allBookings[number]) => {
        const property = await ctx.db.get(booking.propertyId);
        return {
          ...booking,
          property: property
            ? {
                id: property._id,
                title: property.title,
                location: property.location,
              }
            : null,
        };
      })
    );

    // Obtener el cursor para la siguiente página
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

/**
 * Obtener reserva por ID
 */
export const getById = query({
  args: { id: v.id("bookings") },
  handler: async (ctx, args) => {
    const booking = await ctx.db.get(args.id);
    if (!booking) {
      return null;
    }

    const property = await ctx.db.get(booking.propertyId);
    const payments = await ctx.db
      .query("payments")
      .withIndex("by_booking", (q) => q.eq("bookingId", args.id))
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
      .query("bookings")
      .withIndex("by_reference", (q) => q.eq("reference", args.reference))
      .first();

    if (!booking) {
      return null;
    }

    const property = await ctx.db.get(booking.propertyId);
    const payments = await ctx.db
      .query("payments")
      .withIndex("by_booking", (q) => q.eq("bookingId", booking._id))
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
    propertyId: v.id("properties"),
    fechaEntrada: v.number(),
    fechaSalida: v.number(),
  },
  handler: async (ctx, args) => {
    // Buscar reservas que se solapen con las fechas solicitadas
    const conflictingBookings = await ctx.db
      .query("bookings")
      .withIndex("by_property", (q) => q.eq("propertyId", args.propertyId))
      .filter((q) =>
        q.or(
          // Reserva empieza antes y termina durante el período solicitado
          q.and(
            q.lte(q.field("fechaEntrada"), args.fechaEntrada),
            q.gt(q.field("fechaSalida"), args.fechaEntrada)
          ),
          // Reserva está completamente dentro del período solicitado
          q.and(
            q.gte(q.field("fechaEntrada"), args.fechaEntrada),
            q.lte(q.field("fechaSalida"), args.fechaSalida)
          ),
          // Reserva empieza durante el período solicitado
          q.and(
            q.gte(q.field("fechaEntrada"), args.fechaEntrada),
            q.lt(q.field("fechaEntrada"), args.fechaSalida)
          )
        )
      )
      .filter((q) =>
        q.neq(q.field("status"), "CANCELLED")
      )
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

// ============ MUTATIONS ============

/**
 * Crear una nueva reserva
 */
export const create = mutation({
  args: {
    propertyId: v.id("properties"),
    userId: v.optional(v.id("users")),
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
    costoPersonalServicio: v.optional(v.number()),
    depositoGarantia: v.optional(v.number()),
    depositoAseo: v.optional(v.number()),
    discountCode: v.optional(v.string()),
    discountAmount: v.optional(v.number()),
    precioTotal: v.number(),
    currency: v.optional(v.string()),
    temporada: v.string(),
    observaciones: v.optional(v.string()),
    reference: v.optional(v.string()),
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
        "La propiedad no está disponible para las fechas seleccionadas"
      );
    }

    const bookingId = await ctx.db.insert("bookings", {
      propertyId: args.propertyId,
      userId: args.userId,
      nombreCompleto: args.nombreCompleto,
      cedula: args.cedula,
      celular: args.celular,
      correo: args.correo,
      fechaEntrada: args.fechaEntrada,
      fechaSalida: args.fechaSalida,
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
      currency: args.currency ?? "COP",
      temporada: args.temporada,
      status: "PENDING",
      paymentStatus: "PENDING",
      reference: args.reference,
      observaciones: args.observaciones,
      createdAt: now,
      updatedAt: now,
    });

    // Crear bloque de disponibilidad
    await ctx.db.insert("propertyAvailability", {
      propertyId: args.propertyId,
      bookingId,
      fechaEntrada: args.fechaEntrada,
      fechaSalida: args.fechaSalida,
      blocked: true,
      reason: "Reserva confirmada",
    });

    return bookingId;
  },
});

/**
 * Actualizar una reserva
 */
export const update = mutation({
  args: {
    id: v.id("bookings"),
    status: v.optional(
      v.union(
        v.literal("PENDING"),
        v.literal("CONFIRMED"),
        v.literal("PAID"),
        v.literal("CANCELLED"),
        v.literal("COMPLETED")
      )
    ),
    paymentStatus: v.optional(
      v.union(
        v.literal("PENDING"),
        v.literal("PARTIAL"),
        v.literal("PAID"),
        v.literal("REFUNDED")
      )
    ),
    observaciones: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    const booking = await ctx.db.get(id);

    if (!booking) {
      throw new Error("Reserva no encontrada");
    }

    await ctx.db.patch(id, {
      ...updates,
      updatedAt: Date.now(),
    });

    return id;
  },
});

/**
 * Cancelar una reserva
 */
export const cancel = mutation({
  args: {
    id: v.id("bookings"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const booking = await ctx.db.get(args.id);

    if (!booking) {
      throw new Error("Reserva no encontrada");
    }

    // Actualizar estado de la reserva
    await ctx.db.patch(args.id, {
      status: "CANCELLED",
      updatedAt: Date.now(),
    });

    // Eliminar bloque de disponibilidad
    const availability = await ctx.db
      .query("propertyAvailability")
      .withIndex("by_booking", (q) => q.eq("bookingId", args.id))
      .collect();

    await Promise.all(availability.map((a) => ctx.db.delete(a._id)));

    return { success: true };
  },
});

/**
 * Crear un pago
 */
export const createPayment = mutation({
  args: {
    bookingId: v.id("bookings"),
    type: v.union(
      v.literal("ABONO_50"),
      v.literal("SALDO_50"),
      v.literal("COMPLETO"),
      v.literal("REEMBOLSO")
    ),
    amount: v.number(),
    currency: v.optional(v.string()),
    transactionId: v.optional(v.string()),
    reference: v.optional(v.string()),
    paymentMethod: v.optional(v.string()),
    checkoutUrl: v.optional(v.string()),
    status: v.optional(v.string()),
    wompiData: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    const paymentId = await ctx.db.insert("payments", {
      bookingId: args.bookingId,
      type: args.type,
      amount: args.amount,
      currency: args.currency ?? "COP",
      transactionId: args.transactionId,
      reference: args.reference,
      paymentMethod: args.paymentMethod,
      checkoutUrl: args.checkoutUrl,
      status: args.status ?? "pending",
      wompiData: args.wompiData,
      createdAt: now,
      updatedAt: now,
    });

    // Actualizar estado de pago de la reserva si es necesario
    const booking = await ctx.db.get(args.bookingId);
    if (booking) {
      let paymentStatus: "PENDING" | "PARTIAL" | "PAID" | "REFUNDED" = "PENDING";

      // Calcular total pagado
      const payments = await ctx.db
        .query("payments")
        .withIndex("by_booking", (q) => q.eq("bookingId", args.bookingId))
        .filter((q) => q.neq(q.field("status"), "refunded"))
        .collect();

      const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);

      if (totalPaid >= booking.precioTotal) {
        paymentStatus = "PAID";
      } else if (totalPaid > 0) {
        paymentStatus = "PARTIAL";
      }

      await ctx.db.patch(args.bookingId, {
        paymentStatus,
        updatedAt: now,
      });
    }

    return paymentId;
  },
});
