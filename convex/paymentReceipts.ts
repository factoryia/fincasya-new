import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

/**
 * Lista los soportes de pago PENDIENTES (subidos por turistas en el portal),
 * con el contexto de la reserva, para que el representante legal los revise.
 */
export const listPending = query({
  args: {},
  handler: async (ctx) => {
    // Acotamos el escaneo a reservas recientes (los soportes pendientes son de
    // reservas activas/próximas) para no exceder el límite de lectura de Convex.
    const bookings = await ctx.db.query('bookings').order('desc').take(800);
    const propCache = new Map<string, { title?: string } | null>();
    const getProp = async (id: any) => {
      if (!id) return null;
      const key = String(id);
      if (propCache.has(key)) return propCache.get(key) ?? null;
      try {
        const p = (await ctx.db.get(id)) as { title?: string } | null;
        propCache.set(key, p);
        return p;
      } catch {
        propCache.set(key, null);
        return null;
      }
    };

    const items: Array<Record<string, unknown>> = [];
    for (const b of bookings) {
      try {
        const pending = (b.paymentPortalReceipts ?? []).filter(
          (r) => r.status === 'pending',
        );
        if (!pending.length) continue;

        const property = await getProp(b.propertyId);
        let pagado = 0;
        try {
          const payments = await ctx.db
            .query('payments')
            .withIndex('by_booking', (q) => q.eq('bookingId', b._id))
            .collect();
          pagado = payments.reduce(
            (acc, p) =>
              acc +
              (p.type === 'REEMBOLSO'
                ? -(Number(p.amount) || 0)
                : Number(p.amount) || 0),
            0,
          );
        } catch {
          pagado = 0;
        }
        const precioTotal = Number(b.precioTotal) || 0;
        const pendiente = Math.max(0, precioTotal - pagado);

        for (const r of pending) {
          items.push({
            bookingId: b._id,
            receiptId: r.id,
            reference: b.reference ?? b._id,
            propertyTitle: property?.title ?? '',
            clienteNombre: b.nombreCompleto ?? '',
            clienteCedula: b.cedula ?? '',
            precioTotal,
            pagado,
            pendiente,
            amount: typeof r.amount === 'number' ? r.amount : undefined,
            bankName: r.bankName ?? '',
            receiptUrl: r.receiptUrl,
            fileName: r.fileName ?? '',
            submittedAt: r.submittedAt,
          });
        }
      } catch {
        // Si una reserva falla, la saltamos para no romper toda la lista.
        continue;
      }
    }

    items.sort(
      (a, b) =>
        (Number(b.submittedAt) || 0) - (Number(a.submittedAt) || 0),
    );
    return { items, total: items.length };
  },
});

/**
 * Aprueba o rechaza un soporte de pago. El registro del abono (cuando se
 * aprueba) lo hace la capa de servicio reusando `bookings:createPayment`.
 */
export const setReceiptStatus = mutation({
  args: {
    bookingId: v.id('bookings'),
    receiptId: v.string(),
    status: v.union(v.literal('approved'), v.literal('rejected')),
    reviewedAmount: v.optional(v.number()),
    rejectReason: v.optional(v.string()),
    reviewedBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const booking = await ctx.db.get(args.bookingId);
    if (!booking) return { ok: false as const, reason: 'not_found' };
    const receipts = booking.paymentPortalReceipts ?? [];
    let found = false;
    const next = receipts.map((r) => {
      if (r.id !== args.receiptId) return r;
      found = true;
      return {
        ...r,
        status: args.status,
        reviewedAt: Date.now(),
        reviewedBy: args.reviewedBy,
        reviewedAmount:
          args.status === 'approved'
            ? Math.max(0, Math.floor(Number(args.reviewedAmount ?? r.amount ?? 0)))
            : r.reviewedAmount,
        rejectReason:
          args.status === 'rejected'
            ? args.rejectReason?.trim() || undefined
            : r.rejectReason,
      };
    });
    if (!found) return { ok: false as const, reason: 'receipt_not_found' };
    await ctx.db.patch(args.bookingId, {
      paymentPortalReceipts: next,
      updatedAt: Date.now(),
    });
    return { ok: true as const };
  },
});
