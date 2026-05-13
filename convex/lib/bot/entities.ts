/**
 * Bot v2 — Gestión de BotSession en Convex.
 *
 * Provee helpers para leer, crear y actualizar sesiones.
 * No tiene lógica de negocio: solo acceso a BD.
 */

import type { BotEntities, BotPhase } from "./types";

/** Shape que guardamos en la tabla botSessions. */
export interface BotSessionDoc {
  _id?: string;
  conversationId: string;
  phone: string;
  phase: BotPhase;
  entities: BotEntities;
  turnCount: number;
  createdAt: number;
  updatedAt: number;
}

const CANON_PLAN = new Set(["familia", "amigos", "empresa", "pareja", "otro"]);

/**
 * Normaliza tipo de grupo (alineado al mensaje de bienvenida: familiar / amigos / empresarial).
 * Devuelve undefined si el texto no permite clasificar.
 */
export function normalizePlanType(raw?: string): string | undefined {
  if (!raw?.trim()) return undefined;
  const t = raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  if (CANON_PLAN.has(t)) return t;
  if (/\b(amigos?|amig[oa]s?)\b/.test(t)) return "amigos";
  if (/\b(familia|familiar|familiares)\b/.test(t)) return "familia";
  if (/\b(empresa|empresarial|corporativ)\b/.test(t)) return "empresa";
  if (/\bpareja/.test(t)) return "pareja";
  if (/\botro\b/.test(t)) return "otro";
  return undefined;
}

/** Merge superficial de entidades: sólo sobreescribe campos que vienen definidos. */
export function mergeEntities(
  current: BotEntities,
  incoming: Partial<BotEntities>,
): BotEntities {
  const merged: BotEntities = { ...current };
  for (const key of Object.keys(incoming) as (keyof BotEntities)[]) {
    const val = incoming[key];
    if (val === undefined || val === null) continue;
    if (typeof val === "string" && val.trim() === "") continue;
    if (typeof val === "number" && (Number.isNaN(val) || !Number.isFinite(val))) continue;
    if (key === "cupo" && typeof val === "number" && val <= 0) continue;
    if (key === "planType") {
      if (typeof val !== "string") continue;
      const n = normalizePlanType(val);
      if (!n) continue;
      merged.planType = n;
      continue;
    }
    // @ts-ignore — asignación dinámica tipada
    merged[key] = val;
  }
  return merged;
}

/**
 * Orden: ubicación → fechas → cupo → tipo de grupo → evento vs solo descanso
 *        → (si evento) detalle del evento (capacidad total + logística) → catálogo.
 */
export function firstMissingCatalogField(
  e: BotEntities,
): keyof BotEntities | null {
  if (!e.location) return "location";
  if (!e.checkIn) return "checkIn";
  if (!e.checkOut) return "checkOut";
  if (e.cupo === undefined || e.cupo <= 0) return "cupo";
  if (!normalizePlanType(e.planType)) return "planType";
  if (e.isEvento === undefined) return "isEvento";
  // Si el cliente confirmó evento, también pedimos detalles antes del catálogo.
  if (e.isEvento === true) {
    if (e.eventPeopleCount === undefined || e.eventPeopleCount <= 0)
      return "eventPeopleCount";
    if (!e.eventLogistics) return "eventLogistics";
  }
  return null;
}

/** Verifica fechas coherentes (checkIn < checkOut). */
export function areDatesCoherent(e: BotEntities): boolean {
  if (!e.checkIn || !e.checkOut) return false;
  return new Date(e.checkIn) < new Date(e.checkOut);
}

/** Calcula número de noches. */
export function countNights(checkIn: string, checkOut: string): number {
  const ms = new Date(checkOut).getTime() - new Date(checkIn).getTime();
  return Math.round(ms / 86_400_000);
}

/**
 * Capacidad máxima a recomendar al cliente dado su cupo solicitado.
 * Evita mostrar fincas demasiado grandes (ej. una finca de 25 personas a alguien
 * que pidió 10). Devuelve undefined si `cupo` no es válido.
 *
 * Política (buffer adaptativo):
 *   cupo ≤ 6   → +4  (4 → 8,  6 → 10)
 *   cupo ≤ 15  → +6  (10 → 16, 15 → 21)
 *   cupo ≤ 25  → +8  (20 → 28)
 *   cupo > 25  → +10 (30 → 40)
 *
 * El filtro server-side (`whatsappCatalogs.getPayloadByLocationForN8n`) usa la
 * capacidad de hospedaje o, si el cliente busca evento y la finca tiene `eventCapacity`,
 * el máximo entre ambas. Tiene pasadas: si no hay suficientes en el rango estricto,
 * cae a la intermedia que respeta `min` pero relaja `max`.
 */
export function capacityCeilForCupo(cupo: number): number | undefined {
  if (!Number.isFinite(cupo) || cupo <= 0) return undefined;
  if (cupo <= 6) return cupo + 4;
  if (cupo <= 15) return cupo + 6;
  if (cupo <= 25) return cupo + 8;
  return cupo + 10;
}

/**
 * Tope de capacidad **relajado** (más amplio que el estricto, pero acotado).
 * Se usa en la pasada intermedia del catálogo cuando no hay suficientes fincas
 * dentro del rango estricto: relajamos el techo, pero NO permitimos fincas
 * absurdamente grandes (p. ej. una finca de 53 para alguien que pidió 22).
 *
 *  4  → 10  (cupo + 6)
 *  6  → 12  (cupo + 6)
 * 10  → 20  (cupo + 10)
 * 15  → 25  (cupo + 10)
 * 22  → 38  (cupo * 1.7)
 * 25  → 43  (cupo * 1.7)
 * 30  → 45  (cupo * 1.5)
 * 50  → 75
 */
export function capacityCeilRelaxedForCupo(cupo: number): number | undefined {
  if (!Number.isFinite(cupo) || cupo <= 0) return undefined;
  if (cupo <= 6) return cupo + 6;
  if (cupo <= 15) return cupo + 10;
  if (cupo <= 25) return Math.ceil(cupo * 1.7);
  return Math.ceil(cupo * 1.5);
}

// ─────────────────────────────────────────────────────────────────────────────
// Costo de mascotas (política comercial oficial de FincasYa)
// ─────────────────────────────────────────────────────────────────────────────

/** Cargos fijos por mascota (en pesos COP). */
export const PET_FEES = {
  /** Depósito reembolsable por cada una de las 2 primeras mascotas. */
  DEPOSIT_PER_PET: 100_000,
  /** Tarifa de ingreso no reembolsable por cada mascota desde la 3ª. */
  ENTRY_FEE_FROM_THIRD: 30_000,
  /** Cargo único de aseo cuando el cliente lleva 3 o más mascotas. */
  CLEANING_FROM_THREE: 70_000,
} as const;

/**
 * Política comercial: número máximo de mascotas que el bot puede gestionar
 * AUTOMÁTICAMENTE. Si el cliente declara más, NO se calcula el costo ni se
 * avanza al contrato — se escala a un asesor humano para evaluar condiciones
 * especiales (aseo extra, disponibilidad de fincas grandes pet-friendly,
 * depósito ajustado, etc.).
 */
export const MAX_PETS_AUTO_HANDLING = 3;

export type PetCostBreakdown = {
  /** Número de mascotas considerado (clamp a >= 0). */
  petCount: number;
  /** Depósito reembolsable total (1ª y 2ª mascota × $100.000). */
  deposit: number;
  /** Tarifa de ingreso no reembolsable (3ª en adelante × $30.000). */
  entryFee: number;
  /** Aseo único cuando hay >= 3 mascotas ($70.000), 0 en otro caso. */
  cleaning: number;
  /** Suma de los 3 conceptos. */
  total: number;
};

/**
 * Calcula el costo adicional por mascotas según la política comercial.
 *
 *   1 mascota: depósito $100.000                           → $100.000
 *   2 mascotas: 2 × $100.000                                → $200.000
 *   3 mascotas: 2 × $100.000 + $30.000 + $70.000            → $300.000
 *   4 mascotas: 2 × $100.000 + 2 × $30.000 + $70.000        → $330.000
 *   N (≥3): 200.000 + (N - 2) × 30.000 + 70.000
 *
 * Devuelve `total = 0` si el cliente no lleva mascotas o `petCount <= 0`.
 */
export function petCostBreakdown(petCount: number | undefined): PetCostBreakdown {
  const n = Math.max(0, Math.floor(Number(petCount ?? 0)));
  if (!Number.isFinite(n) || n <= 0) {
    return { petCount: 0, deposit: 0, entryFee: 0, cleaning: 0, total: 0 };
  }
  const deposit = Math.min(n, 2) * PET_FEES.DEPOSIT_PER_PET;
  const entryFee = Math.max(0, n - 2) * PET_FEES.ENTRY_FEE_FROM_THIRD;
  const cleaning = n >= 3 ? PET_FEES.CLEANING_FROM_THREE : 0;
  return {
    petCount: n,
    deposit,
    entryFee,
    cleaning,
    total: deposit + entryFee + cleaning,
  };
}

/** Formato `$ 1.400.000` (mismo estilo del resumen de cotización de WhatsApp). */
export function formatCop(n: number): string {
  const int = Math.round(Number(n));
  if (!Number.isFinite(int)) return "$ 0";
  const withDots = Math.abs(int)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return int < 0 ? `- $ ${withDots}` : `$ ${withDots}`;
}

/**
 * Meta suele usar IDs tipo VC#018 / CA#009 al final del título del producto en WhatsApp.
 * Si la sesión no tiene `selectedPropertyRetailerId` pero el nombre lo trae, lo recuperamos.
 */
export function inferRetailerIdFromCatalogTitle(raw?: string): string | undefined {
  const s = String(raw ?? "").trim();
  if (!s) return undefined;
  const m = s.match(/\b([A-Z]{2,8}#\d{1,8})\b/i);
  return m ? m[1].toUpperCase() : undefined;
}
