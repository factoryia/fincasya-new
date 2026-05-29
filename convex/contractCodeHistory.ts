import { v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import { query } from './_generated/server';
import { normalizeContractLookupQueryConvex } from './lib/contractLookup';

type ContractDraftPayload = {
  propertyId?: string;
  contractNumber?: string;
};

type HistoryItem = {
  contractNumber: string;
  source: 'draft' | 'booking' | 'link';
  propertyId: string;
  propertyTitle: string;
  propertyCode: string;
  clientName: string;
  createdAt: number;
  status: string;
};

function extractContractFromObs(obs?: string | null): string | null {
  if (!obs) return null;
  const m = obs.match(/contrato\s*:\s*([^\s\n\r]+)/i);
  return m?.[1]?.trim() ?? null;
}

/** Extrae códigos tipo DIR-…, CFINCA-01, FY-2005 del texto libre. */
function extractContractCodesFromText(text: string): string[] {
  const found = new Set<string>();
  const trimmed = text.trim();
  if (!trimmed) return [];

  const fromLabel = extractContractFromObs(trimmed);
  if (fromLabel) found.add(fromLabel);

  const patterns = trimmed.match(
    /\b(DIR-[A-Za-z0-9][A-Za-z0-9_-]{2,48}|C[A-Z0-9][A-Z0-9_-]{1,20}-\d{1,4}|FY-\d{2,})\b/g,
  );
  for (const p of patterns ?? []) found.add(p);

  return [...found];
}

function extractFromMultimedia(
  multimedia?: Array<{ name?: string }> | null,
): string[] {
  const found: string[] = [];
  for (const m of multimedia ?? []) {
    const name = m.name ?? '';
    const match =
      name.match(/^Contrato[_\s-]+(.+?)\.pdf$/i) ??
      name.match(/^Contrato[_\s-]+(.+?)\.docx$/i);
    if (match?.[1]?.trim()) found.push(match[1].trim());
  }
  return found;
}

export const list = query({
  args: {
    propertyId: v.optional(v.id('properties')),
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
    page: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 20, 1), 100);
    const page = Math.max(args.page ?? 1, 1);
    const search = (args.search ?? '').trim().toLowerCase();
    const byNumber = new Map<string, HistoryItem>();

    const upsert = (item: HistoryItem) => {
      const key = item.contractNumber.trim().toLowerCase();
      if (!key) return;
      const prev = byNumber.get(key);
      if (!prev || item.createdAt >= prev.createdAt) {
        byNumber.set(key, item);
      }
    };

    const addCode = (input: {
      rawCode: string;
      source: HistoryItem['source'];
      propertyId: string;
      propertyTitle: string;
      propertyCode: string;
      clientName: string;
      createdAt: number;
      status: string;
    }) => {
      const normalized =
        normalizeContractLookupQueryConvex(input.rawCode) ||
        input.rawCode.trim();
      if (!normalized) return;
      upsert({
        contractNumber: normalized,
        source: input.source,
        propertyId: input.propertyId,
        propertyTitle: input.propertyTitle,
        propertyCode: input.propertyCode,
        clientName: input.clientName,
        createdAt: input.createdAt,
        status: input.status,
      });
    };

    // 1) Borradores admin (Contratos y Confirmación)
    const snapshots = await ctx.db.query('adminContractSnapshots').collect();
    for (const s of snapshots) {
      if (args.propertyId && s.propertyId !== args.propertyId) continue;
      const property = await ctx.db.get(s.propertyId);
      const prop = property as { title?: string; code?: string } | null;
      const p = (s.payload ?? {}) as Record<string, unknown>;
      const base = {
        source: 'draft' as const,
        propertyId: String(s.propertyId),
        propertyTitle: prop?.title ?? '',
        propertyCode: prop?.code ?? '',
        clientName: String(p.nombreCompleto ?? ''),
        createdAt: s.createdAt,
        status: 'Borrador',
      };
      addCode({ ...base, rawCode: s.contractNumber });
      const ref = String(p.reference ?? '').trim();
      if (ref) addCode({ ...base, rawCode: ref });
    }

    // 2) Links de contrato (admin / inbox)
    const linkTokens = await ctx.db.query('contractFillTokens').collect();
    for (const t of linkTokens) {
      let draft: ContractDraftPayload | null = null;
      if (t.contractDraftJson) {
        try {
          draft = JSON.parse(t.contractDraftJson) as ContractDraftPayload;
        } catch {
          draft = null;
        }
      }

      const draftPropertyId = draft?.propertyId ?? '';
      if (args.propertyId && draftPropertyId && draftPropertyId !== args.propertyId) {
        continue;
      }

      let propertyTitle = t.propertyTitle ?? '';
      let propertyCode = '';
      if (draftPropertyId) {
        const property = await ctx.db.get(
          draftPropertyId as Id<'properties'>,
        );
        const prop = property as { title?: string; code?: string } | null;
        propertyTitle = prop?.title ?? propertyTitle;
        propertyCode = prop?.code ?? '';
      }

      const clientName = t.filledData?.nombre?.trim() || '(pendiente cliente)';
      const status =
        t.status === 'filled'
          ? 'Link completado'
          : t.status === 'expired'
            ? 'Link expirado'
            : 'Link activo';

      const code = draft?.contractNumber?.trim();
      if (!code) continue;

      addCode({
        rawCode: code,
        source: 'link',
        propertyId: draftPropertyId,
        propertyTitle,
        propertyCode,
        clientName,
        createdAt: t.filledData?.filledAt ?? t.createdAt,
        status,
      });
    }

    // 3) Reservas con reference / observaciones / PDF adjunto
    const bookings = await ctx.db.query('bookings').order('desc').take(3000);
    for (const b of bookings) {
      if (args.propertyId && b.propertyId !== args.propertyId) continue;
      const property = b.propertyId ? await ctx.db.get(b.propertyId) : null;
      const prop = property as { title?: string; code?: string } | null;
      const base = {
        source: 'booking' as const,
        propertyId: String(b.propertyId ?? ''),
        propertyTitle: prop?.title ?? '',
        propertyCode: prop?.code ?? '',
        clientName: String(b.nombreCompleto ?? ''),
        createdAt: b.createdAt ?? 0,
        status: String(b.status ?? 'RESERVA'),
      };

      const codes = new Set<string>();
      if ((b.reference ?? '').trim()) codes.add((b.reference ?? '').trim());
      for (const c of extractContractCodesFromText(b.observaciones ?? '')) {
        codes.add(c);
      }
      for (const c of extractFromMultimedia(b.multimedia)) codes.add(c);

      for (const rawCode of codes) {
        addCode({ ...base, rawCode });
      }
    }

    const allSorted = Array.from(byNumber.values()).sort(
      (a, b) => b.createdAt - a.createdAt,
    );
    const codesForSuggestion = allSorted.map((i) => i.contractNumber);

    let filtered = allSorted;
    if (search) {
      filtered = filtered.filter(
        (i) =>
          i.contractNumber.toLowerCase().includes(search) ||
          i.clientName.toLowerCase().includes(search) ||
          i.propertyTitle.toLowerCase().includes(search) ||
          i.propertyCode.toLowerCase().includes(search),
      );
    }

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const safePage = Math.min(page, totalPages);
    const offset = (safePage - 1) * limit;

    return {
      items: filtered.slice(offset, offset + limit),
      total,
      page: safePage,
      limit,
      totalPages,
      codesForSuggestion,
    };
  },
});
