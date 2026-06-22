import { internalMutation, internalQuery } from './_generated/server';
import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';

/**
 * Portal público de check-out del cliente (`/checkout/:reference`).
 * Muestra reglas de salida + estado del depósito y captura la cuenta bancaria
 * para la devolución. El link NO expira y se puede reabrir/actualizar.
 */

/** Reglas de salida por defecto (si la finca no tiene texto propio). */
const DEFAULT_CHECKOUT_RULES = [
  'La hora máxima de salida es a las 4:00 PM. Las salidas posteriores podrán generar cobros adicionales según las políticas de la reserva.',
  'Entrega el inmueble ordenado y con la basura recogida.',
  'Reporta cualquier daño o novedad antes de salir.',
  'Deja las llaves donde indique la administración.',
].join('\n');

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
  try {
    const byId = await ctx.db.get(trimmed as Id<'bookings'>);
    if (byId && (byId as any).numeroPersonas !== undefined) {
      return byId as Doc<'bookings'>;
    }
  } catch {
    /* key no es Id válido */
  }
  return null;
}

const ESTADO_LABELS: Record<string, string> = {
  pendiente_validacion: 'Pendiente de validación',
  aprobado: 'Aprobado',
  rechazado: 'Con observaciones',
  en_revision: 'En revisión',
};

/** Datos para el portal de check-out del cliente. */
export const getForPortal = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    const booking = await findBooking(ctx, args.key);
    if (!booking) return null;

    const property = await ctx.db.get(booking.propertyId);
    const reglas =
      String((property as any)?.checkoutRulesText ?? '').trim() ||
      DEFAULT_CHECKOUT_RULES;

    const dr = (booking.depositReturn ?? {}) as Doc<'bookings'>['depositReturn'];
    const estado = dr?.estado || 'pendiente_validacion';

    return {
      reference: booking.reference ?? booking._id,
      propertyTitle:
        (property as { title?: string } | null)?.title ?? 'tu finca',
      propertyLocation:
        (property as { location?: string } | null)?.location ?? null,
      nombreTitular: booking.nombreCompleto ?? null,
      fechaSalida: booking.fechaSalida,
      horaSalida: booking.horaSalida ?? null,
      reglas,
      depositoGarantia: Number(booking.depositoGarantia) || 0,
      depositoRegistradoEn: booking._creationTime,
      depositoEstado: estado,
      depositoEstadoLabel: ESTADO_LABELS[estado] || ESTADO_LABELS.pendiente_validacion,
      // Cuenta ya registrada (para precargar el formulario).
      cuenta: dr?.cuenta ?? null,
      // Devolución (Fase 3) — lo que el cliente puede ver.
      devolucion: dr?.devolucion
        ? {
            valor:
              typeof dr.devolucion.valor === 'number'
                ? dr.devolucion.valor
                : null,
            fecha: dr.devolucion.fecha ?? null,
            medio: dr.devolucion.medio ?? null,
            comprobanteUrl: dr.devolucion.comprobanteUrl ?? null,
            observaciones: dr.devolucion.observaciones ?? null,
          }
        : null,
      valorRetenido:
        typeof dr?.retencion?.valorRetenido === 'number'
          ? dr.retencion.valorRetenido
          : null,
    };
  },
});

/** Guarda/actualiza la cuenta bancaria del cliente para la devolución del depósito. */
export const saveDepositAccount = internalMutation({
  args: {
    key: v.string(),
    cuenta: v.object({
      titular: v.optional(v.string()),
      tipo: v.optional(v.string()),
      numero: v.optional(v.string()),
      banco: v.optional(v.string()),
      documento: v.optional(v.string()),
      observaciones: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    const booking = await findBooking(ctx, args.key);
    if (!booking) return { ok: false as const, reason: 'not_found' };

    const prev = (booking.depositReturn ?? {}) as NonNullable<
      Doc<'bookings'>['depositReturn']
    >;
    const prevLog = Array.isArray(prev.log) ? prev.log : [];
    const ts = Date.now();
    const clean = (s?: string) => String(s ?? '').trim() || undefined;

    await ctx.db.patch(booking._id, {
      depositReturn: {
        estado: prev.estado || 'pendiente_validacion',
        cuenta: {
          titular: clean(args.cuenta.titular),
          tipo: clean(args.cuenta.tipo),
          numero: clean(args.cuenta.numero),
          banco: clean(args.cuenta.banco),
          documento: clean(args.cuenta.documento),
          observaciones: clean(args.cuenta.observaciones),
        },
        updatedAt: ts,
        log: [
          ...prevLog,
          {
            accion: 'Cuenta de devolución registrada por el cliente',
            actor: 'Cliente',
            ts,
          },
        ].slice(-30),
      },
      updatedAt: ts,
    });
    return { ok: true as const };
  },
});
