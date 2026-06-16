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

export type ContractBankAccountInput = {
  id?: string;
  bankName?: string;
  accountType?: string;
  accountNumber?: string;
  ownerName?: string;
  ownerCedula?: string;
};

export function parseContractSettingsPayload(payload: unknown): {
  admin: ContractAdminSettings;
  ownerOverrides: Record<string, PropertyContractOwnerOverride>;
  bankAccounts: ContractBankAccountInput[];
  contractBankAccountIds: string[];
  primaryBankAccountId: string | null;
} {
  if (!payload || typeof payload !== 'object') {
    return {
      admin: { ...DEFAULT_CONTRACT_ADMIN },
      ownerOverrides: {},
      bankAccounts: [],
      contractBankAccountIds: [],
      primaryBankAccountId: null,
    };
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
  const bankAccounts = Array.isArray(o.bankAccounts)
    ? (o.bankAccounts as ContractBankAccountInput[])
    : [];
  const contractBankAccountIds = Array.isArray(o.contractBankAccountIds)
    ? (o.contractBankAccountIds as string[])
    : [];
  const primaryBankAccountId =
    typeof o.primaryBankAccountId === 'string' && o.primaryBankAccountId.trim()
      ? o.primaryBankAccountId.trim()
      : null;
  return {
    admin,
    ownerOverrides,
    bankAccounts,
    contractBankAccountIds,
    primaryBankAccountId,
  };
}

/** Agrupa características por nombre y suma `quantity` (o 1 por fila). */
export function aggregatePropertyFeatureCounts(
  features: unknown[],
): Array<{ name: string; count: number }> {
  if (!features?.length) return [];

  const counts = new Map<string, number>();
  for (const f of features) {
    const name = (
      typeof f === 'string'
        ? f
        : (f as { name?: string; label?: string }).name ||
          (f as { label?: string }).label ||
          ''
    )
      .trim()
      .toUpperCase();
    if (!name) continue;
    const qty =
      f && typeof f === 'object' && (f as { quantity?: number }).quantity != null
        ? Math.max(1, Number((f as { quantity?: number }).quantity) || 1)
        : 1;
    counts.set(name, (counts.get(name) ?? 0) + qty);
  }

  return Array.from(counts.entries()).map(([name, count]) => ({ name, count }));
}

/** Lista numerada vertical (Word / catálogo Meta): una línea por ítem. */
export function formatFincaFeaturesPlain(features: unknown[]): string {
  const items = aggregatePropertyFeatureCounts(features);
  if (!items.length) return '';

  return items
    .map(({ name, count }, i) => {
      const suffix = count > 1 ? ` (x${count})` : '';
      return `${i + 1}. ${name}${suffix}`;
    })
    .join('\n');
}

/** Etiqueta COP para cláusulas; evita "0" si el formulario viene vacío. */
export function resolveContractMoneyLabel(
  amountCop: number | undefined,
  labelFromForm: string | undefined,
  fallback: string,
): string {
  if (amountCop != null && Number.isFinite(amountCop) && amountCop > 0) {
    return formatCopLabel(amountCop);
  }
  const label = (labelFromForm ?? '').trim();
  const digits = label.replace(/\D/g, '');
  if (label && digits.length > 0 && parseInt(digits, 10) > 0) {
    return label;
  }
  return fallback;
}

export function formatCopLabel(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return '';
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
  }).format(Math.round(amount));
}

/** Texto plano de cuentas para plantilla Word (varias cuentas). */
export function buildBankAccountsPlainSnippet(
  bankAccounts: ContractBankAccountInput[],
  selectedIds: string[],
  fallback?: {
    accountNumber?: string;
    bankName?: string;
    ownerName?: string;
    ownerCedula?: string;
  },
): string {
  const selected = bankAccounts.filter(
    (a) => a.id && selectedIds.includes(String(a.id)),
  );
  if (selected.length === 0 && fallback) {
    const bankLabel = fallback.bankName?.trim() || '';
    const num = fallback.accountNumber?.trim() || '';
    const holder = fallback.ownerName?.trim() || '';
    const cedula = fallback.ownerCedula?.trim() || '';
    if (num || bankLabel) {
      return `${bankLabel} N° ${num} a nombre de ${holder} con la cédula N° ${cedula}`.trim();
    }
  }
  if (selected.length === 0) return '';
  if (selected.length === 1) {
    const a = selected[0];
    const bankLabel = [a.accountType, a.bankName].filter(Boolean).join(' ');
    return `${bankLabel} N° ${a.accountNumber ?? ''} a nombre de ${a.ownerName ?? ''} con la cédula N° ${a.ownerCedula ?? ''}`.trim();
  }
  return selected
    .map((a) => {
      const bankLabel = [a.accountType, a.bankName].filter(Boolean).join(' ');
      return `• ${bankLabel} N° ${a.accountNumber ?? ''} — ${a.ownerName ?? ''} (C.C. ${a.ownerCedula ?? ''})`;
    })
    .join('\n');
}
