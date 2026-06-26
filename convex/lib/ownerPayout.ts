export type OwnerPayoutAbono = {
  id: string;
  amount: number;
  fecha?: string;
  medio?: string;
  comprobanteUrl?: string;
  createdAt: number;
  actor?: string;
};

export type OwnerPayoutRecord = {
  valorAcordado?: number;
  abono?: number;
  valor?: number;
  fecha?: string;
  medio?: string;
  comprobanteUrl?: string;
  updatedAt?: number;
  abonos?: OwnerPayoutAbono[];
  log?: Array<{ accion: string; actor: string; ts: number }>;
};

export function normalizeOwnerAbonos(
  prev: OwnerPayoutRecord | undefined | null,
  bookingId: string,
  fallbackTs = Date.now(),
): OwnerPayoutAbono[] {
  if (!prev) return [];
  if (Array.isArray(prev.abonos) && prev.abonos.length > 0) {
    return [...prev.abonos];
  }
  const legacyAmount =
    (typeof prev.abono === 'number' && prev.abono > 0
      ? prev.abono
      : undefined) ??
    (typeof prev.valor === 'number' && prev.valor > 0 ? prev.valor : undefined);
  if (legacyAmount == null || legacyAmount <= 0) return [];
  return [
    {
      id: `legacy-${bookingId}`,
      amount: legacyAmount,
      fecha: prev.fecha,
      medio: prev.medio,
      comprobanteUrl: prev.comprobanteUrl,
      createdAt: prev.updatedAt ?? fallbackTs,
      actor: 'Migrado',
    },
  ];
}

export function sumOwnerAbonos(abonos: OwnerPayoutAbono[]): number {
  return abonos.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
}

export function buildOwnerPayoutFromAbonos(
  prev: OwnerPayoutRecord,
  abonos: OwnerPayoutAbono[],
  ts: number,
  logEntry: { accion: string; actor: string; ts: number },
): OwnerPayoutRecord {
  const totalAbono = sumOwnerAbonos(abonos);
  const last = abonos[abonos.length - 1];
  const prevLog = Array.isArray(prev.log) ? prev.log : [];
  return {
    valorAcordado: prev.valorAcordado,
    abono: totalAbono > 0 ? totalAbono : undefined,
    abonos: abonos.length > 0 ? abonos : undefined,
    valor: last?.amount ?? prev.valor,
    fecha: last?.fecha ?? prev.fecha,
    medio: last?.medio ?? prev.medio,
    comprobanteUrl: last?.comprobanteUrl ?? prev.comprobanteUrl,
    updatedAt: ts,
    log: [...prevLog, logEntry].slice(-30),
  };
}
