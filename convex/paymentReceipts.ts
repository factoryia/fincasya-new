import { v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import { mutation, query } from './_generated/server';
import { resolveSaleLinkReference } from './lib/saleLinkReference';
import { textMatchesSearchTerm } from './lib/searchText';

type PaymentProofRecord = {
  url: string;
  fileName?: string;
  mimeType?: string;
  amount?: number;
  submittedAt: number;
};

function resolveSaleLinkPaymentProofs(link: {
  paymentProofs?: PaymentProofRecord[];
  paymentProofUrl?: string;
  paymentProofFileName?: string;
  paymentProofMimeType?: string;
  paymentProofAmount?: number;
  paymentProofSubmittedAt?: number;
}): PaymentProofRecord[] {
  if (link.paymentProofs?.length) return link.paymentProofs;
  if (link.paymentProofUrl?.trim()) {
    return [
      {
        url: link.paymentProofUrl.trim(),
        fileName: link.paymentProofFileName,
        mimeType: link.paymentProofMimeType,
        amount: link.paymentProofAmount,
        submittedAt: link.paymentProofSubmittedAt ?? Date.now(),
      },
    ];
  }
  return [];
}

/**
 * Lista los soportes de pago PENDIENTES (portal check-in + links de venta),
 * con el contexto de la reserva, para que el equipo los revise.
 */
export const listPending = query({
  args: {
    source: v.optional(
      v.union(v.literal('all'), v.literal('portal'), v.literal('sale-link')),
    ),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const sourceFilter = args.source ?? 'all';
    const search = args.search?.trim().toLowerCase() ?? '';

    const matchesSearch = (fields: Array<string | undefined>) => {
      if (!search) return true;
      return fields.some((f) => String(f ?? '').toLowerCase().includes(search));
    };

    // Solo las reservas con un soporte pendiente (vía índice), sin escanear toda
    // la tabla: así nunca se excede el límite de lectura de Convex.
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

    if (sourceFilter === 'all' || sourceFilter === 'portal') {
      const bookings = await ctx.db
        .query('bookings')
        .withIndex('by_pending_receipt', (q) => q.eq('hasPendingReceipt', true))
        .collect();

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
          const reference = String(b.reference ?? b._id);

          for (const r of pending) {
            if (
              !matchesSearch([
                reference,
                property?.title,
                b.nombreCompleto,
                b.cedula,
              ])
            ) {
              continue;
            }
            items.push({
              source: 'portal',
              bookingId: b._id,
              receiptId: r.id,
              reference,
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
          continue;
        }
      }
    }

    if (sourceFilter === 'all' || sourceFilter === 'sale-link') {
      const saleLinks = await ctx.db.query('saleLinks').order('desc').take(400);

      for (const link of saleLinks) {
        if (link.paymentValidated) continue;
        if (link.status === 'cancelled') continue;
        if ((link.clientStep ?? 1) < 3) continue;

        const proofs = resolveSaleLinkPaymentProofs(link);
        if (!proofs.length) continue;

        const property = await getProp(link.propertyId);
        const reference = resolveSaleLinkReference(link);
        const client = link.clientData;
        const latest = proofs[proofs.length - 1];
        const anticipo = Math.max(
          0,
          Math.floor(Number(latest.amount ?? link.paymentProofAmount) || 0),
        );
        const precioTotal = Number(link.totalValue) || 0;
        const pendiente = Math.max(0, precioTotal - anticipo);

        if (
          !matchesSearch([
            reference,
            link.contractCode,
            property?.title,
            client?.nombre,
            client?.cedula,
            client?.email,
          ])
        ) {
          continue;
        }

        items.push({
          source: 'sale-link',
          saleLinkToken: link.token,
          saleLinkId: link._id,
          bookingId: link.bookingId ?? null,
          receiptId: `sale-link-${link.token}`,
          reference,
          propertyTitle: property?.title ?? '',
          clienteNombre: client?.nombre ?? '',
          clienteCedula: client?.cedula ?? '',
          clienteEmail: client?.email ?? '',
          precioTotal,
          pagado: anticipo,
          pendiente,
          amount: anticipo > 0 ? anticipo : Math.round(precioTotal / 2),
          bankName: 'Link de venta',
          receiptUrl: latest.url,
          fileName: latest.fileName ?? link.paymentProofFileName ?? '',
          submittedAt: latest.submittedAt ?? link.paymentProofSubmittedAt,
          clientStep: link.clientStep,
        });
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
    const stillPending = next.some((r) => r.status === 'pending');
    await ctx.db.patch(args.bookingId, {
      paymentPortalReceipts: next,
      hasPendingReceipt: stillPending,
      updatedAt: Date.now(),
    });
    return { ok: true as const };
  },
});

/**
 * Marca `hasPendingReceipt` en las reservas existentes que ya tienen un soporte
 * pendiente (para que aparezcan en la cola con el nuevo índice). Acotado a las
 * reservas recientes para no exceder el límite de lectura.
 */
export const backfillPendingFlag = mutation({
  args: {},
  handler: async (ctx) => {
    const bookings = await ctx.db.query('bookings').order('desc').take(400);
    let actualizadas = 0;
    for (const b of bookings) {
      const tienePend = (b.paymentPortalReceipts ?? []).some(
        (r) => r.status === 'pending',
      );
      if (tienePend && b.hasPendingReceipt !== true) {
        await ctx.db.patch(b._id, { hasPendingReceipt: true });
        actualizadas++;
      } else if (!tienePend && b.hasPendingReceipt === true) {
        await ctx.db.patch(b._id, { hasPendingReceipt: false });
        actualizadas++;
      }
    }
    return { ok: true as const, actualizadas };
  },
});

type VerifiedGuestSource = 'checkin' | 'payment' | 'sale-link';

type VerifiedGuestRow = {
  id: string;
  nombre: string;
  cedula: string;
  celular: string;
  correo: string;
  city: string;
  reference: string;
  propertyTitle: string;
  source: VerifiedGuestSource;
  sourceLabel: string;
  lastVerifiedAt: number;
  lastVerifiedAmount: number;
  lastVerifiedBy: string;
  bookingId?: Id<'bookings'>;
};

function guestDedupeKey(input: {
  cedula?: string;
  celular?: string;
  nombre?: string;
}): string {
  const cedula = String(input.cedula ?? '').replace(/\D/g, '');
  if (cedula.length >= 6) return `ced:${cedula}`;
  const celular = String(input.celular ?? '').replace(/\D/g, '');
  if (celular.length >= 10) return `tel:${celular.slice(-10)}`;
  const nombre = String(input.nombre ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  return nombre ? `name:${nombre}` : '';
}

function matchesVerifiedGuestSearch(
  search: string,
  fields: Array<string | undefined>,
): boolean {
  if (!search) return true;
  return fields.some((field) => textMatchesSearchTerm(String(field ?? ''), search));
}

function upsertVerifiedGuest(
  map: Map<string, VerifiedGuestRow>,
  row: VerifiedGuestRow,
) {
  const key =
    guestDedupeKey({
      cedula: row.cedula,
      celular: row.celular,
      nombre: row.nombre,
    }) || row.id;
  const existing = map.get(key);
  if (!existing || row.lastVerifiedAt > existing.lastVerifiedAt) {
    map.set(key, row);
  }
}

/**
 * Huéspedes con abono/pago verificado (check-in, revisión de pagos o link de venta).
 * Para autocompletar datos al crear una reserva manual.
 */
export const searchVerifiedGuests = query({
  args: {
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const search = args.search?.trim() ?? '';
    const limit = Math.min(Math.max(args.limit ?? 12, 1), 30);
    if (search.length < 2) return [];

    const byGuest = new Map<string, VerifiedGuestRow>();
    const propCache = new Map<string, { title?: string } | null>();
    const getProp = async (id: Id<'properties'> | undefined) => {
      if (!id) return null;
      const key = String(id);
      if (propCache.has(key)) return propCache.get(key) ?? null;
      const p = (await ctx.db.get(id)) as { title?: string } | null;
      propCache.set(key, p);
      return p;
    };

    const bookings = await ctx.db.query('bookings').order('desc').take(700);
    for (const booking of bookings) {
      const property = await getProp(booking.propertyId);
      const baseFields = [
        booking.nombreCompleto,
        booking.cedula,
        booking.celular,
        booking.correo,
        booking.reference,
        property?.title,
      ];
      if (!matchesVerifiedGuestSearch(search, baseFields)) continue;

      const approvedReceipts = (booking.paymentPortalReceipts ?? [])
        .filter((r) => r.status === 'approved')
        .sort(
          (a, b) =>
            (b.reviewedAt ?? b.submittedAt) - (a.reviewedAt ?? a.submittedAt),
        );
      if (approvedReceipts.length > 0) {
        const latest = approvedReceipts[0];
        upsertVerifiedGuest(byGuest, {
          id: `checkin:${booking._id}:${latest.id}`,
          nombre: booking.nombreCompleto,
          cedula: booking.cedula ?? '',
          celular: booking.celular ?? '',
          correo: booking.correo ?? '',
          city: booking.city ?? '',
          reference: booking.reference ?? '',
          propertyTitle: property?.title ?? '',
          source: 'checkin',
          sourceLabel: 'Abono check-in',
          lastVerifiedAt: latest.reviewedAt ?? latest.submittedAt,
          lastVerifiedAmount: Math.max(
            0,
            Math.floor(Number(latest.reviewedAmount ?? latest.amount ?? 0)),
          ),
          lastVerifiedBy: latest.reviewedBy ?? '',
          bookingId: booking._id,
        });
        continue;
      }

      const payments = await ctx.db
        .query('payments')
        .withIndex('by_booking', (q) => q.eq('bookingId', booking._id))
        .collect();
      const paid = payments
        .filter(
          (p) =>
            String(p.status ?? '').toUpperCase() === 'PAID' &&
            Math.floor(Number(p.amount) || 0) > 0,
        )
        .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
      if (paid.length === 0) continue;

      const latestPayment = paid[0];
      upsertVerifiedGuest(byGuest, {
        id: `payment:${booking._id}:${latestPayment._id}`,
        nombre: booking.nombreCompleto,
        cedula: booking.cedula ?? '',
        celular: booking.celular ?? '',
        correo: booking.correo ?? '',
        city: booking.city ?? '',
        reference: booking.reference ?? '',
        propertyTitle: property?.title ?? '',
        source: 'payment',
        sourceLabel: 'Pago registrado',
        lastVerifiedAt:
          latestPayment.verifiedAt ?? latestPayment.updatedAt ?? latestPayment.createdAt,
        lastVerifiedAmount: Math.max(
          0,
          Math.floor(Number(latestPayment.amount) || 0),
        ),
        lastVerifiedBy: latestPayment.verifiedBy ?? '',
        bookingId: booking._id,
      });
    }

    const saleLinks = await ctx.db.query('saleLinks').order('desc').take(250);
    for (const link of saleLinks) {
      if (!link.paymentValidated || !link.clientData) continue;
      const property = await getProp(link.propertyId);
      const reference = resolveSaleLinkReference(link);
      const client = link.clientData;
      const proofs = resolveSaleLinkPaymentProofs(link);
      const latestProof = proofs[proofs.length - 1];
      const amount = Math.max(
        0,
        Math.floor(
          Number(
            latestProof?.amount ??
              link.paymentProofAmount ??
              link.clientDraftPaymentAmount ??
              0,
          ),
        ),
      );

      if (
        !matchesVerifiedGuestSearch(search, [
          reference,
          link.contractCode,
          client.nombre,
          client.cedula,
          client.email,
          client.telefono,
          property?.title,
        ])
      ) {
        continue;
      }

      upsertVerifiedGuest(byGuest, {
        id: `sale-link:${link._id}`,
        nombre: client.nombre,
        cedula: client.cedula,
        celular: client.telefono,
        correo: client.email,
        city: client.ciudad ?? '',
        reference,
        propertyTitle: property?.title ?? '',
        source: 'sale-link',
        sourceLabel: 'Pago link venta',
        lastVerifiedAt:
          link.paymentValidatedAt ??
          latestProof?.submittedAt ??
          link.paymentProofSubmittedAt ??
          Date.now(),
        lastVerifiedAmount: amount,
        lastVerifiedBy: link.paymentValidatedBy ?? '',
        bookingId: link.bookingId,
      });
    }

    return Array.from(byGuest.values())
      .sort((a, b) => b.lastVerifiedAt - a.lastVerifiedAt)
      .slice(0, limit);
  },
});
