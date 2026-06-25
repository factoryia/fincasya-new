import { v } from 'convex/values';
import { query } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';

type PendingReceiptRow = {
  bookingId: Id<'bookings'>;
  reference?: string;
  clientName: string;
  propertyId: Id<'properties'>;
  propertyTitle?: string;
  checkIn: number;
  receipt: NonNullable<Doc<'bookings'>['paymentPortalReceipts']>[number];
};

function collectPendingFromBooking(
  booking: Doc<'bookings'>,
): PendingReceiptRow[] {
  const receipts = booking.paymentPortalReceipts ?? [];
  const pending = receipts.filter((r) => r.status === 'pending');
  if (pending.length === 0) return [];

  return pending.map((receipt) => ({
    bookingId: booking._id,
    reference: booking.reference,
    clientName: booking.nombreCompleto,
    propertyId: booking.propertyId,
    checkIn: booking.fechaEntrada,
    receipt,
  }));
}

/** Lista soportes de pago con estado `pending` en todas las reservas. */
export const listPending = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 200, 1), 500);
    const bookings = await ctx.db.query('bookings').collect();

    const rows: PendingReceiptRow[] = [];
    for (const booking of bookings) {
      rows.push(...collectPendingFromBooking(booking));
    }

    const slice = rows
      .sort((a, b) => b.receipt.submittedAt - a.receipt.submittedAt)
      .slice(0, limit);

    const propertyIds = [...new Set(slice.map((r) => r.propertyId))];
    const propertyTitles = new Map<Id<'properties'>, string>();
    await Promise.all(
      propertyIds.map(async (id) => {
        const prop = await ctx.db.get(id);
        if (prop) {
          const title = (prop as Record<string, unknown>)['title'];
          if (typeof title === 'string' && title.trim()) {
            propertyTitles.set(id, title.trim());
          }
        }
      }),
    );

    return slice.map((row) => ({
      ...row,
      propertyTitle: propertyTitles.get(row.propertyId),
    }));
  },
});

/** Conteo rápido para badges del panel admin. */
export const countPending = query({
  args: {},
  handler: async (ctx) => {
    const bookings = await ctx.db.query('bookings').collect();
    let count = 0;
    for (const booking of bookings) {
      const receipts = booking.paymentPortalReceipts ?? [];
      count += receipts.filter((r) => r.status === 'pending').length;
    }
    return count;
  },
});
