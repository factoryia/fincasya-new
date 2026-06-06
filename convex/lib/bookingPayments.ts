/** Utilidades compartidas para calcular abonos de una reserva. */

export function isPaidPaymentStatus(status: string | undefined): boolean {
  const s = String(status ?? '').toLowerCase();
  return s === 'paid' || s === 'pagado' || s === 'approved' || s === 'aprobado';
}

export function netPaidFromPayments(
  payments: Array<{ type: string; amount: number; status?: string }>,
): number {
  return payments.reduce((sum, p) => {
    if (!isPaidPaymentStatus(p.status)) return sum;
    const amt = Number(p.amount) || 0;
    return p.type === 'REEMBOLSO' ? sum - amt : sum + amt;
  }, 0);
}

export function pendingFromTotal(
  precioTotal: number,
  netPaid: number,
): number {
  return Math.max(0, (Number(precioTotal) || 0) - netPaid);
}

export function deriveBookingPaymentStatus(
  precioTotal: number,
  netPaid: number,
): 'PENDING' | 'PARTIAL' | 'PAID' | 'REFUNDED' {
  if (netPaid < 0) return 'REFUNDED';
  if (netPaid <= 0) return 'PENDING';
  if (netPaid >= precioTotal) return 'PAID';
  return 'PARTIAL';
}
