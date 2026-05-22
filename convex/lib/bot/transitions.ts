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
  toYmdColombia,
  type SpecialSeasonInfo,
} from "../colombiaPublicHolidays";

export interface TransitionResult {
  nextPhase: BotPhase;
  action: BotAction;
  /** Campo que falta, para que replies.ts genere la pregunta correcta. */
  missingField?: keyof BotEntities;
  /** true si las fechas son incoherentes (checkIn ≥ checkOut). */
  datesIncoherent?: boolean;
  /**
   * true si la fecha de ENTRADA ya pasó (es anterior a hoy en Colombia). El
   * cliente dio fechas de días pasados → hay que pedirle fechas nuevas, no
   * cotizar.
   */
  datesInPast?: boolean;
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
  /**
   * Clasificación del extractor LLM sobre si el cliente confirma/niega la
   * última pregunta del bot. Si viene "yes"/"no", se prefiere sobre la
   * heurística regex (que es solo fallback). Permite reconocer typos y
   * variantes naturales tipo "si pro favor", "claro pue", "obvio dale".
   */
  extractedConfirms?: "yes" | "no" | null,
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
    const confirms = clientConfirms(incomingText, extractedConfirms);
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
    const confirms = clientConfirms(incomingText, extractedConfirms);
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

/**
 * ¿La fecha `ymd` (YYYY-MM-DD) es HOY O ANTERIOR en zona horaria de Colombia?
 * El check-in debe ser mínimo mañana — no se permite reservar con entrada el
 * mismo día en que se hace la consulta.
 */
function isYmdInPastColombia(ymd: string): boolean {
  const day = ymd.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  return day <= toYmdColombia(Date.now());
}

function transitionCollecting(
  entities: BotEntities,
  incomingText: string,
): TransitionResult {
  // Fechas en el PASADO = BLOQUEO DURO. Si la fecha de entrada que dio el
  // cliente ya pasó (ej. hoy es 21/may y pidió "del 19 al 21 de mayo"), no
  // tiene sentido pedir el resto de datos ni cotizar — hay que avisarle y
  // pedirle fechas nuevas. Se evalúa ANTES de la coherencia porque basta con
  // el checkIn (puede que el cliente aún no haya dado checkOut).
  if (entities.checkIn && isYmdInPastColombia(entities.checkIn)) {
    return {
      nextPhase: "collecting",
      action: { type: "reply_only" },
      datesInPast: true,
    };
  }

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
  // BLOQUEO DURO: mientras las fechas no cumplan el mínimo de noches, el FSM
  // NUNCA progresa al catálogo (no importa `puenteAcknowledged`). El flag solo
  // controla aviso completo vs recordatorio corto en `replies.ts`. Si el
  // cliente extiende las fechas y cumple el mínimo, el bloqueo desaparece
  // naturalmente (la condición deja de cumplirse). Si nunca las corrige, el
  // anti-bucle de `index.ts` lo escala a un asesor humano.
  if (
    entities.checkIn &&
    entities.checkOut &&
    areDatesCoherent(entities)
  ) {
    const checkInMs = ymdToBogotaNoonMs(entities.checkIn);
    const checkOutMs = ymdToBogotaNoonMs(entities.checkOut);
    const specialBlock = shouldBlockCatalogForSpecialSeason(checkInMs, checkOutMs);
    if (specialBlock) {
      const stillMissing = firstMissingCatalogField(entities);
      return {
        nextPhase: "collecting",
        action: { type: "reply_only" },
        catalogSpecialSeason: specialBlock,
        ...(stillMissing ? { missingField: stillMissing } : {}),
      };
    }
  }

  // Puente / 1 noche — BLOQUEO DURO. Regla comercial: en un puente festivo
  // manejamos mínimo 2 noches. Mientras las fechas sean 1 noche sobre un
  // puente, el FSM NUNCA envía el catálogo (no importa `puenteAcknowledged`,
  // que solo decide aviso completo vs recordatorio corto en `replies.ts`).
  // Antes el flag hacía "avisar una vez y dejar pasar" → el bot decía
  // "mínimo 2 noches" y luego igual mandaba el catálogo de 1 noche
  // (incoherente). Ahora se cumple lo que se dice: si el cliente extiende a
  // 2+ noches el bloqueo cae; si insiste en 1 noche, el anti-bucle de
  // `index.ts` lo escala a un asesor humano.
  if (
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

  // ── Finca puntual ya resuelta ────────────────────────────────────────────
  // El cliente nombró una finca concreta ("quiero la finca X") y `index.ts`
  // ya la resolvió a un `selectedPropertyRetailerId`. Saltamos el catálogo:
  // vamos directo al flujo de reserva de esa finca. Solo necesitamos fechas
  // (coherentes) + cupo para cotizar; planType / isEvento / municipio no
  // hacen falta cuando la finca ya está elegida. Los bloqueos de fechas
  // (incoherentes / puente / temporada) ya se evaluaron arriba.
  if ((entities.selectedPropertyRetailerId ?? "").trim()) {
    if (!entities.checkIn) {
      return {
        nextPhase: "collecting",
        action: { type: "reply_only" },
        missingField: "checkIn",
      };
    }
    if (!entities.checkOut) {
      return {
        nextPhase: "collecting",
        action: { type: "reply_only" },
        missingField: "checkOut",
      };
    }
    if (entities.cupo === undefined || entities.cupo <= 0) {
      return {
        nextPhase: "collecting",
        action: { type: "reply_only" },
        missingField: "cupo",
      };
    }
    // Finca + fechas + cupo OK → flujo de reserva (igual que catalog_sent +
    // finca elegida): según el estado de mascotas vamos a pet_rules_shown /
    // quote_shown / pet_check.
    if (entities.hasPets === true && (entities.petCount ?? 0) > 0) {
      return { nextPhase: "pet_rules_shown", action: { type: "reply_only" } };
    }
    if (entities.hasPets === false) {
      return { nextPhase: "quote_shown", action: { type: "reply_only" } };
    }
    return { nextPhase: "pet_check", action: { type: "reply_only" } };
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
function clientConfirms(
  text: string,
  /**
   * Hint del extractor LLM. Si llega definido (no null/undefined), se prefiere
   * sobre la heurística regex de abajo. La regex queda solo como red de
   * seguridad para casos donde el LLM no clasificó (campo omitido).
   */
  llmHint?: "yes" | "no" | null,
): boolean | null {
  // PRIORIDAD: si el LLM clasificó, confiar en su resultado.
  if (llmHint === "yes") return true;
  if (llmHint === "no") return false;

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

  // Frases de confirmación atómicas: "si", "dale", "ok", "de una", "por
  // favor", "porfa", etc. La regex compound de abajo permite COMBINACIONES
  // libres (ej. "si de una", "claro dale", "ok por favor", "dale claro de
  // una", "si porfavor", "si porfa").
  //
  // Variantes informales incluidas: "porfavor" / "porfa" / "pofa" (sin
  // espacio, abreviaturas comunes en español colombiano).
  const CONFIRM_PHRASE =
    "(?:si|sii+|sip|claro|dale|listo|ok+|okey|perfecto|procede|procedamos|continua|continuemos|adelante|sigamos|hagamoslo|hagamos|sigue|avancemos|avanza|me\\s+sirve|me\\s+parece|de\\s+una(?:\\s+vez)?|por\\s+favor|porfavor|porfa|pofa|porfis|plis|please|por\\s+supuesto|esta\\s+bien|todo\\s+bien|de\\s+acuerdo|bueno|vale|genial|excelente|chevere|chevre|bacano|listoco|listocho|de\\s+ley)";
  const compoundConfirmRegex = new RegExp(
    `^(?:${CONFIRM_PHRASE}[\\s,.\\-:!?]*)+$`,
    "i",
  );

  for (const line of lines) {
    if (line.length === 0 || line.length > 120) continue;
    // Match cualquier combinación de frases de confirmación seguidas (ej.
    // "si", "si de una", "claro si", "ok dale", "si por favor", "perfecto
    // dale de una").
    if (compoundConfirmRegex.test(line)) {
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
