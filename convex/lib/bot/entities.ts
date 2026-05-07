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
 * Orden: ubicación → fechas → cupo → tipo de grupo → evento vs solo descanso → catálogo.
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
 * Meta suele usar IDs tipo VC#018 / CA#009 al final del título del producto en WhatsApp.
 * Si la sesión no tiene `selectedPropertyRetailerId` pero el nombre lo trae, lo recuperamos.
 */
export function inferRetailerIdFromCatalogTitle(raw?: string): string | undefined {
  const s = String(raw ?? "").trim();
  if (!s) return undefined;
  const m = s.match(/\b([A-Z]{2,8}#\d{1,8})\b/i);
  return m ? m[1].toUpperCase() : undefined;
}
