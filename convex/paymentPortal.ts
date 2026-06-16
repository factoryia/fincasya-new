import { v } from 'convex/values';
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import {
  netPaidFromPayments,
  pendingFromTotal,
} from './lib/bookingPayments';

function paymentPortalBase(): string {
  return (
    process.env.PAYMENT_PORTAL_BASE_URL || 'https://fincasya.com/pago'
  ).replace(/\/+$/, '');
}

type BreakdownRow = { label: string; amount: number; highlight?: boolean };

function computeBreakdown(booking: Doc<'bookings'>): BreakdownRow[] {
  const rows: BreakdownRow[] = [
    { label: 'Valor alquiler', amount: Number(booking.subtotal) || 0 },
    { label: 'Limpieza general', amount: Number(booking.depositoAseo) || 0 },
    {
      label: 'Valor depósito reembolsable',
      amount: Number(booking.depositoGarantia) || 0,
      highlight: true,
    },
    {
      label: 'Recargo por mascotas',
      amount: Number(booking.costoMascotas) || 0,
    },
    {
      label: 'Personal de servicio',
      amount: Number(booking.costoPersonalServicio) || 0,
    },
    {
      label: 'Descuento',
      amount: -(Number(booking.discountAmount) || 0),
    },
  ].filter((row) => row.amount !== 0);

  const sum = rows.reduce((acc, row) => acc + row.amount, 0);
  const diff = (Number(booking.precioTotal) || 0) - sum;
  const hasDeposit = rows.some((row) =>
    row.label.toLowerCase().includes('depósito reembolsable'),
  );

  if (diff !== 0) {
    if (!hasDeposit && diff > 0) {
      rows.push({
        label: 'Valor depósito reembolsable',
        amount: diff,
        highlight: true,
      });
    } else {
      rows.push({ label: 'Otros ajustes', amount: diff });
    }
  }

  return rows;
}

async function findBooking(
  ctx: { db: any },
  key: string,
): Promise<Doc<'bookings'> | null> {
  const trimmed = key.trim();
  if (!trimmed) return null;

  const byRef = await ctx.db
    .query('bookings')
    .withIndex('by_reference', (q: any) => q.eq('reference', trimmed))
    .first();
  if (byRef) return byRef as Doc<'bookings'>;

  try {
    const byId = await ctx.db.get(trimmed as Id<'bookings'>);
    if (byId && (byId as Doc<'bookings'>).precioTotal !== undefined) {
      return byId as Doc<'bookings'>;
    }
  } catch {
    /* key no es Id válido */
  }
  return null;
}

type ContractPayload = {
  bankAccounts?: Array<{
    id: string;
    bankName: string;
    accountType?: string;
    accountNumber: string;
    ownerName: string;
    ownerCedula?: string;
    imageUrl?: string;
    imageUrls?: string[];
    qrOnly?: boolean;
  }>;
  paymentMedia?: Array<{
    id: string;
    label: string;
    imageUrl: string;
  }>;
  primaryBankAccountId?: string | null;
};

async function loadContractPayload(ctx: { db: any }): Promise<ContractPayload> {
  const row = await ctx.db
    .query('adminContractSettings')
    .withIndex('by_scope', (q: any) => q.eq('scope', 'global'))
    .unique();
  return (row?.payload ?? {}) as ContractPayload;
}

function resolvePortalAccounts(
  payload: ContractPayload,
  config: Doc<'bookings'>['paymentPortalConfig'],
) {
  const allAccounts = payload.bankAccounts ?? [];
  let ids: string[];

  if (config != null) {
    // Config guardada explícitamente: respetar [] (sin cuentas para el cliente).
    ids = config.bankAccountIds ?? [];
  } else if (payload.primaryBankAccountId) {
    ids = [payload.primaryBankAccountId];
  } else {
    ids = allAccounts.map((a) => a.id);
  }

  const accounts = allAccounts
    .filter((a) => ids.includes(a.id))
    .map((a) => {
      const images = accountImages(a);
      return {
        id: a.id,
        bankName: a.bankName,
        accountType: a.accountType ?? '',
        accountNumber: a.accountNumber,
        ownerName: a.ownerName,
        ownerCedula: a.ownerCedula ?? '',
        imageUrl: images[0] ?? null,
        imageUrls: images,
        qrOnly: a.qrOnly ?? false,
      };
    });

  const mediaIds =
    config?.paymentMediaIds?.length
      ? config.paymentMediaIds
      : (payload.paymentMedia ?? []).map((m) => m.id);

  const media = (payload.paymentMedia ?? [])
    .filter((m) => mediaIds.includes(m.id))
    .map((m) => ({
      id: m.id,
      label: m.label,
      imageUrl: m.imageUrl,
    }));

  return { accounts, media };
}

function accountImages(account: {
  imageUrl?: string;
  imageUrls?: string[];
}): string[] {
  const fromArray = (account.imageUrls ?? []).filter(Boolean);
  if (fromArray.length > 0) return fromArray;
  if (account.imageUrl?.trim()) return [account.imageUrl.trim()];
  return [];
}

/** Link del portal de pago (admin). */
export const getPaymentLink = query({
  args: { bookingId: v.id('bookings') },
  handler: async (ctx, args) => {
    const b = await ctx.db.get(args.bookingId);
    if (!b) throw new Error('Reserva no encontrada');
    const cr = (b.reference || b._id) as string;
    return { link: `${paymentPortalBase()}/${cr}`, reference: cr };
  },
});

/** Guarda qué cuentas/imágenes mostrar en el link de pago. */
export const savePaymentPortalConfig = mutation({
  args: {
    bookingId: v.id('bookings'),
    bankAccountIds: v.array(v.string()),
    paymentMediaIds: v.optional(v.array(v.string())),
    boldLink: v.optional(v.string()),
    boldSurcharge: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const booking = await ctx.db.get(args.bookingId);
    if (!booking) throw new Error('Reserva no encontrada');

    const boldLink = args.boldLink?.trim();

    await ctx.db.patch(args.bookingId, {
      paymentPortalConfig: {
        bankAccountIds: args.bankAccountIds,
        paymentMediaIds: args.paymentMediaIds ?? [],
        boldLink: boldLink || undefined,
        boldSurcharge: boldLink ? args.boldSurcharge : undefined,
        updatedAt: Date.now(),
      },
      updatedAt: Date.now(),
    });

    const cr = (booking.reference || booking._id) as string;
    return {
      link: `${paymentPortalBase()}/${cr}`,
      reference: cr,
    };
  },
});

async function buildPortalView(ctx: { db: any }, key: string) {
  const booking = await findBooking(ctx, key);
  if (!booking) return null;

  const property = await ctx.db.get(booking.propertyId);
  const contractPayload = await loadContractPayload(ctx);
  const { accounts, media } = resolvePortalAccounts(
    contractPayload,
    booking.paymentPortalConfig,
  );

  const payments = await ctx.db
    .query('payments')
    .withIndex('by_booking', (q: any) => q.eq('bookingId', booking._id))
    .collect();
  const pagoTotal = netPaidFromPayments(payments);
  const precioTotal = Number(booking.precioTotal) || 0;
  const pagoPendiente = pendingFromTotal(precioTotal, pagoTotal);

  return {
    reference: booking.reference ?? booking._id,
    nombreTitular: booking.nombreCompleto,
    propertyTitle:
      (property as { title?: string } | null)?.title ?? 'tu finca',
    propertyLocation:
      (property as { location?: string } | null)?.location ?? null,
    fechaEntrada: booking.fechaEntrada,
    precioTotal,
    pagoTotal,
    pagoPendiente,
    pagoCompleto: pagoPendiente <= 0,
    breakdown: computeBreakdown(booking),
    bankAccounts: accounts,
    paymentMedia: media,
    boldLink: booking.paymentPortalConfig?.boldLink ?? null,
    boldSurcharge: booking.paymentPortalConfig?.boldSurcharge ?? null,
    receipts: (booking.paymentPortalReceipts ?? []).map((r) => ({
      id: r.id,
      bankAccountId: r.bankAccountId,
      bankName: r.bankName,
      amount: r.amount,
      receiptUrl: r.receiptUrl,
      fileName: r.fileName,
      status: r.status,
      submittedAt: r.submittedAt,
    })),
  };
}

export const getByReference = query({
  args: { key: v.string() },
  handler: async (ctx, args) => buildPortalView(ctx, args.key),
});

export const getForPortal = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, args) => buildPortalView(ctx, args.key),
});

export const submitReceipt = internalMutation({
  args: {
    key: v.string(),
    bankAccountId: v.optional(v.string()),
    bankName: v.optional(v.string()),
    amount: v.optional(v.number()),
    receiptUrl: v.string(),
    fileName: v.optional(v.string()),
    mimeType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const booking = await findBooking(ctx, args.key);
    if (!booking) return { ok: false as const, reason: 'not_found' };

    const url = args.receiptUrl.trim();
    if (!url) return { ok: false as const, reason: 'missing_receipt' };

    const amount =
      args.amount === undefined
        ? undefined
        : Math.max(0, Math.floor(Number(args.amount) || 0));

    const entry = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      bankAccountId: args.bankAccountId?.trim() || undefined,
      bankName: args.bankName?.trim() || undefined,
      amount: amount && amount > 0 ? amount : undefined,
      receiptUrl: url,
      fileName: args.fileName?.trim() || undefined,
      mimeType: args.mimeType?.trim() || undefined,
      status: 'pending' as const,
      submittedAt: Date.now(),
    };

    const prev = booking.paymentPortalReceipts ?? [];
    await ctx.db.patch(booking._id, {
      paymentPortalReceipts: [...prev, entry],
      updatedAt: Date.now(),
    });

    return { ok: true as const, receiptId: entry.id };
  },
});
