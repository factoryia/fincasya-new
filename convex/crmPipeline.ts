import { query } from './_generated/server';
import { v } from 'convex/values';

const PIPELINE_STAGES = [
  { key: 'nuevo', label: 'Nuevo', step: 1 },
  { key: 'datos', label: 'Datos', step: 2 },
  { key: 'pago_enviado', label: 'Pago enviado', step: 3 },
  { key: 'pago_validado', label: 'Pago validado', step: 4 },
  { key: 'contrato', label: 'Contrato', step: 5 },
  { key: 'completado', label: 'Completado', step: 6 },
] as const;

function hasPaymentProof(link: {
  paymentProofUrl?: string;
  paymentProofs?: Array<{ url: string }>;
}): boolean {
  if (link.paymentProofUrl?.trim()) return true;
  return (link.paymentProofs?.length ?? 0) > 0;
}

function resolveStage(link: {
  status: string;
  clientStep: number;
  contractUrl?: string;
  paymentValidated?: boolean;
  paymentProofUrl?: string;
  paymentProofs?: Array<{ url: string }>;
  clientData?: unknown;
}): string {
  if (link.status === 'cancelled') return 'perdido';
  if (link.clientStep >= 6 || link.status === 'completed') return 'completado';
  if (link.clientStep >= 5 || link.contractUrl) return 'contrato';
  if (link.clientStep >= 4 || link.paymentValidated) return 'pago_validado';
  if (link.clientStep >= 3 || hasPaymentProof(link)) return 'pago_enviado';
  if (link.clientStep >= 2 || link.clientData) return 'datos';
  return 'nuevo';
}

export const listPipelineDeals = query({
  args: {
    status: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 300, 1), 1000);
    const rawStatus = args.status?.trim();

    let links;
    if (
      rawStatus === 'active' ||
      rawStatus === 'completed' ||
      rawStatus === 'cancelled'
    ) {
      links = await ctx.db
        .query('saleLinks')
        .withIndex('by_status', (q) => q.eq('status', rawStatus))
        .collect();
    } else {
      links = await ctx.db.query('saleLinks').collect();
    }

    links.sort(
      (a, b) =>
        (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt),
    );
    links = links.slice(0, limit);

    const propertyIds = [...new Set(links.map((l) => l.propertyId))];
    const properties = await Promise.all(propertyIds.map((id) => ctx.db.get(id)));
    const propMap = new Map(
      properties.filter(Boolean).map((p) => [p!._id, p!]),
    );

    const deals = links.map((link) => {
      const prop = propMap.get(link.propertyId);
      return {
        _id: link._id,
        token: link.token,
        contractCode: link.contractCode,
        stage: resolveStage(link),
        clientStep: link.clientStep,
        status: link.status,
        clientName: link.clientData?.nombre ?? null,
        clientPhone: link.clientData?.telefono ?? null,
        propertyTitle: (prop as { title?: string } | null)?.title ?? 'Propiedad',
        totalValue: link.totalValue,
        guests: link.guests,
        checkIn: link.checkIn,
        checkOut: link.checkOut,
        createdByName: link.createdByName ?? null,
        createdAt: link.createdAt,
        updatedAt: link.updatedAt,
      };
    });

    return { deals, stages: PIPELINE_STAGES };
  },
});

export const getPipelineStats = query({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query('saleLinks').collect();

    let totalValue = 0;
    let wonValue = 0;
    let lostCount = 0;
    const bySeller = new Map<string, number>();

    for (const link of all) {
      totalValue += link.totalValue;
      if (link.status === 'completed' || link.clientStep >= 6) {
        wonValue += link.totalValue;
      }
      if (link.status === 'cancelled') {
        lostCount++;
      }
      const seller = link.createdByName ?? 'Sin asignar';
      bySeller.set(seller, (bySeller.get(seller) ?? 0) + 1);
    }

    const conversionRate =
      all.length > 0
        ? all.filter((l) => l.status === 'completed' || l.clientStep >= 6)
            .length / all.length
        : 0;

    return {
      totalDeals: all.length,
      totalValue,
      wonValue,
      lostCount,
      conversionRate,
      bySeller: Object.fromEntries(bySeller),
    };
  },
});
