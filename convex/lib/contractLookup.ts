/** Misma lógica que `FincasYaWeb/lib/normalize-contract-lookup.ts` (Convex no importa desde Next). */
export function normalizeContractLookupQueryConvex(raw: string): string {
  let s = raw.trim().replace(/\s+/g, ' ');
  if (!s) return '';

  s = s.replace(/^contrato\s*:\s*/i, '').trim();
  s = s.replace(/^contrato\s+n[°º\u00b0oO0.]\s*/i, '').trim();
  s = s.replace(/^n[°º\u00b0oO0.]\s*/i, '').trim();

  const codeLike = s.match(
    /\b([A-Za-z]{2,12}-\d{2,}(?:-\d+){0,4}|[A-Za-z]{2,12}-\d{4,}(?:-\w+){0,3})\b/,
  );
  if (codeLike && (s.length > 28 || /reunidos|arriendo|contrato/i.test(s))) {
    return codeLike[1].trim();
  }

  return s.trim() || raw.trim();
}
