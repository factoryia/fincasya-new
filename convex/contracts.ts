import { v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import { mutation, query } from './_generated/server';

/** Orden de avance del contrato; al fusionar, gana el estado más avanzado. */
const ESTADO_RANK: Record<string, number> = {
  anulado: 0,
  borrador: 1,
  expirado: 2,
  generado: 3,
  enviado: 4,
  completado: 5,
  pagado: 6,
};

function rank(estado?: string): number {
  return ESTADO_RANK[String(estado ?? '').toLowerCase()] ?? 0;
}

type ContractFields = {
  contractNumber: string;
  propertyId?: Id<'properties'>;
  propertyTitle?: string;
  propertyLocation?: string;
  clienteNombre?: string;
  clienteCedula?: string;
  clienteEmail?: string;
  clienteTelefono?: string;
  clienteCiudad?: string;
  clienteDireccion?: string;
  firmanteNombre?: string;
  firmanteCedula?: string;
  valorTotal?: number;
  fechaEntrada?: string;
  fechaSalida?: string;
  pdfUrl?: string;
  pdfFilename?: string;
  estado?: string;
  origen?: string;
  bookingId?: Id<'bookings'>;
  fillTokenId?: Id<'contractFillTokens'>;
  draftJson?: string;
};

/** Extrae { code, url } del contrato adjunto en la multimedia de una reserva. */
function extractContractPdfFromMultimedia(
  multimedia?: Array<{ name?: string; url?: string }> | null,
): { code: string; url?: string } | null {
  for (const m of multimedia ?? []) {
    const name = m.name ?? '';
    const match =
      name.match(/^Contrato[_\s-]+(.+?)\.pdf$/i) ??
      name.match(/^Contrato[_\s-]+(.+?)\.docx$/i);
    if (match?.[1]?.trim()) {
      return { code: match[1].trim(), url: m.url };
    }
  }
  return null;
}

/** Upsert idempotente por contractNumber: solo pisa campos provistos y avanza el estado. */
async function upsertContract(
  ctx: any,
  fields: ContractFields,
): Promise<void> {
  const num = fields.contractNumber.trim();
  if (!num) return;
  const now = Date.now();

  const existing = await ctx.db
    .query('contracts')
    .withIndex('by_contract_number', (q: any) =>
      q.eq('contractNumber', num),
    )
    .first();

  const cleaned: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(fields)) {
    if (k === 'contractNumber' || k === 'estado') continue;
    if (val !== undefined && val !== null && val !== '') cleaned[k] = val;
  }

  if (!existing) {
    await ctx.db.insert('contracts', {
      contractNumber: num,
      estado: fields.estado || 'generado',
      createdAt: now,
      updatedAt: now,
      ...cleaned,
    });
    return;
  }

  const nextEstado =
    fields.estado && rank(fields.estado) >= rank(existing.estado)
      ? fields.estado
      : existing.estado;

  await ctx.db.patch(existing._id, {
    ...cleaned,
    estado: nextEstado,
    updatedAt: now,
  });
}

export const upsert = mutation({
  args: {
    contractNumber: v.string(),
    propertyId: v.optional(v.id('properties')),
    propertyTitle: v.optional(v.string()),
    propertyLocation: v.optional(v.string()),
    clienteNombre: v.optional(v.string()),
    clienteCedula: v.optional(v.string()),
    clienteEmail: v.optional(v.string()),
    clienteTelefono: v.optional(v.string()),
    clienteCiudad: v.optional(v.string()),
    clienteDireccion: v.optional(v.string()),
    firmanteNombre: v.optional(v.string()),
    firmanteCedula: v.optional(v.string()),
    valorTotal: v.optional(v.number()),
    fechaEntrada: v.optional(v.string()),
    fechaSalida: v.optional(v.string()),
    pdfUrl: v.optional(v.string()),
    pdfFilename: v.optional(v.string()),
    estado: v.optional(v.string()),
    origen: v.optional(v.string()),
    bookingId: v.optional(v.id('bookings')),
    fillTokenId: v.optional(v.id('contractFillTokens')),
    draftJson: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await upsertContract(ctx, args as ContractFields);
    return { ok: true };
  },
});

export const updateStatus = mutation({
  args: { contractNumber: v.string(), estado: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('contracts')
      .withIndex('by_contract_number', (q) =>
        q.eq('contractNumber', args.contractNumber.trim()),
      )
      .first();
    if (!existing) return { ok: false };
    await ctx.db.patch(existing._id, {
      estado: args.estado,
      updatedAt: Date.now(),
    });
    return { ok: true };
  },
});

export const get = query({
  args: { contractNumber: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('contracts')
      .withIndex('by_contract_number', (q) =>
        q.eq('contractNumber', args.contractNumber.trim()),
      )
      .first();
  },
});

export const list = query({
  args: {
    estado: v.optional(v.string()),
    origen: v.optional(v.string()),
    propertyId: v.optional(v.id('properties')),
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
    page: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 20, 1), 100);
    const page = Math.max(args.page ?? 1, 1);
    const search = (args.search ?? '').trim().toLowerCase();

    let all = await ctx.db
      .query('contracts')
      .withIndex('by_created')
      .order('desc')
      .take(5000);

    if (args.estado && args.estado !== 'todos') {
      all = all.filter((c) => c.estado === args.estado);
    }
    if (args.origen) all = all.filter((c) => c.origen === args.origen);
    if (args.propertyId)
      all = all.filter((c) => c.propertyId === args.propertyId);
    if (search) {
      all = all.filter(
        (c) =>
          c.contractNumber.toLowerCase().includes(search) ||
          (c.clienteNombre ?? '').toLowerCase().includes(search) ||
          (c.propertyTitle ?? '').toLowerCase().includes(search),
      );
    }

    all.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));

    const counts: Record<string, number> = {};
    for (const c of all) counts[c.estado] = (counts[c.estado] ?? 0) + 1;

    const total = all.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const safePage = Math.min(page, totalPages);
    const offset = (safePage - 1) * limit;

    return {
      items: all.slice(offset, offset + limit),
      total,
      page: safePage,
      limit,
      totalPages,
      counts,
    };
  },
});

/**
 * Reconstruye la tabla `contracts` desde las fuentes históricas:
 * adminContractSnapshots (borradores), contractFillTokens (links) y bookings
 * (reservas con contrato). Idempotente: se puede correr varias veces.
 */
export const backfill = mutation({
  args: {},
  handler: async (ctx) => {
    let procesados = 0;

    // Cache de fincas para no re-leer la misma propiedad muchas veces.
    const propCache = new Map<
      string,
      { title?: string; location?: string } | null
    >();
    const getProp = async (id?: Id<'properties'> | null) => {
      if (!id) return null;
      const key = String(id);
      if (propCache.has(key)) return propCache.get(key) ?? null;
      const prop = (await ctx.db.get(id)) as {
        title?: string;
        location?: string;
      } | null;
      propCache.set(key, prop);
      return prop;
    };

    // 1) Borradores admin (Contratos y Confirmación) → generado.
    const snapshots = await ctx.db.query('adminContractSnapshots').collect();
    for (const s of snapshots) {
      const prop = await getProp(s.propertyId);
      const p = (s.payload ?? {}) as Record<string, any>;
      await upsertContract(ctx, {
        contractNumber: s.contractNumber,
        propertyId: s.propertyId,
        propertyTitle: prop?.title,
        propertyLocation: prop?.location,
        clienteNombre: p.nombreCompleto,
        clienteCedula: p.cedula,
        clienteEmail: p.correo,
        clienteTelefono: p.celular,
        valorTotal: Number(p.precioTotal) || undefined,
        fechaEntrada: p.fechaEntrada ? String(p.fechaEntrada) : undefined,
        fechaSalida: p.fechaSalida ? String(p.fechaSalida) : undefined,
        estado: 'generado',
        origen: 'confirmacion',
        draftJson: JSON.stringify(p),
      });
      procesados++;
    }

    // 2) Links de contrato → enviado / completado / expirado.
    const tokens = await ctx.db.query('contractFillTokens').collect();
    for (const t of tokens) {
      let draft: Record<string, any> | null = null;
      if (t.contractDraftJson) {
        try {
          draft = JSON.parse(t.contractDraftJson);
        } catch {
          draft = null;
        }
      }
      const code = String(draft?.contractNumber ?? '').trim();
      if (!code) continue;
      const propId = (draft?.propertyId as Id<'properties'>) || undefined;
      const prop = await getProp(propId);
      const estado =
        t.status === 'filled'
          ? 'completado'
          : t.status === 'expired'
            ? 'expirado'
            : 'enviado';
      await upsertContract(ctx, {
        contractNumber: code,
        propertyId: propId,
        propertyTitle: prop?.title ?? t.propertyTitle,
        propertyLocation: prop?.location ?? t.propertyLocation,
        clienteNombre: t.filledData?.nombre,
        clienteCedula: t.filledData?.cedula,
        clienteEmail: t.filledData?.email,
        clienteTelefono: t.filledData?.telefono,
        clienteCiudad: t.filledData?.ciudad,
        clienteDireccion: t.filledData?.direccion,
        firmanteNombre: draft?.adminName,
        firmanteCedula: draft?.adminCedula,
        valorTotal: Number(draft?.contractTotal) || t.precioTotal || undefined,
        fechaEntrada: t.fechaEntrada,
        fechaSalida: t.fechaSalida,
        estado,
        origen: t.source === 'inbox' ? 'inbox' : 'link',
        fillTokenId: t._id,
        draftJson: t.contractDraftJson ?? undefined,
      });
      procesados++;
    }

    // 3) Reservas con contrato adjunto → pagado.
    const bookings = await ctx.db.query('bookings').order('desc').take(3000);
    for (const b of bookings) {
      const pdf = extractContractPdfFromMultimedia(b.multimedia);
      const code = (pdf?.code || (b.reference ?? '').trim()).trim();
      if (!code) continue;
      const prop = await getProp(b.propertyId ?? undefined);
      await upsertContract(ctx, {
        contractNumber: code,
        propertyId: b.propertyId ?? undefined,
        propertyTitle: prop?.title,
        propertyLocation: prop?.location,
        clienteNombre: b.nombreCompleto,
        clienteCedula: b.cedula,
        clienteEmail: b.correo,
        clienteTelefono: b.celular,
        valorTotal: Number(b.precioTotal) || undefined,
        fechaEntrada: b.fechaEntrada ? String(b.fechaEntrada) : undefined,
        fechaSalida: b.fechaSalida ? String(b.fechaSalida) : undefined,
        pdfUrl: pdf?.url,
        pdfFilename: pdf ? `Contrato_${pdf.code}.pdf` : undefined,
        estado: 'pagado',
        origen: 'confirmacion',
        bookingId: b._id,
      });
      procesados++;
    }

    return { ok: true, procesados };
  },
});
