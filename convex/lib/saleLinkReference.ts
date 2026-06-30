import type { Doc } from '../_generated/dataModel';

/** Normaliza la codificación manual (CR / contrato). */
export function normalizeContractCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

/** Referencia usada en contrato, CR y reserva. */
export function resolveSaleLinkReference(
  link: Pick<Doc<'saleLinks'>, 'contractCode' | 'token'>,
): string {
  const manual = link.contractCode?.trim();
  if (manual) return normalizeContractCode(manual);
  return `VL-${link.token.slice(0, 8).toUpperCase()}`;
}
