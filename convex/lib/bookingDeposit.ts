import type { Doc } from '../_generated/dataModel';

type BookingDepositFields = Pick<
  Doc<'bookings'>,
  | 'depositoGarantia'
  | 'depositoMascotas'
  | 'depositoAseo'
  | 'precioTotal'
>;

/** Depósito reembolsable: campo guardado o inferido del total de la reserva. */
export function resolveRefundableDeposit(
  booking: BookingDepositFields,
  valorNetoAlquiler: number,
  propertyDefaultDeposit?: number | null,
): number {
  const garantia = Number(booking.depositoGarantia) || 0;
  const depositoMascotas = Number(booking.depositoMascotas) || 0;
  const aseo = Number(booking.depositoAseo) || 0;
  const total = Number(booking.precioTotal) || 0;
  const neto = Math.max(0, Number(valorNetoAlquiler) || 0);

  let resolved = garantia;
  if (depositoMascotas > 0) {
    if (resolved <= 0) {
      resolved = depositoMascotas;
    } else if (Math.abs(depositoMascotas - resolved) > 1000) {
      resolved += depositoMascotas;
    }
  }

  if (resolved <= 0 && total > 0 && neto > 0) {
    resolved = Math.max(0, total - neto - aseo);
  }

  if (resolved <= 0 && propertyDefaultDeposit != null) {
    const fallback = Number(propertyDefaultDeposit) || 0;
    if (fallback > 0) resolved = fallback;
  }

  return resolved;
}
