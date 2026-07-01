import { v } from 'convex/values';
import {
  internalMutation,
  internalQuery,
  mutation,
} from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { internal } from './_generated/api';
import {
  netPaidFromPayments,
  pendingFromTotal,
} from './lib/bookingPayments';
import {
  assertGuestListEditable,
  guestListLockInfo,
  isCheckinPortalClosed,
} from './lib/checkinGuestListLock';

/**
 * Portal público de check-in del turista (`/checkin/:reference`).
 *
 * El turista llega desde el botón de la plantilla de WhatsApp
 * `inicio_checkin_turista` (variable `linkCheckin`). No hay login: la "llave"
 * es la `reference` de la reserva (o, como respaldo, el `_id` del booking, igual
 * que arma el link `checkinMessaging.planSendsForMoment`).
 *
 * Soporta GUARDADO PARCIAL: el turista puede registrar algunos invitados hoy y
 * el resto otro día con el mismo link (no expira). El check-in solo se marca
 * como completado cuando hay al menos un invitado registrado y no se supera el
 * cupo contratado (validación en `submitCheckin`). Pueden registrarse menos
 * personas si parte del grupo ya no asiste.
 */

/** Forma del invitado tal como llega del portal / se guarda en la reserva. */
const GUEST_DOCUMENT_TYPES = new Set(['CC', 'TI', 'RC', 'CE', 'PA']);

const guestValidator = v.object({
  nombreCompleto: v.string(),
  cedula: v.optional(v.string()),
  tipoDocumento: v.optional(v.string()),
  esMenor: v.optional(v.boolean()),
});

type Guest = {
  nombreCompleto: string;
  cedula?: string;
  tipoDocumento?: string;
  esMenor?: boolean;
};

function normalizeGuestDocumentType(value: unknown): string {
  const upper = String(value ?? '')
    .trim()
    .toUpperCase();
  return GUEST_DOCUMENT_TYPES.has(upper) ? upper : 'CC';
}

const checkinExtrasValidator = {
  menoresDe2: v.optional(v.number()),
  placas: v.optional(v.string()),
  mascotas: v.optional(v.number()),
  observaciones: v.optional(v.string()),
  aceptaTratamientoDatos: v.optional(v.boolean()),
};

type CheckinExtrasArgs = {
  menoresDe2?: number;
  placas?: string;
  mascotas?: number;
  observaciones?: string;
  aceptaTratamientoDatos?: boolean;
  needsEmpleada?: boolean;
  needsTeam?: boolean;
  serviciosNota?: string;
};

function parseMenoresDe2(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

/** Campos del portal distintos de la lista de invitados. */
function buildCheckinExtrasPatch(args: CheckinExtrasArgs) {
  return {
    checkinNeedsEmpleada: args.needsEmpleada ?? false,
    checkinNeedsTeam: args.needsTeam ?? false,
    checkinServiciosNota: args.serviciosNota?.trim() || undefined,
    checkinMenoresDe2: parseMenoresDe2(args.menoresDe2),
    checkinPlacas: args.placas?.trim() || undefined,
    checkinMascotas:
      args.mascotas === undefined
        ? undefined
        : Math.max(0, Math.floor(Number(args.mascotas) || 0)),
    checkinObservaciones: args.observaciones?.trim() || undefined,
    checkinAceptaDatos:
      args.aceptaTratamientoDatos === undefined
        ? undefined
        : args.aceptaTratamientoDatos === true,
  };
}

/** Total de personas esperadas según la reserva (lo que se debe registrar). */
function expectedGuestCount(booking: Doc<'bookings'>): number {
  const base = Number(booking.numeroPersonas) || 0;
  return Math.max(base, 0);
}

/** Normaliza y valida la lista de invitados recibida del portal. */
function normalizeGuests(raw: unknown): { guests: Guest[]; error?: string } {
  if (!Array.isArray(raw)) return { guests: [] };
  const guests: Guest[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const nombreCompleto = String(obj.nombreCompleto ?? '').trim();
    const cedula = String(obj.cedula ?? '').trim();
    const tipoDocumento = normalizeGuestDocumentType(obj.tipoDocumento);
    const esMenor = Boolean(obj.esMenor);
    // Filas completamente vacías se ignoran (el turista deja un renglón en blanco).
    if (!nombreCompleto && !cedula && !esMenor) continue;
    guests.push({
      nombreCompleto,
      cedula: cedula || undefined,
      tipoDocumento: cedula ? tipoDocumento : undefined,
      esMenor: esMenor || undefined,
    });
  }
  return { guests };
}

/** Encuentra una reserva por `reference` y, si no, por `_id`. */
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

  // Respaldo: el link puede usar el `_id` cuando la reserva no tiene reference.
  try {
    const byId = await ctx.db.get(trimmed as Id<'bookings'>);
    if (byId && (byId as any).numeroPersonas !== undefined) {
      return byId as Doc<'bookings'>;
    }
  } catch {
    /* `key` no es un Id válido de Convex → no es match por id */
  }
  return null;
}

async function loadPropertyCoverImageUrl(
  ctx: { db: any },
  propertyId: Id<'properties'>,
): Promise<string | null> {
  const images = await ctx.db
    .query('propertyImages')
    .withIndex('by_property', (q: any) => q.eq('propertyId', propertyId))
    .collect();
  if (images.length === 0) return null;
  const sorted = images.sort(
    (a: Doc<'propertyImages'>, b: Doc<'propertyImages'>) =>
      (a.order ?? 0) - (b.order ?? 0),
  );
  const url = String(sorted[0]?.url ?? '').trim();
  return url || null;
}

async function loadCheckinLocationInfo(
  ctx: { db: any },
  propertyId: Id<'properties'>,
): Promise<{
  checkinUbicacionUrl: string | null;
  checkinWazeUrl: string | null;
  checkinIndicacionesLlegada: string | null;
  checkinRecomendaciones: string | null;
  checkinUbicacionImageUrl: string | null;
  checkinUbicacionImageUrls: string[];
}> {
  const ownerInfo = await ctx.db
    .query('propertyOwnerInfo')
    .withIndex('by_property', (q: any) => q.eq('propertyId', propertyId))
    .unique();
  const checkinUbicacionUrl = String(ownerInfo?.checkinUbicacionUrl ?? '').trim();
  const checkinWazeUrl = String(ownerInfo?.checkinWazeUrl ?? '').trim();
  const checkinIndicacionesLlegada = String(
    ownerInfo?.checkinIndicacionesLlegada ?? '',
  ).trim();
  const checkinRecomendaciones = String(
    ownerInfo?.checkinRecomendaciones ?? '',
  ).trim();
  const checkinUbicacionImageUrl = String(
    ownerInfo?.checkinUbicacionImageUrl ?? '',
  ).trim();
  // Galería: usa el array si existe; si no, cae al campo legacy (single).
  const rawUrls = Array.isArray(ownerInfo?.checkinUbicacionImageUrls)
    ? (ownerInfo.checkinUbicacionImageUrls as unknown[])
    : [];
  let checkinUbicacionImageUrls = rawUrls
    .map((u) => String(u ?? '').trim())
    .filter((u) => u.length > 0);
  if (checkinUbicacionImageUrls.length === 0 && checkinUbicacionImageUrl) {
    checkinUbicacionImageUrls = [checkinUbicacionImageUrl];
  }
  return {
    checkinUbicacionUrl: checkinUbicacionUrl || null,
    checkinWazeUrl: checkinWazeUrl || null,
    checkinIndicacionesLlegada: checkinIndicacionesLlegada || null,
    checkinRecomendaciones: checkinRecomendaciones || null,
    checkinUbicacionImageUrl:
      checkinUbicacionImageUrls[0] ?? (checkinUbicacionImageUrl || null),
    checkinUbicacionImageUrls,
  };
}

/** Resumen seguro (sin datos sensibles) + lo ya guardado, para precargar el portal. */
export const getForPortal = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    const booking = await findBooking(ctx, args.key);
    if (!booking) return null;

    if (isCheckinPortalClosed(booking.fechaSalida, booking.horaSalida)) {
      return { portalClosed: true as const };
    }

    const property = await ctx.db.get(booking.propertyId);

    const payments = await ctx.db
      .query('payments')
      .withIndex('by_booking', (q) => q.eq('bookingId', booking._id))
      .collect();
    const pagoTotal = netPaidFromPayments(payments);
    const precioTotal = Number(booking.precioTotal) || 0;
    const pagoPendiente = pendingFromTotal(precioTotal, pagoTotal);
    const checkinLocation = await loadCheckinLocationInfo(
      ctx,
      booking.propertyId,
    );
    const propertyCoverImageUrl = await loadPropertyCoverImageUrl(
      ctx,
      booking.propertyId,
    );

    const guestListLock = guestListLockInfo(
      booking.fechaEntrada,
      booking.fechaSalida,
      booking.horaEntrada,
      Date.now(),
      booking.guestListUnlocked,
    );

    return {
      reference: booking.reference ?? booking._id,
      nombreTitular: booking.nombreCompleto,
      propertyTitle: (property as { title?: string } | null)?.title ?? 'tu finca',
      propertyCoverImageUrl,
      propertyLocation:
        (property as { location?: string } | null)?.location ?? null,
      fechaEntrada: booking.fechaEntrada,
      fechaSalida: booking.fechaSalida,
      horaEntrada: booking.horaEntrada ?? null,
      horaSalida: booking.horaSalida ?? null,
      numeroPersonas: expectedGuestCount(booking),
      status: booking.status,
      checkinCompleted: booking.checkinCompleted === true,
      checkinUpdatedAt: booking.checkinUpdatedAt ?? null,
      guests: (booking.checkinGuests ?? []) as Guest[],
      menoresDe2: booking.checkinMenoresDe2 ?? 0,
      placas: booking.checkinPlacas ?? '',
      // Mascotas: la finca debe permitirlas; precarga lo confirmado o lo de la cotización.
      allowsPets:
        (property as { allowsPets?: boolean } | null)?.allowsPets === true,
      requiresGuestList:
        (property as { requiresGuestList?: boolean } | null)?.requiresGuestList !==
        false,
      mascotas:
        booking.checkinMascotas ??
        (Number(booking.numeroMascotas) || 0),
      observaciones: booking.checkinObservaciones ?? '',
      aceptaTratamientoDatos: booking.checkinAceptaDatos === true,
      needsEmpleada: booking.checkinNeedsEmpleada === true,
      needsTeam: booking.checkinNeedsTeam === true,
      serviciosNota: booking.checkinServiciosNota ?? '',
      precioTotal,
      pagoTotal,
      pagoPendiente,
      pagoCompleto: pagoPendiente <= 0,
      checkinUbicacionUrl: checkinLocation.checkinUbicacionUrl,
      checkinWazeUrl: checkinLocation.checkinWazeUrl,
      checkinIndicacionesLlegada: checkinLocation.checkinIndicacionesLlegada,
      checkinRecomendaciones: checkinLocation.checkinRecomendaciones,
      checkinUbicacionImageUrl: checkinLocation.checkinUbicacionImageUrl,
      checkinUbicacionImageUrls: checkinLocation.checkinUbicacionImageUrls,
      guestListLocked: guestListLock.guestListLocked,
      guestListLockHours: guestListLock.guestListLockHours,
      guestListLockAt: guestListLock.guestListLockAt,
    };
  },
});

/**
 * Guarda AVANCE PARCIAL del check-in (no valida cantidad, no marca completado).
 * Permite al turista llenar algunos invitados y continuar luego con el mismo link.
 */
export const saveDraft = internalMutation({
  args: {
    key: v.string(),
    guests: v.array(guestValidator),
    needsEmpleada: v.optional(v.boolean()),
    needsTeam: v.optional(v.boolean()),
    serviciosNota: v.optional(v.string()),
    ...checkinExtrasValidator,
  },
  handler: async (ctx, args) => {
    const booking = await findBooking(ctx, args.key);
    if (!booking) return { ok: false as const, reason: 'not_found' };

    if (isCheckinPortalClosed(booking.fechaSalida, booking.horaSalida)) {
      return { ok: false as const, reason: 'reservation_ended' };
    }

    const { guests } = normalizeGuests(args.guests);
    const lockReason = assertGuestListEditable(booking, guests);
    if (lockReason) return { ok: false as const, reason: lockReason };

    await ctx.db.patch(booking._id, {
      checkinGuests: guests,
      ...buildCheckinExtrasPatch(args),
      checkinUpdatedAt: Date.now(),
      updatedAt: Date.now(),
    });

    await ctx.runMutation(internal.saleLinks.syncCheckinFromBooking, {
      bookingId: booking._id,
      completed: false,
      guests,
      menoresDe2: parseMenoresDe2(args.menoresDe2),
      placas: args.placas,
      mascotas: args.mascotas,
      observaciones: args.observaciones,
    });

    return {
      ok: true as const,
      saved: guests.length,
      expected: expectedGuestCount(booking),
    };
  },
});

/**
 * ENVÍO FINAL del check-in: al menos un invitado, no más que el cupo contratado.
 * Cada mayor de 2 años debe tener nombre completo + cédula. Marca `checkinCompleted`.
 */
export const submitCheckin = internalMutation({
  args: {
    key: v.string(),
    guests: v.array(guestValidator),
    needsEmpleada: v.optional(v.boolean()),
    needsTeam: v.optional(v.boolean()),
    serviciosNota: v.optional(v.string()),
    ...checkinExtrasValidator,
  },
  handler: async (ctx, args) => {
    const booking = await findBooking(ctx, args.key);
    if (!booking) return { ok: false as const, reason: 'not_found' };

    if (isCheckinPortalClosed(booking.fechaSalida, booking.horaSalida)) {
      return { ok: false as const, reason: 'reservation_ended' };
    }

    const property = await ctx.db.get(booking.propertyId);
    const requiresGuestList =
      (property as { requiresGuestList?: boolean } | null)?.requiresGuestList !==
      false;

    if (args.aceptaTratamientoDatos !== true) {
      return { ok: false as const, reason: 'missing_data_consent' };
    }

    const { guests } = normalizeGuests(args.guests);
    const lockReason = assertGuestListEditable(booking, guests);
    if (lockReason) return { ok: false as const, reason: lockReason };

    const expected = expectedGuestCount(booking);

    if (requiresGuestList && guests.length < 1) {
      return { ok: false as const, reason: 'missing_guests' };
    }

    if (expected > 0 && guests.length > expected) {
      return {
        ok: false as const,
        reason: 'count_mismatch',
        expected,
        got: guests.length,
      };
    }

    // Cada persona necesita nombre; los mayores de 2 años, además, cédula.
    for (let i = 0; i < guests.length; i++) {
      const g = guests[i];
      if (!g.nombreCompleto) {
        return { ok: false as const, reason: 'missing_name', index: i };
      }
      if (!g.esMenor && !g.cedula) {
        return { ok: false as const, reason: 'missing_document', index: i };
      }
    }

    let observaciones = args.observaciones?.trim() || '';
    if (expected > 0 && guests.length < expected) {
      const note = `Personas que ingresan según check-in: ${guests.length} de ${expected} contratadas.`;
      observaciones = observaciones ? `${observaciones}\n${note}` : note;
    }

    const now = Date.now();
    await ctx.db.patch(booking._id, {
      checkinGuests: guests,
      ...buildCheckinExtrasPatch({
        ...args,
        observaciones,
        aceptaTratamientoDatos: true,
      }),
      checkinCompleted: true,
      checkinCompletedAt: now,
      checkinUpdatedAt: now,
      updatedAt: now,
    });

    await ctx.runMutation(internal.saleLinks.syncCheckinFromBooking, {
      bookingId: booking._id,
      completed: true,
      guests,
      menoresDe2: parseMenoresDe2(args.menoresDe2),
      placas: args.placas,
      mascotas: args.mascotas,
      observaciones,
    });

    return { ok: true as const, completed: true, total: guests.length };
  },
});

/**
 * Edición directa del equipo (admin): guarda la lista de invitados SIN el bloqueo
 * de las 24/12 h. La usa el panel admin cuando se autoriza un ajuste.
 */
export const adminSaveGuests = mutation({
  args: {
    bookingId: v.id('bookings'),
    guests: v.array(guestValidator),
  },
  handler: async (ctx, args) => {
    const booking = await ctx.db.get(args.bookingId);
    if (!booking) throw new Error('Reserva no encontrada');
    const { guests } = normalizeGuests(args.guests);
    const now = Date.now();
    await ctx.db.patch(args.bookingId, {
      checkinGuests: guests,
      checkinUpdatedAt: now,
      updatedAt: now,
    });
    return { ok: true as const, total: guests.length, guests };
  },
});
