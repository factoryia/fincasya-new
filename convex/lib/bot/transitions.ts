/**
 * Bot v2 — Máquina de estados (transiciones).
 *
 * Dado el estado actual + entidades actualizadas, decide:
 *   1. La nueva fase.
 *   2. La pregunta específica que falta (si aún collecting).
 *   3. Si hay que enviar catálogo, mostrar cotización, o escalar a humano.
 *
 * NO llama al LLM.  Es lógica pura y determinista.
 */

import type { BotPhase, BotEntities, BotAction } from "./types";
import { firstMissingCatalogField, areDatesCoherent } from "./entities";
import {
  bogotaWallClockNoon,
  shouldBlockCatalogForPuenteOneNightSatSun,
  shouldBlockCatalogForSpecialSeason,
  type SpecialSeasonInfo,
} from "../colombiaPublicHolidays";

export interface TransitionResult {
  nextPhase: BotPhase;
  action: BotAction;
  /** Campo que falta, para que replies.ts genere la pregunta correcta. */
  missingField?: keyof BotEntities;
  /** true si las fechas son incoherentes (checkIn ≥ checkOut). */
  datesIncoherent?: boolean;
  /** 1 noche en fin de semana con puente (CO): pedir al menos 2 noches antes del catálogo. */
  catalogPuenteOneNight?: boolean;
  /**
   * Fechas dentro de Navidad / Fin de año / Reyes con menos noches que el mínimo
   * de esa temporada. Tiene prioridad sobre `catalogPuenteOneNight`.
   */
  catalogSpecialSeason?: {
    season: SpecialSeasonInfo;
    currentNights: number;
  };
}

/**
 * Función principal: qué hacer en este turno.
 *
 * @param phase      Fase actual del FSM.
 * @param entities   Entidades ya mergeadas (incluyendo las del turno actual).
 * @param incomingText Texto original del cliente (para detectar intent de saludo).
 */
export function transition(
  phase: BotPhase,
  entities: BotEntities,
  incomingText: string,
): TransitionResult {
  // ── WELCOME ──────────────────────────────────────────────────────────────
  if (phase === "welcome") {
    // Si el mensaje es solo un saludo → enviar bienvenida oficial y quedar en collecting
    if (isPureGreeting(incomingText)) {
      return { nextPhase: "collecting", action: { type: "reply_only" } };
    }
    // Si ya trajo datos en el primer mensaje → procesar como collecting
    return transitionCollecting(entities, incomingText);
  }

  // ── COLLECTING ────────────────────────────────────────────────────────────
  if (phase === "collecting") {
    return transitionCollecting(entities, incomingText);
  }

  // ── CATALOG_SENT ──────────────────────────────────────────────────────────
  if (phase === "catalog_sent") {
    const picked =
      entities.selectedPropertyName ||
      entities.selectedPropertyRetailerId ||
      entities.catalogUserPickedReply;
    if (picked) {
      // Si en el MISMO turno el cliente ya entregó info de mascotas (burst tipo
      // "Quiero esta + Tengo 3 mascotas"), saltamos pet_check para no volver a
      // preguntar lo mismo.
      if (
        entities.hasPets === true &&
        (entities.petCount ?? 0) > 0
      ) {
        return { nextPhase: "pet_rules_shown", action: { type: "reply_only" } };
      }
      if (entities.hasPets === false) {
        return { nextPhase: "quote_shown", action: { type: "reply_only" } };
      }
      // Caso normal: cliente eligió pero falta info de mascotas → pet_check.
      // (También cubre hasPets=true && petCount undefined: pet_check pide el número.)
      return { nextPhase: "pet_check", action: { type: "reply_only" } };
    }
    return { nextPhase: "catalog_sent", action: { type: "reply_only" } };
  }

  // ── PROPERTY_SELECTED ─────────────────────────────────────────────────────
  if (phase === "property_selected") {
    if (entities.hasPets !== undefined) {
      return { nextPhase: "contract", action: { type: "reply_only" } };
    }
    return { nextPhase: "pet_check", action: { type: "reply_only" } };
  }

  // ── PET_CHECK ─────────────────────────────────────────────────────────────
  if (phase === "pet_check") {
    // hasPets debe estar definido para avanzar
    if (entities.hasPets === undefined) {
      return { nextPhase: "pet_check", action: { type: "reply_only" } };
    }
    // Si lleva mascotas pero no sabemos cuántas, NO avanzar todavía: el bot pide el número.
    if (
      entities.hasPets === true &&
      (entities.petCount === undefined || entities.petCount <= 0)
    ) {
      return { nextPhase: "pet_check", action: { type: "reply_only" } };
    }
    // Resolved. Si lleva mascotas, mostrar reglas (intermedio).
    // Si no lleva, saltar directo al resumen (quote_shown).
    if (entities.hasPets === true) {
      return { nextPhase: "pet_rules_shown", action: { type: "reply_only" } };
    }
    return { nextPhase: "quote_shown", action: { type: "reply_only" } };
  }

  // ── PET_RULES_SHOWN ───────────────────────────────────────────────────────
  // El cliente vio las reglas de mascotas. Esperamos confirmación para avanzar.
  if (phase === "pet_rules_shown") {
    const confirms = clientConfirms(incomingText);
    if (confirms === true) {
      return { nextPhase: "quote_shown", action: { type: "reply_only" } };
    }
    // Si dice que no o no es claro, nos quedamos en la misma fase
    // (replies.ts decide si re-emitir el mensaje o el LLM contextual responde).
    return { nextPhase: "pet_rules_shown", action: { type: "reply_only" } };
  }

  // ── QUOTE_SHOWN ───────────────────────────────────────────────────────────
  // El cliente vio el resumen con totales. Esperamos confirmación para pedir datos de contrato.
  if (phase === "quote_shown") {
    const confirms = clientConfirms(incomingText);
    if (confirms === true) {
      return { nextPhase: "contract", action: { type: "reply_only" } };
    }
    return { nextPhase: "quote_shown", action: { type: "reply_only" } };
  }

  // ── CONTRACT ──────────────────────────────────────────────────────────────
  if (phase === "contract") {
    const contractComplete = isContractComplete(entities);
    if (contractComplete) {
      return {
        nextPhase: "done",
        action: { type: "escalate_human", reason: "contract_complete" },
      };
    }
    return { nextPhase: "contract", action: { type: "reply_only" } };
  }

  // ── DONE ──────────────────────────────────────────────────────────────────
  return { nextPhase: "done", action: { type: "reply_only" } };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers privados
// ─────────────────────────────────────────────────────────────────────────────

function ymdToBogotaNoonMs(ymd: string): number {
  const [y, m, d] = ymd.trim().slice(0, 10).split("-").map((x) => parseInt(x, 10));
  return bogotaWallClockNoon(y, m, d).getTime();
}

function transitionCollecting(
  entities: BotEntities,
  incomingText: string,
): TransitionResult {
  // Validar coherencia de fechas primero
  if (entities.checkIn && entities.checkOut && !areDatesCoherent(entities)) {
    return {
      nextPhase: "collecting",
      action: { type: "reply_only" },
      datesIncoherent: true,
    };
  }

  // Temporadas especiales (Navidad / Fin de año / Reyes) — TIENEN PRIORIDAD
  // sobre el puente normal porque sus mínimos son específicos (3, 6, 2 noches).
  // El bloqueo se ignora si `puenteAcknowledged=true` igual que el puente normal
  // (en realidad ese flag se resetea al cambiar fechas, así que si el cliente
  // ajusta y cumple el mínimo, el bloqueo desaparece naturalmente).
  if (
    entities.checkIn &&
    entities.checkOut &&
    areDatesCoherent(entities)
  ) {
    const checkInMs = ymdToBogotaNoonMs(entities.checkIn);
    const checkOutMs = ymdToBogotaNoonMs(entities.checkOut);
    const specialBlock = shouldBlockCatalogForSpecialSeason(checkInMs, checkOutMs);
    if (specialBlock && !entities.puenteAcknowledged) {
      const stillMissing = firstMissingCatalogField(entities);
      return {
        nextPhase: "collecting",
        action: { type: "reply_only" },
        catalogSpecialSeason: specialBlock,
        ...(stillMissing ? { missingField: stillMissing } : {}),
      };
    }
  }

  // Puente / 1 noche: avisar UNA SOLA VEZ por combinación de fechas.
  // Si el cliente ya recibió el aviso (puenteAcknowledged=true), no volver a bloquear:
  // sigue el flujo normal de collecting. El flag se resetea cuando cambian las fechas
  // (ver `replies.ts` / `extractor`: al setear nuevas checkIn/checkOut limpiamos el flag).
  if (
    !entities.puenteAcknowledged &&
    entities.checkIn &&
    entities.checkOut &&
    areDatesCoherent(entities)
  ) {
    const checkInMs = ymdToBogotaNoonMs(entities.checkIn);
    const checkOutMs = ymdToBogotaNoonMs(entities.checkOut);
    if (shouldBlockCatalogForPuenteOneNightSatSun(checkInMs, checkOutMs, incomingText)) {
      const stillMissing = firstMissingCatalogField(entities);
      return {
        nextPhase: "collecting",
        action: { type: "reply_only" },
        catalogPuenteOneNight: true,
        ...(stillMissing ? { missingField: stillMissing } : {}),
      };
    }
  }

  const missing = firstMissingCatalogField(entities);
  if (missing) {
    return {
      nextPhase: "collecting",
      action: { type: "reply_only" },
      missingField: missing,
    };
  }

  // Todos los datos listos → enviar catálogo
  const loc = entities.location!;
  return {
    nextPhase: "catalog_sent",
    action: {
      type: "send_catalog",
      location: loc,
      checkIn: entities.checkIn!,
      checkOut: entities.checkOut!,
      cupo: entities.cupo!,
      // Solo true si el cliente indicó evento/fiesta; si no, catálogo amplio (incluye family-only cuando aplica).
      isEvento: entities.isEvento === true,
    },
  };
}

const GREETINGS = /^(hola|buenas|buen\s*d[ií]a|buenos|hey|hi|hello|saludos|ola|buenas tardes|buenas noches)\W*$/i;

/** Solo saludo, sin otros datos útiles — útil también en replies fuera del primer turno. */
export function isPureGreeting(text: string): boolean {
  let t = String(text ?? "").trim();
  t = t.replace(/^[¿¡\s]+/g, "").replace(/[!?.…]+\s*$/gu, "").trim();
  t = t.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  return GREETINGS.test(t);
}

function isContractComplete(e: BotEntities): boolean {
  return !!(
    e.contractName &&
    e.contractCedula &&
    e.contractEmail &&
    (e.contractPhone || e.contractAddress)
  );
}

/**
 * Detecta si el cliente está confirmando avanzar (sí), rechazando (no) o
 * mandando algo ambiguo (null). Se usa en las fases intermedias
 * `pet_rules_shown` y `quote_shown` que esperan un sí/no explícito antes
 * de mostrar el siguiente bloque.
 */
function clientConfirms(text: string): boolean | null {
  const t = String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .trim();
  if (t.length === 0 || t.length > 240) return null;

  // El cliente puede enviar un burst con varias cosas: la confirmación primero,
  // y después una pregunta o un dato extra. Ejemplo: "si,\ncuales son los
  // horarios". Si NO partimos por líneas, la regex estricta `^si\W*$` falla
  // porque el texto completo no termina con "si"; entonces no se confirma y
  // la transición se queda en pet_rules_shown / quote_shown, cayendo al LLM
  // (que termina parafraseando y prometiendo el resumen sin entregarlo).
  //
  // Evaluamos cada LÍNEA independientemente: si CUALQUIERA matchea la
  // confirmación estricta, devolvemos true. Idem para negación.
  const lines = t
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    if (line.length === 0 || line.length > 120) continue;
    if (
      /^(si|sii+|sip|claro|dale|listo|ok+|okey|perfecto|de acuerdo|procede|procedamos|continua|continuemos|adelante|sigamos|por supuesto|esta bien|todo bien|hagamoslo|hagamos|sigue|avancemos|avanza|me sirve|me parece|de una|si por favor)\W*$/i.test(
        line,
      )
    ) {
      return true;
    }
    if (/\b(s[ií]\s+(procedamos|continuemos|sigamos|hagamoslo|avancemos))\b/.test(line)) {
      return true;
    }
    // Frustración + afirmación: el cliente repite que ya confirmó ("ya te dije
    // que sí", "ya dije que sí", "te dije sí", "ya te dije dale", etc.). Antes
    // estos quedaban sin reconocer y el bot se atascaba re-emitiendo el mismo
    // resumen / pregunta.
    if (
      /\b(ya\s+)?(te\s+|le\s+|lo\s+)?dij[eo]\s+(que\s+)?(s[ií]|dale|ok+|claro|listo|procede(mos)?)\b/.test(
        line,
      )
    ) {
      return true;
    }
  }

  for (const line of lines) {
    if (line.length === 0 || line.length > 120) continue;
    if (
      /^(no|nop+|nope|negativo|cancela|cancelar|olvidalo|olvidar|mejor no|aun no|todavia no)\W*$/i.test(
        line,
      )
    ) {
      return false;
    }
  }

  return null;
}
