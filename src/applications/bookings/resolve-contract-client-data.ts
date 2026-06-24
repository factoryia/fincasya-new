/** Elige el nombre más completo entre varias fuentes (link, gestor, borrador). */
export function pickBestClientFullName(
  candidates: (string | undefined | null)[],
): string {
  const unique: string[] = [];
  for (const c of candidates) {
    const t = String(c ?? '')
      .trim()
      .replace(/\s+/g, ' ');
    if (!t) continue;
    if (!unique.some((u) => u.toLowerCase() === t.toLowerCase())) {
      unique.push(t);
    }
  }
  if (!unique.length) return '';
  return unique.sort((a, b) => {
    const wa = a.split(' ').filter(Boolean).length;
    const wb = b.split(' ').filter(Boolean).length;
    if (wb !== wa) return wb - wa;
    return b.length - a.length;
  })[0];
}

export function parseContractDraftJson(
  raw?: string | null,
): Record<string, unknown> {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

type ContractDetailLike = {
  contract?: {
    clienteNombre?: string;
    clienteCedula?: string;
    clienteEmail?: string;
    clienteTelefono?: string;
    clienteDireccion?: string;
    clienteCiudad?: string;
    draftJson?: string;
  };
  fillToken?: {
    filledData?: {
      nombre?: string;
      cedula?: string;
      email?: string;
      telefono?: string;
      direccion?: string;
      ciudad?: string;
    };
  };
} | null;

/** Completa nombre y datos del cliente desde gestor de contratos / link público. */
export function mergeClientDataFromContractDetail<
  T extends Record<string, unknown>,
>(row: T, detail: ContractDetailLike): T {
  if (!detail) return row;
  const draft = parseContractDraftJson(detail.contract?.draftJson);
  const fill = detail.fillToken?.filledData;

  const pick = (keys: string[], fallback?: unknown) => {
    for (const k of keys) {
      const v = row[k];
      if (v != null && String(v).trim()) return String(v).trim();
    }
    for (const k of keys) {
      const v = draft[k];
      if (v != null && String(v).trim()) return String(v).trim();
    }
    return fallback != null ? String(fallback).trim() : '';
  };

  const nombreCompleto = pickBestClientFullName([
    fill?.nombre,
    detail.contract?.clienteNombre,
    typeof draft.clientName === 'string' ? draft.clientName : undefined,
    typeof draft.nombreCompleto === 'string' ? draft.nombreCompleto : undefined,
    typeof row.nombreCompleto === 'string' ? row.nombreCompleto : undefined,
  ]);

  return {
    ...row,
    ...(nombreCompleto ? { nombreCompleto } : {}),
    cedula:
      pick(['cedula'], fill?.cedula || detail.contract?.clienteCedula) ||
      row.cedula,
    correo:
      pick(['correo'], fill?.email || detail.contract?.clienteEmail) ||
      row.correo,
    celular:
      pick(['celular'], fill?.telefono || detail.contract?.clienteTelefono) ||
      row.celular,
    address:
      pick(['address'], fill?.direccion || detail.contract?.clienteDireccion) ||
      row.address,
    city:
      pick(['city'], fill?.ciudad || detail.contract?.clienteCiudad) || row.city,
  };
}
