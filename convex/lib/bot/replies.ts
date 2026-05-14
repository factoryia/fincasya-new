/**
 * Bot v2 — Generador de respuestas.
 *
 * Dado el resultado de la transición, decide si:
 *   a) Devuelve un texto estático (saludo, pregunta de campo, pre-catálogo, mascotas, cotización, contrato).
 *   b) Llama al LLM solo para aclaraciones o respuestas ambiguas.
 *
 * Las respuestas estáticas son > 90% de los casos → ahorra tokens y es predecible.
 */

import { generateText, type CoreMessage } from "ai";
import { openai } from "@ai-sdk/openai";
import type { BotPhase, BotEntities, StayQuoteTotals } from "./types";
import { formatCop, petCostBreakdown } from "./entities";
import { isPureGreeting, type TransitionResult } from "./transitions";
import {
  WELCOME_MESSAGE,
  missingFieldQuestion,
  missingFieldsBundle,
  combinedQuestionForMissing,
  datesIncoherentMessage,
  preCatalogText,
  petCheckMessage,
  CONTRACT_REQUEST_MESSAGE,
  contractSystemPrompt,
  followUpCollectingRecapMessage,
  followUpCatalogSentVagueMessage,
  isVagueShortMessage,
  petFeesSummaryForQuote,
  buildContextSystemPrompt,
  LOOP_OFFER_HUMAN_MESSAGE,
  nextStepFriendlyQuestion,
} from "./prompts";
import {
  buildPuenteFollowUpConversationEs,
  buildPuenteShortNoticeEs,
  buildSpecialSeasonNoticeEs,
  buildSpecialSeasonShortReminderEs,
} from "../colombiaPublicHolidays";

const MODEL = "gpt-4.1-mini";

/** Nombre para el copy de mascotas: usa título real si ya está en entidades (p. ej. resolviendo reply al catálogo). */
function propertyDisplayNameForPet(e: BotEntities): string {
  const n = (e.selectedPropertyName ?? "").trim();
  if (n) {
    const lower = n.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
    if (
      /^(esta|esa|e[sa]|ese|la primera|esta finca|esa finca|lo de arriba|quiero esta|quiero esa)$/.test(
        lower,
      )
    ) {
      return "la finca elegida";
    }
    return n;
  }
  if (e.catalogUserPickedReply && (e.selectedPropertyRetailerId ?? "").trim()) {
    return "la opción que elegiste del catálogo";
  }
  return "la finca elegida";
}

/** Cliente pide 1 noche, otra fecha o rechaza alargar; ya vio el aviso de puente. */
/** Pregunta meta (“¿en qué afecta…?”) en lugar de elegir tipo de grupo. */
function userAsksWhyPlanTypeMatters(incomingText: string): boolean {
  const t = String(incomingText ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  return (
    /\b(en\s+qu[eé]\s+afecta|qu[eé]\s+diferencia|qu[eé]\s+cambia|para\s+qu[eé]\s+(preguntas|sirve|pides)|por\s+qu[eé]\s+(preguntas|importa))\b/.test(
      t,
    ) && /\b(amigos|familiar|empresa|grupo|plan|tipo)\b/.test(t)
  );
}

function planTypeWhyAnswerAndReask(): string {
  return (
    `Algunas fincas se acomodan mejor según el tipo de grupo (ruido, políticas de la casa, capacidad). ` +
    `No es para subir precio por decir “amigos” o “familiar” 🙂\n\n` +
    `¿Van más en plan *familiar*, con *amigos* o *empresarial*? 👨‍👩‍👧‍👦`
  ).trim();
}

function userAsksPuenteAlternative(incomingText: string): boolean {
  const t = String(incomingText ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  return (
    /\b(una\s+sola\s+noche|solo\s+una\s+noche|1\s+noche|una\s+noche\s+solamente|sola\s+noche|nada\s+más\s+que\s+una\s+noche)\b/.test(
      t,
    ) ||
    /\b(otra\s+fecha|otras\s+fechas|cambiar\s+(las\s+)?fechas|prefiero\s+otra|en\s+otro\s+momento|fecha\s+diferente|otro\s+d[ií]a)\b/.test(
      t,
    ) ||
    /\b(no\s+quiero\s+dos|no\s+puedo\s+dos|no\s+me\s+sirven?\s+(esas|esos)|solo\s+puedo\s+una)\b/.test(t) ||
    /\b(puedo\s+tomar\s+en\s+otra|mejor\s+otra\s+fecha)\b/.test(t)
  );
}

function petConfirmationMessage(entities: BotEntities): string {
  if (entities.hasPets) {
    const n = entities.petCount ?? 1;
    return `Perfecto, anotamos ${n} mascota${n > 1 ? "s" : ""} 🐾 ¿Te envío el resumen con el costo adicional.?`;
  }
  return `Sin mascotas, ¡anotado! 👍 Te muestro el resumen de tu reserva.`;
}

export interface ReplyInput {
  currentPhase: BotPhase;
  transition: TransitionResult;
  entities: BotEntities;
  incomingText: string;
  conversationHistory: CoreMessage[];
  /** Texto de cotización (alojamiento) desde Convex al pasar de mascotas a contrato. */
  stayQuoteBlock?: string | null;
  /** Totales numéricos de la cotización (alojamiento). Permiten calcular el
   *  gran total con cargos por mascotas. */
  stayQuoteTotals?: StayQuoteTotals | null;
  /** Turnos consecutivos en la misma fase (incluyendo el que viene). Para anti-bucles. */
  samePhaseTurnCount?: number;
  /**
   * Fragmentos relevantes del RAG de FAQs (`searchFaqForBot`). Si vienen,
   * el `contextualLlmReply` los inyecta en el system prompt para que el
   * modelo responda con datos verificados (mascotas, horarios, pagos, etc.).
   */
  faqContext?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Anti-repetición: detectar si un texto candidato ya se envió hace pocos turnos.
// ─────────────────────────────────────────────────────────────────────────────

function normalizeForCompare(s: string): string {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ");
}

/**
 * Devuelve true si el bot envió un mensaje "muy parecido" en los últimos `depth`
 * mensajes del asistente. Compara los primeros 80 caracteres normalizados.
 * Default depth=5 (antes 3): cubre el caso típico de FSM lineal donde el bot
 * envía 3-4 mensajes intermedios entre dos repeticiones del mismo texto fijo
 * (p. ej. aviso de puente festivo, follow-ups de catálogo, etc.).
 */
function wasJustSent(
  candidate: string,
  history: CoreMessage[],
  depth: number = 5,
): boolean {
  const target = normalizeForCompare(candidate).slice(0, 80);
  if (target.length < 12) return false;
  let seen = 0;
  for (let i = history.length - 1; i >= 0 && seen < depth; i--) {
    const m = history[i];
    if (m.role !== "assistant") continue;
    seen++;
    const prev = normalizeForCompare(
      typeof m.content === "string" ? m.content : "",
    ).slice(0, 80);
    if (!prev) continue;
    if (prev === target) return true;
    // similitud por prefijo: si el bloque arranca con las mismas ~50 letras, es repetición
    if (prev.length >= 50 && target.length >= 50 && prev.slice(0, 50) === target.slice(0, 50)) {
      return true;
    }
  }
  return false;
}

/**
 * Variante laxa para textos fijos importantes que NUNCA queremos repetir
 * dentro de una conversación cercana (LOOP_OFFER, aviso de puente, paquete de
 * contrato, etc.). Mira los últimos N mensajes del asistente.
 *
 * Detecta dos casos:
 *   (a) El histórico arranca con el mismo bloque (mensaje idéntico).
 *   (b) El bloque canónico está embebido dentro de un mensaje compuesto del bot
 *       (p. ej. "resumen mascotas + cotización + CONTRACT_REQUEST_MESSAGE" en un
 *       solo mensaje de WhatsApp). Antes esto no se detectaba porque solo se
 *       comparaban prefijos.
 */
function recentlySent(
  candidate: string,
  history: CoreMessage[],
  n: number = 10,
): boolean {
  const target = normalizeForCompare(candidate).slice(0, 60);
  if (target.length < 12) return false;
  let seen = 0;
  for (let i = history.length - 1; i >= 0 && seen < n; i--) {
    const m = history[i];
    if (m.role !== "assistant") continue;
    seen++;
    const full = normalizeForCompare(
      typeof m.content === "string" ? m.content : "",
    );
    if (!full) continue;
    if (full.startsWith(target)) return true;
    // Bloque embebido (mensajes compuestos como resumen + contrato pegados).
    if (full.length > target.length && full.includes(target)) return true;
  }
  return false;
}

/** Resultado del generador: un primer mensaje (`reply`) más mensajes adicionales
 *  opcionales (`extras`) que el orquestador enviará como burbujas separadas en
 *  el mismo turno. */
export type GenerateReplyResult = {
  reply: string;
  /** Mensajes a enviar DESPUÉS de `reply`, en orden, con delay corto entre
   *  cada uno. `undefined` o vacío cuando solo hay un mensaje. */
  extras?: string[];
};

/**
 * Genera la respuesta del bot para este turno. Puede ser 1 mensaje (caso normal)
 * o varios (paquete tras `pet_check` → contrato, que se descompone en mascotas /
 * resumen / pedido de datos para evitar el muro de texto en WhatsApp).
 */
export async function generateReply(
  input: ReplyInput,
): Promise<GenerateReplyResult> {
  const { currentPhase, transition: tr, entities, conversationHistory, stayQuoteBlock } = input;

  // Detección del paquete "tras confirmar mascotas → contrato".
  // Se descompone en 2-3 burbujas: (1) reglas/info de mascotas si aplica,
  // (2) resumen de la reserva, (3) pedido de datos del contrato.
  // Solo aplica a sesiones legacy en `property_selected` (las nuevas pasan por
  // `pet_check` → `pet_rules_shown` → `quote_shown` → `contract` paso a paso,
  // con confirmación del cliente entre cada bloque).
  const firstContractPacketAfterPets =
    tr.nextPhase === "contract" &&
    currentPhase === "property_selected" &&
    entities.hasPets !== undefined &&
    !entities.contractName &&
    !entities.contractCedula &&
    !entities.contractEmail;

  if (firstContractPacketAfterPets) {
    // Si CONTRACT_REQUEST_MESSAGE ya se envió hace pocos turnos, no duplicar:
    // caemos al LLM contextual breve (cierre suave) en un solo mensaje.
    if (recentlySent(CONTRACT_REQUEST_MESSAGE, conversationHistory, 6)) {
      const single = await contextualLlmReply(
        currentPhase,
        entities,
        conversationHistory,
        input.incomingText,
        {
          stayQuoteBlock,
          samePhaseTurnCount: input.samePhaseTurnCount,
          faqContext: input.faqContext,
        },
      );
      return { reply: single };
    }
    return buildContractHandoffPacket(entities, stayQuoteBlock, input.stayQuoteTotals);
  }

  const text = await generateReplyText(input);

  // Si el cliente envió datos útiles en el PRIMER mensaje (fase=welcome), el
  // flujo saltó el WELCOME_MESSAGE y respondió directamente con catálogo /
  // missing fields / puente. Anteponemos un saludo corto para que no se
  // sienta brusco.
  const firstTurnHasContent =
    currentPhase === "welcome" &&
    (tr.missingField != null ||
      tr.catalogPuenteOneNight === true ||
      tr.catalogSpecialSeason != null ||
      tr.datesIncoherent === true ||
      tr.action.type === "send_catalog");
  if (firstTurnHasContent) {
    return {
      reply: [
        "🙋‍♂️ ¡Hola! Te saluda *Hernán* de FincasYa.com.",
        "",
        text,
      ].join("\n"),
    };
  }

  return { reply: text };
}

/**
 * Arma los 2-3 mensajes que se envían cuando el cliente acaba de responder mascotas
 * y pasamos a `contract` por primera vez.
 *
 *   Con mascotas (hasPets=true):
 *     [1] Copy oficial de mascotas (bienvenida + cargos + reglas de convivencia).
 *     [2] Resumen: confirmación + finca + cotización con DESGLOSE + GRAN TOTAL.
 *     [3] Pedido de datos del contrato.
 *   Sin mascotas (hasPets=false):
 *     [1] Resumen: confirmación + finca + cotización.
 *     [2] Pedido de datos del contrato.
 *
 * Si `stayQuoteTotals` está disponible, el resumen muestra el desglose completo:
 * alojamiento, mascotas (con sub-líneas), y GRAN TOTAL. Si solo viene texto
 * formateado (legacy), se usa tal cual con un fallback. Si no hay nada, se
 * indica que el asesor confirmará el total.
 */
function buildContractHandoffPacket(
  entities: BotEntities,
  stayQuoteBlock?: string | null,
  stayQuoteTotals?: StayQuoteTotals | null,
): GenerateReplyResult {
  const intro = petConfirmationMessage(entities);
  const summaryMessage = buildSummaryWithTotals(
    entities,
    stayQuoteBlock,
    stayQuoteTotals,
    intro,
  );

  const petRulesMessage = petFeesSummaryForQuote(entities).trim();

  // Orden de burbujas: si hay mascotas, las reglas van primero (más detallado),
  // luego el resumen económico, luego el pedido de datos del contrato.
  const messages: string[] = [];
  if (petRulesMessage) messages.push(petRulesMessage);
  messages.push(summaryMessage);
  messages.push(CONTRACT_REQUEST_MESSAGE);

  return { reply: messages[0], extras: messages.slice(1) };
}

/**
 * Construye el mensaje de resumen con desglose completo:
 *   Confirmación
 *   📋 Resumen
 *   🏡 Finca
 *   💰 Para tus fechas (N noches): $X/noche. Total alojamiento: $Y.
 *   👥 N personas
 *   🐾 Mascotas (M): depósito $..., ingreso $..., aseo $... → $Z
 *   ━━━━━━━━━━━━━━━━━━━━
 *   💳 Total estimado: $TOTAL
 *
 * El "total estimado" se rotula así (no "Total final") porque el aseo +
 * depósito tienen reglas particulares que el asesor confirma en el contrato.
 */
function buildSummaryWithTotals(
  entities: BotEntities,
  stayQuoteBlock: string | null | undefined,
  stayQuoteTotals: StayQuoteTotals | null | undefined,
  intro: string,
): string {
  // Si no hay datos numéricos PERO sí texto, usamos texto tal cual + reglas mascotas.
  if (!stayQuoteTotals && stayQuoteBlock?.trim()) {
    return [intro, stayQuoteBlock.trim()].filter(Boolean).join("\n\n");
  }

  // Sin nada → fallback.
  if (!stayQuoteTotals) {
    return [
      intro,
      "No pude calcular el valor automático con los datos guardados. Un asesor te confirma el total en segundos 📲",
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  // Tenemos datos completos: construimos resumen con desglose y gran total.
  const t = stayQuoteTotals;
  const noches = t.nightsCount === 1 ? "noche" : "noches";
  const lines: string[] = [intro, "", "📋 *Resumen de tu estadía*"];
  if (t.propertyTitle) lines.push(`🏡 *${t.propertyTitle}*`);
  lines.push(
    `💰 Alojamiento (${t.nightsCount} ${noches}): ${formatCop(t.nightly)}/noche · ${formatCop(t.subtotal)}`,
  );
  if (t.cupo > 0) lines.push(`👥 ${t.cupo} personas`);

  // Desglose de mascotas (solo si lleva mascotas).
  let petsTotal = 0;
  if (entities.hasPets && (entities.petCount ?? 1) > 0) {
    const pets = petCostBreakdown(entities.petCount ?? 1);
    petsTotal = pets.total;
    const petLines: string[] = [];
    if (pets.deposit > 0)
      petLines.push(
        `   • Depósito reembolsable (${Math.min(pets.petCount, 2)}): ${formatCop(pets.deposit)}`,
      );
    if (pets.entryFee > 0)
      petLines.push(
        `   • Tarifa de ingreso (${pets.petCount - 2} desde la 3ª): ${formatCop(pets.entryFee)}`,
      );
    if (pets.cleaning > 0)
      petLines.push(`   • Aseo adicional (única vez): ${formatCop(pets.cleaning)}`);

    lines.push(
      `🐾 Mascotas (${pets.petCount}): ${formatCop(pets.total)}`,
      ...petLines,
    );
  }

  const grandTotal = t.subtotal + petsTotal;
  lines.push("━━━━━━━━━━━━━━━━━━━━");
  lines.push(`💳 *Total estimado:* ${formatCop(grandTotal)}`);

  if (petsTotal > 0) {
    lines.push(
      "",
      "_(El depósito de mascotas es reembolsable al check-out si no hay novedades. El asesor confirma el total final en tu contrato.)_",
    );
  }

  return lines.filter((s) => s != null).join("\n");
}

/**
 * Versión que solo devuelve UN mensaje (string). Antes era la función pública
 * `generateReply`; ahora la usa el wrapper para el caso normal (no paquete).
 *
 * Estrategia:
 *   1. Calcula el texto estático "ideal" para la fase + transición.
 *   2. Si ese texto YA fue enviado hace pocos turnos (cliente saludó o salió del guion),
 *      cae al LLM con un system prompt enriquecido que conoce fase + entidades + reglas.
 *   3. Caso especial: cliente saluda en cualquier fase ≠ welcome → respuesta corta del LLM
 *      recordando el siguiente paso, sin reenviar bloques largos.
 */
async function generateReplyText(input: ReplyInput): Promise<string> {
  const {
    transition: tr,
    entities,
    incomingText,
    conversationHistory,
    stayQuoteBlock,
    samePhaseTurnCount,
    faqContext,
  } = input;

  // Si el cliente envió datos útiles en el PRIMER mensaje (fase `welcome`),
  // saltamos el WELCOME_MESSAGE genérico y tratamos la fase efectiva como
  // `collecting` para el resto del flujo (catálogo, missing fields, puente,
  // etc.). El saludo corto se prepende en el wrapper `generateReply`.
  let currentPhase: BotPhase = input.currentPhase;
  const firstTurnHasContent =
    currentPhase === "welcome" &&
    (tr.missingField != null ||
      tr.catalogPuenteOneNight === true ||
      tr.catalogSpecialSeason != null ||
      tr.datesIncoherent === true ||
      tr.action.type === "send_catalog");
  if (firstTurnHasContent) {
    currentPhase = "collecting";
  }

  // Helper local: cae al LLM con contexto enriquecido cuando el static-text ya se envió.
  const fallback = (): Promise<string> =>
    contextualLlmReply(currentPhase, entities, conversationHistory, incomingText, {
      stayQuoteBlock,
      samePhaseTurnCount,
      faqContext,
    });

  // Si el static candidate ya se envió en los últimos turnos → ir directo al LLM.
  const respond = async (candidate: string, depth = 5): Promise<string> => {
    if (wasJustSent(candidate, conversationHistory, depth)) {
      return fallback();
    }
    return candidate;
  };

  const isGreetingOrVague =
    isPureGreeting(incomingText) || isVagueShortMessage(incomingText);

  // ── RAG literal: si la pregunta del cliente matcheó una FAQ en el RAG, ─────
  // devolvemos el texto del fragmento TAL CUAL (con sus emojis, saltos de línea
  // y formato exacto que el admin pegó en el panel), seguido de UNA línea de
  // cierre con el siguiente paso del FSM.
  //
  // Bypaseamos el LLM aquí porque el LLM tiende a parafrasear / condensar /
  // quitar emojis. El contenido del RAG fue redactado deliberadamente por el
  // admin: se respeta literal.
  //
  // Condiciones para activar (TODAS):
  //   - hay faqContext sustancial (>= 30 chars). `searchFaqForBot` ya filtra
  //     por score mínimo y devuelve SOLO el top-1 (no concatena FAQs).
  //   - el cliente NO acaba de saludar / mandar algo vago.
  //   - la fase NO es `welcome` ni `collecting`. En esas fases el cliente está
  //     construyendo la reserva (dando municipio, fechas, cupo, etc.) — interrumpirlo
  //     con un bloque FAQ rompe el flujo aunque el extractor reconozca alguna
  //     palabra "FAQ-y" en el texto.
  const faqLiteral = (faqContext ?? "").trim();
  const phaseAllowsRagBypass =
    currentPhase !== "welcome" && currentPhase !== "collecting";
  if (faqLiteral.length >= 30 && phaseAllowsRagBypass && !isGreetingOrVague) {
    const closing = nextStepFriendlyQuestion(
      currentPhase,
      entities,
      tr.missingField,
    );
    return [faqLiteral, "", closing].filter(Boolean).join("\n");
  }

  // ── Saludo (o vago) en cualquier fase ≠ welcome con turnos previos ──────
  // El cliente dice "Hola" / "Sí" / "ok" cuando ya estamos en mitad del flujo.
  // No reenviamos los bloques grandes: respondemos con LLM contextual breve.
  if (
    isGreetingOrVague &&
    currentPhase !== "welcome" &&
    (samePhaseTurnCount ?? 0) >= 1
  ) {
    return fallback();
  }

  // ── Bienvenida pura ───────────────────────────────────────────────────────
  if (currentPhase === "welcome") {
    return respond(WELCOME_MESSAGE);
  }

  /** Sesiones antiguas: ya en quote_shown y el siguiente paso es contract (solo pedido contrato). */
  if (currentPhase === "quote_shown" && tr.nextPhase === "contract") {
    if (!entities.contractName && !entities.contractCedula && !entities.contractEmail) {
      return respond(CONTRACT_REQUEST_MESSAGE);
    }
  }

  // NOTA: el paquete `pet_check → contract` (mascotas / resumen / contrato) se
  // maneja arriba en `generateReply` (wrapper), que lo descompone en 2-3 burbujas.
  // Aquí ya no lo procesamos para no devolver un muro de texto compuesto.

  // ── Collecting: pregunta por campo faltante ───────────────────────────────
  if (currentPhase === "collecting" || tr.nextPhase === "collecting") {
    if (tr.datesIncoherent) return respond(datesIncoherentMessage(entities));
    const userSaysTheyAlreadyAnswered =
      /\b(ya te hab[ií]a dicho|ya te lo dije|ya te dije|eso ya te|pero si te dije|ya lo dije arriba)\b/i.test(
        incomingText,
      );
    if (userSaysTheyAlreadyAnswered && tr.missingField) {
      return respond(followUpCollectingRecapMessage(entities, tr.missingField));
    }
    // Temporada especial (Navidad / Fin de año / Reyes) tiene prioridad sobre
    // el aviso de puente normal: el mínimo de noches y el copy son específicos.
    //
    // CRÍTICO: devolvemos el texto **DIRECTO** (sin `respond()`), porque si caye-
    // ra al `fallback()` el LLM podría alucinar "ya tengo X noches" cuando el
    // cliente solo dijo "7 noches" sin dar fechas concretas. Mientras el bloqueo
    // esté activo (nights < minNights), el flujo NO progresa — el bot insiste
    // hasta que las fechas reales cumplan el mínimo.
    //
    // 1er turno con bloqueo: aviso largo (todas las temporadas + la actual).
    // 2º+ turno (cliente ya vio el aviso pero no cambió fechas): recordatorio
    //         corto, sin repetir el bloque entero.
    if (tr.catalogSpecialSeason) {
      const reminderAlreadyShown = entities.puenteAcknowledged === true;
      if (reminderAlreadyShown) {
        return buildSpecialSeasonShortReminderEs(
          tr.catalogSpecialSeason.season,
          tr.catalogSpecialSeason.currentNights,
        );
      }
      return buildSpecialSeasonNoticeEs(
        tr.catalogSpecialSeason.season,
        tr.catalogSpecialSeason.currentNights,
      );
    }
    if (tr.catalogPuenteOneNight) {
      if (entities.checkIn && entities.checkOut) {
        if (userAsksPuenteAlternative(incomingText)) {
          return respond(buildPuenteFollowUpConversationEs(entities.checkIn, entities.checkOut));
        }
        return respond(buildPuenteShortNoticeEs(entities.checkIn, entities.checkOut));
      }
      return respond(buildPuenteShortNoticeEs("", ""));
    }
    if (tr.missingField === "planType" && userAsksWhyPlanTypeMatters(incomingText)) {
      return respond(planTypeWhyAnswerAndReask());
    }
    if (isGreetingOrVague && tr.missingField) {
      return respond(followUpCollectingRecapMessage(entities, tr.missingField));
    }
    if (tr.missingField) {
      // Si faltan exactamente 2 campos del catálogo, usar pregunta natural combinada
      // (evita el "pregunta-respuesta-pregunta-respuesta" innecesario al final).
      const combined = combinedQuestionForMissing(entities);
      if (combined) return respond(combined);
      const bundle = missingFieldsBundle(entities);
      if (bundle) return respond(bundle);
      return respond(missingFieldQuestion(tr.missingField, entities));
    }
    // Todos los datos listos → enviamos pre-catálogo estático SIEMPRE.
    // No usamos `respond()` (que cae al LLM si se envió antes), porque este
    // texto acompaña al envío real de fichas WhatsApp (acción `send_catalog`
    // que `inbound.ts` ejecuta justo después de mandar el `replyText`).
    // Si cayéramos al LLM, podría inventar fincas o decir "te envío el
    // catálogo" sin que el catálogo aparezca. Aquí es preferible repetir el
    // pre-catálogo a riesgo de alucinación.
    return preCatalogText(entities);
  }

  // ── Catálogo enviado ──────────────────────────────────────────────────────
  if (currentPhase === "catalog_sent") {
    const picked =
      entities.selectedPropertyName ||
      entities.selectedPropertyRetailerId ||
      entities.catalogUserPickedReply;
    if (picked) {
      return respond(petCheckMessage(propertyDisplayNameForPet(entities)));
    }
    if (isGreetingOrVague) {
      return respond(followUpCatalogSentVagueMessage());
    }
    // Cliente preguntó algo (precio, detalles, otra zona, etc.) → LLM contextual,
    // que ya tiene fase + entidades + reglas anti-invención.
    return fallback();
  }

  // ── Property selected → pet check (o confirmación si ya respondió mascotas) ─
  if (currentPhase === "property_selected") {
    if (entities.hasPets !== undefined) {
      return respond(petConfirmationMessage(entities));
    }
    return respond(petCheckMessage(propertyDisplayNameForPet(entities)));
  }

  // ── Pet check ────────────────────────────────────────────────────────────
  // Tres sub-casos:
  //   1. `hasPets` indefinido → preguntar "¿llevas mascotas?".
  //   2. `hasPets=true` pero `petCount` indefinido/≤0 → preguntar "¿cuántas?".
  //   3. `hasPets` resuelto → la transición avanza a `pet_rules_shown` o
  //      `quote_shown`. En este branch solo confirmamos antes de avanzar.
  if (currentPhase === "pet_check") {
    if (entities.hasPets === undefined) {
      if (isGreetingOrVague) return fallback();
      return respond(petCheckMessage(propertyDisplayNameForPet(entities)));
    }
    if (
      entities.hasPets === true &&
      (entities.petCount === undefined || entities.petCount <= 0)
    ) {
      return respond(
        "¡Genial, anotado! 🐾 ¿*Cuántas mascotas* vas a llevar en total? (Solo el número)",
      );
    }
    // hasPets resolved → la transición ya está pasando a `pet_rules_shown` o
    // `quote_shown` — el manejo de esos casos viene más abajo. Aquí dejamos un
    // texto puente por si la transición decide quedarse en pet_check.
    return respond(petConfirmationMessage(entities));
  }

  // ── Pet rules shown (mascotas → mostrar reglas + esperar confirmación) ──
  if (
    currentPhase === "pet_rules_shown" ||
    tr.nextPhase === "pet_rules_shown"
  ) {
    const n = Math.max(1, entities.petCount ?? 1);
    const intro = `Perfecto, anotamos *${n} mascota${n === 1 ? "" : "s"}* 🐾 Te comparto las condiciones para que las revisemos:`;
    const rules = petFeesSummaryForQuote(entities).trim();
    return [
      intro,
      "",
      rules,
      "",
      "¿*Estás de acuerdo* con estas condiciones? Responde *sí* y te comparto el resumen con el total 🤝",
    ].join("\n");
  }

  // ── Quote shown (mostrar resumen con total + esperar confirmación) ──────
  if (currentPhase === "quote_shown" || tr.nextPhase === "quote_shown") {
    const intro = entities.hasPets
      ? `Perfecto, anotamos *${Math.max(1, entities.petCount ?? 1)} mascota${(entities.petCount ?? 1) === 1 ? "" : "s"}* 🐾 Te envío el resumen con el costo total:`
      : "Sin mascotas, ¡anotado! 👍 Te comparto el resumen de tu reserva:";
    const summaryBody = buildSummaryWithTotals(
      entities,
      stayQuoteBlock,
      input.stayQuoteTotals,
      intro,
    );
    return [
      summaryBody,
      "",
      "¿*Procedemos con los datos para el contrato* y separar la fecha? ✍️",
    ].join("\n");
  }

  // ── Contract ──────────────────────────────────────────────────────────────
  if (currentPhase === "contract" || tr.nextPhase === "contract") {
    // Primer turno en contract → pedir todos los datos. Si el bloque ya se envió
    // recientemente (incluso incrustado en un mensaje compuesto), NO duplicarlo:
    // usar LLM contextual para reformular puntualmente.
    if (!entities.contractName && !entities.contractCedula && !entities.contractEmail) {
      if (recentlySent(CONTRACT_REQUEST_MESSAGE, conversationHistory, 6)) {
        return fallback();
      }
      return CONTRACT_REQUEST_MESSAGE;
    }
    // Datos parciales → LLM contextual con sistema de contrato (más rico que el viejo).
    return contextualLlmReply(
      currentPhase,
      entities,
      conversationHistory,
      incomingText,
      { stayQuoteBlock, samePhaseTurnCount, contractMode: true, faqContext },
    );
  }

  // ── Done ─────────────────────────────────────────────────────────────────
  if (currentPhase === "done") {
    return respond("¡Gracias! Un asesor te contactará en breve para finalizar los detalles 🤝✨");
  }

  // ── Fallback genérico → LLM contextual ────────────────────────────────────
  return fallback();
}

/**
 * Llama al LLM con system enriquecido (fase + entidades + reglas + cotización).
 * Garantiza que la respuesta nunca sea un reenvío de bloques previos.
 */
async function contextualLlmReply(
  phase: BotPhase,
  entities: BotEntities,
  history: CoreMessage[],
  userMessage: string,
  opts: {
    stayQuoteBlock?: string | null;
    samePhaseTurnCount?: number;
    contractMode?: boolean;
    faqContext?: string | null;
  } = {},
): Promise<string> {
  // Anti-bucle suave: si el cliente lleva varios turnos atascado SIN APORTAR DATOS,
  // ofrecer humano una vez. `samePhaseTurnCount` ya es "inteligente" (resetea con
  // progreso), así que aquí solo confirmamos que no se ofreció humano hace poco.
  if ((opts.samePhaseTurnCount ?? 0) >= 4) {
    if (!recentlySent(LOOP_OFFER_HUMAN_MESSAGE, history, 12)) {
      return LOOP_OFFER_HUMAN_MESSAGE;
    }
  }

  const baseSystem = buildContextSystemPrompt(phase, entities, {
    stayQuoteBlock: opts.stayQuoteBlock,
    samePhaseTurnCount: opts.samePhaseTurnCount,
    ragContext: opts.faqContext,
  });

  const system = opts.contractMode
    ? [baseSystem, "", contractSystemPrompt(entities)].join("\n")
    : baseSystem;

  try {
    const { text } = await generateText({
      model: openai(MODEL),
      system,
      messages: [
        ...history.slice(-10),
        { role: "user", content: userMessage },
      ],
      temperature: 0.4,
      maxTokens: 350,
    });
    const out = text.trim();
    // Defensa final: si el LLM por accidente reescribe un bloque ya enviado, lo cortamos.
    if (wasJustSent(out, history, 4)) {
      return "Perdona, ¿puedes contarme un poco más? Quiero ayudarte sin pedirte lo mismo otra vez 🙏";
    }
    return out;
  } catch {
    return "Perdona, tuve un problema técnico. ¿Puedes repetir tu mensaje? 🙏";
  }
}
