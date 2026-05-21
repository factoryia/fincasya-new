/** Valores por defecto si aún no hay snapshot en Convex. */
export const DEFAULT_CONTRACT_ADMIN = {
  adminName: 'HERNÁN AGUILERA GÓMEZ',
  adminCedula: '81.720.077',
  adminCity: 'Chía (Cund)',
  cleaningFee: '$100.000',
  extraPersonFee: '$50.000',
  petDeposit: '$200.000',
  securityDeposit: '$200.000',
} as const;

export type ContractAdminSettings = {
  adminName?: string;
  adminCedula?: string;
  adminCity?: string;
  cleaningFee?: string;
  extraPersonFee?: string;
  petDeposit?: string;
  securityDeposit?: string;
};

export type PropertyContractOwnerOverride = {
  nombreCompleto?: string;
  cedula?: string;
  ciudadCedula?: string;
};

export function parseContractSettingsPayload(payload: unknown): {
  admin: ContractAdminSettings;
  ownerOverrides: Record<string, PropertyContractOwnerOverride>;
} {
  if (!payload || typeof payload !== 'object') {
    return { admin: { ...DEFAULT_CONTRACT_ADMIN }, ownerOverrides: {} };
  }
  const o = payload as Record<string, unknown>;
  const rawAdmin = o.adminSettings;
  const admin: ContractAdminSettings =
    rawAdmin && typeof rawAdmin === 'object'
      ? { ...(rawAdmin as ContractAdminSettings) }
      : { ...DEFAULT_CONTRACT_ADMIN };
  const ownerOverrides =
    o.propertyContractOwnerOverrides &&
    typeof o.propertyContractOwnerOverrides === 'object'
      ? (o.propertyContractOwnerOverrides as Record<
          string,
          PropertyContractOwnerOverride
        >)
      : {};
  return { admin, ownerOverrides };
}

export function formatFincaFeaturesPlain(features: unknown[]): string {
  if (!features?.length) return '';
  return features
    .map((f) => {
      if (typeof f === 'string') return f.trim();
      if (f && typeof f === 'object') {
        const row = f as { name?: string; label?: string; quantity?: number };
        const name = (row.name || row.label || '').trim();
        if (!name) return '';
        const qty = row.quantity != null && row.quantity > 1 ? ` (${row.quantity})` : '';
        return `${name}${qty}`;
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

export function formatCopLabel(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return '';
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
  }).format(Math.round(amount));
}
