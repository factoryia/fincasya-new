/**
 * REGLAS DE NEGOCIO CANÓNICAS — FincasYa (paso 1 del arnés del agente).
 * ---------------------------------------------------------------------------
 * ÚNICA fuente de verdad de las reglas comerciales. Cada regla existe en DOS
 * formas coherentes entre sí:
 *
 *   1. TEXTO para el system prompt del LLM (`buildBusinessRulesPrompt`) — la
 *      versión corta que el agente lee.
 *   2. VALIDADOR programático — la versión dura que el código ejecuta ANTES
 *      (gates de entrada: fechas, mascotas, eventos) o DESPUÉS (guardarraíles
 *      de salida: montos, promesas) de cada turno. El LLM puede equivocarse;
 *      el validador no.
 *
 * REGLA DE ORO: toda cifra/lógica se IMPORTA de su módulo dueño (entities,
 * colombiaPublicHolidays, businessHours) — aquí no se duplica ningún valor.
 * Si el negocio cambia una regla, se cambia en el módulo dueño y el prompt
 * se actualiza solo (interpolación).
 *
 * Extraído de: transitions.ts, index.ts, entities.ts, prompts.ts, inbound.ts
 * y de la operación real (conversaciones minadas + reunión con el cliente).
 */

import {
  MAX_PETS_AUTO_HANDLING,
  PET_FEES,
  areDatesCoherent,
  countNights,
} from "./entities";
import type { BotEntities } from "./types";
import {
  bogotaWallClockNoon,
  shouldBlockCatalogForPuenteOneNightSatSun,
  shouldBlockCatalogForSpecialSeason,
  toYmdColombia,
  type SpecialSeasonInfo,
} from "../colombiaPublicHolidays";
import { BUSINESS_HOURS_SCHEDULE_SHORT } from "../businessHours";

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────

export type RuleSeverity =
  /** Bloquea el avance del flujo (el bot debe pedir corrección al cliente). */
  | "block"
  /** El bot no puede resolverlo: escalar a asesor humano. */
  | "escalate"
  /** Aviso: el bot puede continuar pero debe mencionarlo. */
  | "warn";

export interface RuleViolation {
  ruleId: string;
  severity: RuleSeverity;
  /** Nota interna (logs / inbox) — NUNCA se envía al cliente tal cual. */
  internalNote: string;
  /** Datos útiles para que el generador redacte la respuesta al cliente. */
  data?: Record<string, unknown>;
}

/** Etapa comercial vigente. Define qué puede hacer el agente. */
export type CommercialStage = "stage1" | "full";

// ─────────────────────────────────────────────────────────────────────────────
// Política por etapa (capacidades — se aplican como disponibilidad de tools)
// ─────────────────────────────────────────────────────────────────────────────

export interface StagePolicy {
  /** ¿Puede citar precios de cotización (getBotStayQuote)? */
  canQuote: boolean;
  /** ¿Puede recolectar datos de contrato (nombre, cédula…)? */
  canCollectContract: boolean;
  /** ¿Puede negociar/ofrecer descuentos? (NUNCA en ninguna etapa — asesor). */
  canDiscount: false;
  /** ¿Puede confirmar disponibilidad de una finca? (NUNCA — asesor/sistema). */
  canConfirmAvailability: false;
  /** Al elegir el cliente una finca: ¿escalar de inmediato a asesor? */
  handoffOnPropertyPick: boolean;
}

export const STAGE_POLICIES: Record<CommercialStage, StagePolicy> = {
  /** ETAPA 1 (vigente): calificar + mostrar catálogo + entregar al asesor. */
  stage1: {
    canQuote: false,
    canCollectContract: false,
    canDiscount: false,
    canConfirmAvailability: false,
    handoffOnPropertyPick: true,
  },
  /** Flujo completo (mascotas → cotización → contrato). Detrás de flag. */
  full: {
    canQuote: true,
    canCollectContract: true,
    canDiscount: false,
    canConfirmAvailability: false,
    handoffOnPropertyPick: false,
  },
};

/** Etapa activa según la config del deployment (mismo flag que transitions.ts). */
export function activeStage(): CommercialStage {
  return process.env.BOT_STAGE1_HANDOFF === "1" ? "stage1" : "full";
}

// ─────────────────────────────────────────────────────────────────────────────
// Validadores de ENTRADA (estado del negocio) — envuelven la lógica existente
// ─────────────────────────────────────────────────────────────────────────────

function ymdToBogotaNoonMs(ymd: string): number {
  const [y, m, d] = ymd.trim().slice(0, 10).split("-").map((x) => parseInt(x, 10));
  return bogotaWallClockNoon(y, m, d).getTime();
}

function isYmdTodayOrPastColombia(ymd: string, nowMs: number): boolean {
  const day = ymd.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  return day <= toYmdColombia(nowMs);
}

/**
 * Reglas de FECHAS (todas deterministas — jamás pedirle al LLM que "sepa"
 * festivos ni aritmética de calendario):
 *  - El check-in debe ser mínimo MAÑANA (no hoy, no pasado).
 *  - checkOut > checkIn.
 *  - Puente festivo: mínimo 2 noches.
 *  - Temporada especial: Navidad mín. 3 noches, Fin de año mín. 6, Reyes mín. 2.
 */
export function validateDates(
  entities: Pick<BotEntities, "checkIn" | "checkOut">,
  nowMs: number,
  incomingText = "",
): RuleViolation[] {
  const out: RuleViolation[] = [];
  const { checkIn, checkOut } = entities;

  if (checkIn && isYmdTodayOrPastColombia(checkIn, nowMs)) {
    out.push({
      ruleId: "dates_in_past",
      severity: "block",
      internalNote: `Check-in ${checkIn} es hoy o pasado — pedir fechas nuevas (mínimo mañana).`,
    });
    return out; // sin fecha válida no tiene sentido evaluar lo demás
  }

  if (checkIn && checkOut && !areDatesCoherent({ checkIn, checkOut })) {
    out.push({
      ruleId: "dates_incoherent",
      severity: "block",
      internalNote: `Fechas incoherentes (${checkIn} → ${checkOut}) — la salida debe ser posterior a la entrada.`,
    });
    return out;
  }

  if (checkIn && checkOut) {
    const inMs = ymdToBogotaNoonMs(checkIn);
    const outMs = ymdToBogotaNoonMs(checkOut);

    const season = shouldBlockCatalogForSpecialSeason(inMs, outMs) as
      | { season: SpecialSeasonInfo; currentNights: number }
      | null;
    if (season) {
      out.push({
        ruleId: "special_season_min_nights",
        severity: "block",
        internalNote: `Temporada ${season.season.label}: mínimo ${season.season.minNights} noches (el cliente pide ${season.currentNights}).`,
        data: {
          seasonLabel: season.season.label,
          minNights: season.season.minNights,
          currentNights: season.currentNights,
        },
      });
      return out; // la temporada tiene prioridad sobre el puente
    }

    if (shouldBlockCatalogForPuenteOneNightSatSun(inMs, outMs, incomingText)) {
      out.push({
        ruleId: "puente_min_2_nights",
        severity: "block",
        internalNote: `1 noche sobre puente festivo — el mínimo comercial en puente es 2 noches.`,
        data: { minNights: 2, currentNights: countNights(checkIn, checkOut) },
      });
    }
  }

  return out;
}

/** Mascotas: el bot gestiona hasta MAX_PETS_AUTO_HANDLING; más → asesor. */
export function validatePets(
  entities: Pick<BotEntities, "hasPets" | "petCount">,
): RuleViolation[] {
  if (
    entities.hasPets === true &&
    (entities.petCount ?? 0) > MAX_PETS_AUTO_HANDLING
  ) {
    return [
      {
        ruleId: "pets_exceed_limit",
        severity: "escalate",
        internalNote: `${entities.petCount} mascotas (> ${MAX_PETS_AUTO_HANDLING}) — condiciones especiales las evalúa un asesor.`,
        data: { petCount: entities.petCount, max: MAX_PETS_AUTO_HANDLING },
      },
    ];
  }
  return [];
}

/** Eventos: logística pesada (DJ/sonido pro/banda/mariachis) la cotiza un asesor. */
export function validateEvent(
  entities: Pick<BotEntities, "isEvento" | "eventLogistics">,
): RuleViolation[] {
  if (entities.isEvento === true && entities.eventLogistics === "extra") {
    return [
      {
        ruleId: "event_heavy_logistics",
        severity: "escalate",
        internalNote:
          "Evento con logística pesada (sonido pro/DJ/banda) — sobreprecio y condiciones las define un asesor.",
      },
    ];
  }
  return [];
}

// ─────────────────────────────────────────────────────────────────────────────
// Validadores de SALIDA (guardarraíles sobre el texto que genera el LLM)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Frases que PROMETEN paso a asesor. Si el texto las contiene y el turno NO
 * está escalando de verdad, la respuesta se rechaza (promesa incumplida =
 * cliente esperando a alguien que nunca llega — bug histórico reportado).
 * Fuente canónica: mover aquí las regex de `inbound.ts` (botPromisedHandoff)
 * cuando Santiago haga el wiring — por ahora, espejo exacto.
 */
export const HANDOFF_PROMISE_REGEXES: RegExp[] = [
  /\bte\s+(?:conecto|paso|comunico|conectare|pasare|comunicare)\s+(?:con\s+)?(?:un|el|nuestro)?\s*(?:asesor|agente|humano|equipo)\b/i,
  /\b(?:dejame|voy\s+a|te)\s+confirma\w*\s+con\s+(?:un|el|nuestro)?\s*asesor\b/i,
  /\bun[oa]?\s+(?:asesor|agente)\s+(?:humano\s+)?te\s+(?:va\s+a\s+|puede\s+|podria\s+)?(?:responde\w*|contacta\w*|ayuda\w*|escrib\w*|atend\w*|atiend\w*|llama\w*|comunicar\w*|verifica\w*|confirma\w*|gestion\w*)\b/i,
  /\bvoy\s+a\s+(?:conectarte|pasarte|comunicarte|escalar\w*)\b/i,
];

export interface OutboundTextCheckOpts {
  /** Montos autorizados en este turno (vienen de tools: cotización, tarifas). */
  allowedAmounts?: number[];
  /** ¿Este turno está escalando de verdad? (permite prometer asesor). */
  isEscalating?: boolean;
  /** Largo máximo (default 900 — los muros de texto son señal de LLM desbocado). */
  maxChars?: number;
  /** Etapa activa (stage1 prohíbe hablar de abonos/porcentajes de pago). */
  stage?: CommercialStage;
}

/**
 * Valida el TEXTO de salida del LLM. Devuelve violaciones; si hay alguna con
 * severity "block", el caller debe descartar el texto y usar el fallback.
 */
export function validateOutboundText(
  text: string,
  opts: OutboundTextCheckOpts = {},
): RuleViolation[] {
  const out: RuleViolation[] = [];
  const t = String(text ?? "").trim();
  if (!t) return out;
  const norm = t.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  const maxChars = opts.maxChars ?? 900;

  // 1. Montos NO autorizados: toda cifra de dinero debe venir de una tool.
  const amountMatches = norm.match(/\$\s?[\d.,]+|\b[\d.,]{4,}\s*(pesos|cop)\b/g) ?? [];
  if (amountMatches.length > 0) {
    const allowed = new Set(
      (opts.allowedAmounts ?? []).map((n) => String(Math.round(n))),
    );
    const unauthorized = amountMatches.filter((raw) => {
      const digits = raw.replace(/[^\d]/g, "");
      return digits.length >= 4 && !allowed.has(digits);
    });
    if (unauthorized.length > 0) {
      out.push({
        ruleId: "unauthorized_amounts",
        severity: "block",
        internalNote: `El texto contiene montos no provenientes del sistema: ${unauthorized.join(", ")}. Los precios SOLO salen de tools.`,
      });
    }
  }

  // 2. Promesa de asesor sin escalado real.
  if (!opts.isEscalating && HANDOFF_PROMISE_REGEXES.some((re) => re.test(norm))) {
    out.push({
      ruleId: "handoff_promise_without_escalation",
      severity: "block",
      internalNote:
        "El texto promete pasar con un asesor pero el turno no escala — promesa que no se cumple.",
    });
  }

  // 3. Abonos / porcentajes de pago: solo el asesor (en toda etapa el bot no
  //    calcula cuotas; en stage1 ni siquiera menciona el proceso de pago).
  if (/\b(50\s*%|abono|anticipo|cuota\s+inicial)\b/.test(norm) && opts.stage === "stage1") {
    out.push({
      ruleId: "payment_talk_in_stage1",
      severity: "block",
      internalNote:
        "En etapa 1 el bot no habla de abonos/anticipos — el cierre y el pago los maneja el asesor.",
    });
  }

  // 4. Confirmación de disponibilidad (ninguna etapa — la valida asesor/sistema).
  if (/\b(esta|se\s+encuentra)\s+disponible\b/.test(norm) && !opts.isEscalating) {
    out.push({
      ruleId: "availability_confirmation",
      severity: "warn",
      internalNote:
        "Posible confirmación de disponibilidad — el bot no confirma disponibilidad; revisar fraseo ('sujeta a confirmación del asesor').",
    });
  }

  // 5. Largo / fugas técnicas.
  if (t.length > maxChars) {
    out.push({
      ruleId: "too_long",
      severity: "block",
      internalNote: `Respuesta de ${t.length} chars (máx ${maxChars}).`,
    });
  }
  if (t.startsWith("{") || t.startsWith("```") || /"ruleId"|selectedProperty|retailerId/i.test(t)) {
    out.push({
      ruleId: "technical_leak",
      severity: "block",
      internalNote: "La respuesta contiene JSON/markdown/términos internos.",
    });
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// TEXTO CANÓNICO para el system prompt del agente
// ─────────────────────────────────────────────────────────────────────────────

const COP = (n: number) => `$${n.toLocaleString("es-CO")}`;

/**
 * Reglas de negocio en versión corta para el LLM. Las cifras se interpolan de
 * las constantes dueñas — este texto NUNCA se desincroniza del código.
 * Úsese en: contextualLlmReply / advisorContinuity / composeReply (nivel 2) /
 * el agente con tools (nivel 3).
 */
export function buildBusinessRulesPrompt(stage: CommercialStage = activeStage()): string {
  const lines: string[] = [
    "REGLAS DE NEGOCIO FINCASYA (obligatorias — el sistema valida tu respuesta y la descarta si las violas):",
    "",
    "FECHAS (el sistema las valida por ti; si te informa un bloqueo, explícalo con empatía):",
    "- El check-in es mínimo MAÑANA: no se reserva para el mismo día ni fechas pasadas.",
    "- En puentes festivos el mínimo es 2 noches.",
    "- Temporadas especiales: Navidad mín. 3 noches, Fin de año mín. 6, Reyes mín. 2.",
    "",
    "PERSONAS:",
    "- Los niños desde 2 años cuentan como personas del cupo; bebés menores de 2 no.",
    "- Personas por encima del cupo de la finca: costo adicional que define el ASESOR.",
    "",
    "MASCOTAS:",
    `- Bienvenidas en la mayoría de fincas (algunas no las permiten; razas/tamaños especiales los valida el asesor).`,
    `- Cargos oficiales: depósito reembolsable ${COP(PET_FEES.DEPOSIT_PER_PET)} por mascota (1ª y 2ª); tarifa de ingreso ${COP(PET_FEES.ENTRY_FEE_FROM_THIRD)} desde la 3ª; aseo único ${COP(PET_FEES.CLEANING_FROM_THREE)} si van 3 o más.`,
    `- Máximo ${MAX_PETS_AUTO_HANDLING} mascotas por gestión automática; más → lo maneja un asesor.`,
    "- Reglas de convivencia: no entran a la piscina, no se suben a muebles/camas, recoger sus necesidades; incumplir puede descontar del depósito.",
    "",
    "EVENTOS:",
    "- Evento con sonido profesional, DJ, banda, mariachis o iluminación → el precio y condiciones los define un ASESOR (tú no los cotizas).",
    "- Celebraciones tranquilas con el sonido básico de la finca siguen el proceso normal.",
    "",
    "PASADÍA: no se ofrece. Alternativa: proponer estadía de 1 noche.",
    "",
    "PRECIOS Y PAGOS:",
    "- SOLO puedes citar precios/valores que el sistema te entregue en este contexto. JAMÁS inventes, redondees ni calcules montos, porcentajes o abonos.",
    "- Descuentos: NUNCA los ofreces tú. Si piden rebaja: reconoce, explica que el valor ya es el mejor por temporada, y que el asesor revisa si aplica alguna atención.",
    "",
    "UBICACIÓN: solo se comparte el MUNICIPIO. La dirección exacta se entrega después de contrato y abono (por el asesor).",
    "",
    "ESCALADO A ASESOR (obligatorio): cliente lo pide explícitamente; cliente con reserva activa; >3 mascotas; evento con logística pesada; pregunta que no puedas responder con la información verificada de este contexto.",
    "",
    `HORARIO DE ATENCIÓN DEL EQUIPO: ${BUSINESS_HOURS_SCHEDULE_SHORT} (días festivos 9:00 AM–2:00 PM).`,
  ];

  if (stage === "stage1") {
    lines.push(
      "",
      "POLÍTICA COMERCIAL VIGENTE (ETAPA 1 — tu único objetivo):",
      "- Tu trabajo es: entender qué busca el cliente (zona, fechas, personas, tipo de plan), mostrarle opciones del catálogo y dejarlo listo para el asesor.",
      "- NO confirmas disponibilidad (siempre 'sujeta a validación'), NO cotizas totales, NO hablas de pagos/abonos, NO pides datos de contrato, NO cierras la reserva.",
      "- Cuando el cliente elige una finca: celebra la elección y entrega al asesor (el sistema hace el escalado).",
    );
  }

  return lines.join("\n");
}

/**
 * Conveniencia: corre TODOS los validadores de entrada sobre las entidades.
 */
export function validateBusinessState(
  entities: BotEntities,
  nowMs: number,
  incomingText = "",
): RuleViolation[] {
  return [
    ...validateDates(entities, nowMs, incomingText),
    ...validatePets(entities),
    ...validateEvent(entities),
  ];
}
