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
import type {
  BotPhase,
  BotEntities,
  ConversationTagFlags,
  StayQuoteTotals,
} from "./types";
import { formatCop, petCostBreakdown } from "./entities";
import { isPureGreeting, type TransitionResult } from "./transitions";
import {
  buildWelcomeMessage,
  buildShortGreeting,
  missingFieldQuestion,
  missingFieldsBundle,
  combinedQuestionForMissing,
  missingFieldsHuman,
  datesIncoherentMessage,
  datesInPastMessage,
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
  hasBotGreetedInHistory,
  prependGreetingIfNeeded,
  burstTextContainsGreeting,
} from "./prompts";
import {
  buildPuenteExplanationEs,
  buildPuenteFollowUpConversationEs,
  buildPuenteShortNoticeEs,
  buildPuenteShortReminderEs,
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

/**
 * El cliente NO entiende el aviso de puente y pide una explicación:
 * "¿cómo así que un puente festivo?", "¿qué es eso?", "no entiendo",
 * "¿por qué 2 noches?". Distinto de `userAsksPuenteAlternative` (que pide
 * otra fecha / una sola noche).
 */
function userAsksWhatIsPuente(incomingText: string): boolean {
  const t = String(incomingText ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  const asksWhatWhy =
    /\b(como\s+as[ií]|que\s+es|qu[eé]\s+significa|por\s+qu[eé]|no\s+entiendo|a\s+que\s+te\s+refieres|expl[ií]ca\w*|expl[ií]que\w*|no\s+s[eé]\s+que\s+es)\b/.test(
      t,
    );
  const mentionsPuente = /\b(puente|festivo|feriado|2\s+noches|dos\s+noches)\b/.test(
    t,
  );
  return asksWhatWhy && mentionsPuente;
}

/**
 * ¿El fragmento del RAG es la *política de mascotas*? Se usa para NO duplicar:
 * el bloque `pet_rules_shown` del FSM YA es la política de mascotas completa
 * (mismo contenido que la FAQ `faq:mascotas-politica`), así que compoundar esa
 * FAQ encima sería repetir lo mismo dos veces (bug "le repitió el mensaje de
 * mascotas"). Distintos a otras FAQs (wifi, horarios…), que sí deben mostrarse.
 */
function faqLooksLikePetPolicy(faq: string): boolean {
  const t = String(faq ?? "").toLowerCase();
  return (
    /\b(mascota|perr|gato)/.test(t) &&
    /(deposito|dep[oó]sito|piscina|pelaje|muebles|muerdan)/.test(t)
  );
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
   * Flags derivados de etiquetas de negocio. Se inyectan en
   * `buildContextSystemPrompt` para que el LLM ajuste tono (VIP / complicado
   * / recurrente). Las etiquetas de handoff duro ya se gestionaron en
   * `inbound.ts` antes de llegar aquí.
   */
  tagFlags?: ConversationTagFlags;
  /**
   * Canal de la conversación. En web y WhatsApp el saludo es "asistente
   * virtual de FincasYa". Default = whatsapp.
   */
  channel?: "whatsapp" | "web";
  /**
   * Fragmentos relevantes del RAG de FAQs (`searchFaqForBot`). Si vienen,
   * el `contextualLlmReply` los inyecta en el system prompt para que el
   * modelo responda con datos verificados (mascotas, horarios, pagos, etc.).
   */
  faqContext?: string | null;
  /**
   * Fragmentos del playbook (`searchPlaybookForBot`). Lazy vía callback.
   */
  fetchPlaybookContext?: () => Promise<string | null>;
  /** @deprecated Usar `fetchPlaybookContext`. */
  playbookContext?: string | null;
  /** Se invoca cuando el LLM recibió ejemplos del playbook en este turno. */
  onPlaybookUsed?: () => void;
  /**
   * Nombre del contacto (perfil de WhatsApp del cliente) tal como llega del
   * webhook de YCloud. Se usa SOLO para personalizar el saludo de bienvenida
   * y el short greeting del "first turn has content". El helper
   * `firstNameForGreeting` decide si es usable; si no, el copy cae a "¡Hola!"
   * sin nombre.
   */
  contactName?: string | null;
  /** Reanudar conversación con historial: sin bienvenida genérica. */
  resumeOngoingConversation?: boolean;
  /**
   * Veredicto del extractor LLM: el mensaje del cliente incluye un saludo
   * ("holas", "q hubo", typos — la IA interpreta, no enumera). Alimenta el
   * saludo garantizado; el regex queda como red de seguridad.
   */
  clientGreeted?: boolean;
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

/** Cliente molesto, corrige algo o rechaza — preferir LLM contextual. */
function isClientFrustratedOrPushingBack(text: string): boolean {
  const t = normalizeForCompare(text);
  return /\b(ya te dije|te estoy diciendo|como asi|que no|no me interesa|robot|pesimo|p[eé]simo|imposible|sin contexto|mal servicio|no entiend|hablando con un robot|vuelve y lo|otra vez lo mismo|que servicio)\b/.test(
    t,
  );
}

/** Mensaje con datos de reserva (fechas, cupo, etc.) — no interrumpir con FAQs. */
function messageLooksLikeBookingDetails(text: string): boolean {
  const t = normalizeForCompare(text);
  return /\b(fin de semana|finde|sabado|domingo|lunes|entrando|salida|salir|personas|somos\s+\d+|noches|cupo|estad[ií]a|alquilar|finca)\b/.test(
    t,
  );
}

function shouldPreferContextualLlm(
  incomingText: string,
  history: CoreMessage[],
  staticBlock?: string,
): boolean {
  if (isClientFrustratedOrPushingBack(incomingText)) return true;
  if (messageLooksLikeBookingDetails(incomingText) && staticBlock?.includes("a partir de ma")) {
    return true;
  }
  if (staticBlock && recentlySent(staticBlock, history, 2)) return true;
  return false;
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
  /** true si el LLM recibió ejemplos del playbook en este turno. */
  playbookUsed?: boolean;
};

/**
 * Cupo mínimo para considerar una reserva "de capacidad de grupo" y disparar
 * el mensaje complementario de personal de servicio (Escenario B del spec).
 * Reservas más pequeñas (parejas, familias chicas) no lo reciben.
 */
const PERSONAL_SERVICIO_GROUP_THRESHOLD = 10;

/**
 * Mensaje complementario sobre PERSONAL DE SERVICIO (Escenario B del spec).
 *
 * Se envía automáticamente como burbuja informativa cuando el cliente ve la
 * cotización (entra a `quote_shown`) de un hospedaje con capacidad de grupo
 * (`cupo >= PERSONAL_SERVICIO_GROUP_THRESHOLD`). NO es respuesta a una
 * pregunta — por eso el opener es "Un dato útil…" en vez de "¡Claro que sí!"
 * (ese copy formal es el de la FAQ, Escenario A, que responde cuando el
 * cliente pregunta explícitamente).
 *
 */
function buildPersonalServicioInfo(): string {
  return [
    "💡 Un dato útil para tu estadía — Personal de servicio:",
    "",
    "🤝 Podemos recomendarte personal de confianza para apoyo en cocina y aseo durante tu hospedaje 🏡✨",
    "",
    "💰 Las tarifas van desde $100.000 COP por día, según la temporada ☀️",
    "⏰ La jornada de servicio es aproximadamente de 8 horas.",
    "",
    "⚠️ Importante:",
    "• 👥 Para grupos mayores a 15 personas, sugerimos contratar 2 personas de servicio ✅",
    "• 🏠 En algunas fincas, este servicio es obligatorio según las políticas de la propiedad.",
    "",
    "✨ Si deseas apoyo de personal de servicio durante tu estadía, avísanos y te ayudamos a coordinarlo.",
  ].join("\n");
}

/**
 * Genera la respuesta del bot para este turno. Puede ser 1 mensaje (caso normal)
 * o varios (paquete tras `pet_check` → contrato, que se descompone en mascotas /
 * resumen / pedido de datos para evitar el muro de texto en WhatsApp).
 */
/** ¿El cliente ya aportó ALGÚN dato real de la reserva (no solo intención vaga)? */
function clientGaveCatalogData(e: BotEntities): boolean {
  return (
    !!e.location ||
    !!e.checkIn ||
    !!e.checkOut ||
    (e.cupo ?? 0) > 0 ||
    e.isEvento !== undefined ||
    !!e.planType ||
    !!e.selectedPropertyName ||
    !!e.selectedPropertyRetailerId
  );
}

/**
 * ¿Es el primer turno (fase `welcome`) pero el cliente YA trajo contenido real
 * (datos de reserva o el flujo avanzó)? En ese caso saltamos la BIENVENIDA
 * larga y solo anteponemos un saludo corto.
 *
 * ⚠️ CLAVE: si el cliente NO dio datos —intención vaga tipo "quiero alquilar
 * una finca", "buenos días para una finca"— esto es FALSE aunque `missingField`
 * exista, para que se envíe la BIENVENIDA COMPLETA (que saluda con el estilo
 * FincasYa y lista lo que necesitamos), en vez del pedido de datos a secas sin
 * saludo. `missingField != null` es casi siempre cierto en `collecting`, así que
 * SOLO cuenta como "contenido" cuando el cliente aportó algún dato.
 */
function isFirstTurnWithRealContent(
  phase: BotPhase,
  tr: TransitionResult,
  e: BotEntities,
): boolean {
  if (phase !== "welcome") return false;
  if (tr.action.type === "send_catalog") return true;
  if (tr.nextPhase !== "welcome" && tr.nextPhase !== "collecting") return true;
  if (
    tr.catalogPuenteOneNight === true ||
    tr.catalogSpecialSeason != null ||
    tr.datesIncoherent === true ||
    tr.datesInPast === true
  ) {
    return true;
  }
  if (tr.missingField != null && clientGaveCatalogData(e)) return true;
  return false;
}

export async function generateReply(
  input: ReplyInput,
): Promise<GenerateReplyResult> {
  const result = await generateReplyUngreeted(input);
  // SALUDO GARANTIZADO (portado de fincasya-prueba): si el cliente saludó en
  // su mensaje y la respuesta no devuelve el saludo, se antepone el opener
  // oficial con franja horaria. SOLO si el bot AÚN NO ha saludado en esta
  // conversación — una vez saludó, JAMÁS se vuelve a anteponer (evita el
  // "Hola, señora Carmen…" repetido en cada turno).
  const botAlreadyGreeted =
    hasBotGreetedInHistory(input.conversationHistory) ||
    Boolean(input.resumeOngoingConversation);
  if (botAlreadyGreeted) return result;
  return {
    ...result,
    reply: prependGreetingIfNeeded(
      result.reply,
      input.contactName,
      input.incomingText,
      input.entities.clientGender,
      new Date(),
      input.clientGreeted,
    ),
  };
}

async function generateReplyUngreeted(
  input: ReplyInput,
): Promise<GenerateReplyResult> {
  const { currentPhase, transition: tr, entities, conversationHistory, stayQuoteBlock } = input;

  // BIENVENIDA OFICIAL EN PRIMER TURNO (comportamiento de fincasya-prueba):
  // si el bot AÚN no ha saludado y el cliente saludó — aunque haya dado
  // intención o zona ("hola, para alquilar una finca en Bogotá") — va la
  // bienvenida oficial COMPLETA del equipo (checklist verbatim), NO el
  // mensaje redactado por el LLM. Solo se omite si el cliente ya dio todo
  // y el turno envía catálogo directamente.
  const botGreetedBefore =
    hasBotGreetedInHistory(conversationHistory) ||
    Boolean(input.resumeOngoingConversation);
  const clientGreetedThisTurn =
    input.clientGreeted === true ||
    burstTextContainsGreeting(input.incomingText);
  if (
    currentPhase === "welcome" &&
    !botGreetedBefore &&
    clientGreetedThisTurn &&
    tr.action.type !== "send_catalog"
  ) {
    return {
      reply: buildWelcomeMessage(
        input.contactName,
        input.channel,
        entities.clientGender,
      ),
    };
  }

  let playbookUsed = false;
  const inputWithPlaybookTracking: ReplyInput = {
    ...input,
    onPlaybookUsed: () => {
      playbookUsed = true;
    },
  };

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
          fetchPlaybookContext: input.fetchPlaybookContext,
          playbookContext: input.playbookContext,
          tagFlags: input.tagFlags,
          channel: input.channel,
          onPlaybookUsed: inputWithPlaybookTracking.onPlaybookUsed,
        },
      );
      if (single.playbookUsed) playbookUsed = true;
      return { reply: single.text, playbookUsed };
    }
    return buildContractHandoffPacket(entities, stayQuoteBlock, input.stayQuoteTotals);
  }

  const text = await generateReplyText(inputWithPlaybookTracking);

  const alreadyGreeted =
    hasBotGreetedInHistory(conversationHistory) ||
    Boolean(input.resumeOngoingConversation);

  // Si el cliente envió datos útiles en el PRIMER mensaje (fase=welcome), el
  // flujo saltó el WELCOME_MESSAGE y respondió directamente con catálogo /
  // missing fields / puente. Anteponemos un saludo corto para que no se
  // sienta brusco.
  const firstTurnHasContent = isFirstTurnWithRealContent(currentPhase, tr, entities);
  if (firstTurnHasContent && !input.resumeOngoingConversation && !alreadyGreeted) {
    const greeting = buildShortGreeting(input.contactName, input.channel, entities.clientGender);
    // Si además el cliente hizo una pregunta clara en su primer mensaje
    // (`faqContext` poblado por el RAG), la respondemos como PRIMERA burbuja
    // (con el saludo corto) y dejamos los datos faltantes como segunda. Sin
    // esto la pregunta quedaría sin responder.
    const faqFirstTurn = (input.faqContext ?? "").trim();
    if (faqFirstTurn.length >= 30 && text.trim().length > 0) {
      return {
        reply: [greeting, "", faqFirstTurn].join("\n"),
        extras: [text],
        playbookUsed,
      };
    }
    return { reply: [greeting, "", text].join("\n"), playbookUsed };
  }

  // ── Burst con pregunta + dato de flujo ────────────────────────────────────
  // El cliente envió DOS cosas en el mismo turno (ej. "Tengo 3 mascotas + ¿cuáles
  // son los horarios?"). El extractor recogió el dato de flujo (mascotas) y la
  // transición AVANZÓ de fase (pet_check → pet_rules_shown), pero la pregunta
  // de horarios quedó sin responder porque el FSM emitió el bloque estático de
  // reglas y el RAG bypass se inhibió (precisamente por estar avanzando).
  //
  // Aquí emitimos DOS burbujas separadas en el mismo turno:
  //   1. La respuesta literal del RAG a la pregunta del cliente.
  //   2. El mensaje del FSM correspondiente a la nueva fase (`text`).
  //
  // Condiciones (TODAS):
  //   - `faqContext` substancial (>= 30 chars). `searchFaqForBot` ya filtró por
  //     score y devolvió SOLO el top-1.
  //   - la transición avanzó de fase (`tr.nextPhase !== currentPhase`).
  //   - la fase ANTERIOR no era welcome / collecting (donde interrumpir con FAQ
  //     rompe el flujo de recolección de datos).
  //   - el FSM ya emitió un texto NO vacío (sino no tiene sentido la segunda
  //     burbuja).
  const faqLiteralCompound = (input.faqContext ?? "").trim();
  const phaseAdvancedCompound = tr.nextPhase !== currentPhase;
  const compoundPhaseAllowed =
    currentPhase !== "welcome" && currentPhase !== "collecting";

  // ── Personal de servicio — Escenario B (mensaje automático) ───────────────
  // Cuando el cliente ENTRA a `quote_shown` (acaba de "cotizar", ve el resumen
  // con totales) Y la reserva es de capacidad de grupo, adjuntamos una burbuja
  // informativa sobre el personal de servicio. Solo al ENTRAR (no al quedarse
  // en quote_shown re-emitiendo el resumen) → se envía exactamente una vez.
  const enteringQuoteShown =
    tr.nextPhase === "quote_shown" && currentPhase !== "quote_shown";
  const personalServicioExtra =
    enteringQuoteShown &&
    (entities.cupo ?? 0) >= PERSONAL_SERVICIO_GROUP_THRESHOLD
      ? buildPersonalServicioInfo()
      : null;

  // Defensa anti-duplicado: si el FSM va a emitir el bloque `pet_rules_shown`
  // (que YA es la política de mascotas completa) y la FAQ matcheada es
  // justamente la de mascotas, NO compoundamos — sería el MISMO contenido dos
  // veces. Otras FAQs (wifi, horarios, ubicación…) sí se compoundan normal.
  const faqDuplicatesPetBlock =
    tr.nextPhase === "pet_rules_shown" &&
    faqLooksLikePetPolicy(faqLiteralCompound);

  if (
    faqLiteralCompound.length >= 30 &&
    phaseAdvancedCompound &&
    compoundPhaseAllowed &&
    text.trim().length > 0 &&
    !faqDuplicatesPetBlock
  ) {
    const extras = personalServicioExtra
      ? [text, personalServicioExtra]
      : [text];
    return { reply: faqLiteralCompound, extras, playbookUsed };
  }

  // ── Pregunta FAQ durante welcome / collecting ─────────────────────────────
  // El cliente hizo una pregunta clara (ej. "¿tienen personal de servicio?")
  // mientras aún se recogen los datos de la reserva. El RAG-bypass de
  // `generateReplyText` se inhibe en welcome/collecting (para no interrumpir
  // la recolección con FAQs disparadas por palabras sueltas), así que sin
  // esto la pregunta del cliente quedaba SIN responder.
  //
  // Es seguro responderla aquí: `faqContext` solo viene poblado cuando
  // `inbound.ts` ya clasificó el mensaje como pregunta REAL — `looksLikeQuestion`
  // excluye los statements tipo "tengo 3 perros" / "somos 10" — y además hubo
  // match con score suficiente en el RAG. Emitimos 2 burbujas: (1) la
  // respuesta FAQ literal y (2) la pregunta del FSM por los datos que faltan.
  if (
    (currentPhase === "welcome" || currentPhase === "collecting") &&
    faqLiteralCompound.length >= 30 &&
    text.trim().length > 0 &&
    !messageLooksLikeBookingDetails(input.incomingText)
  ) {
    return { reply: faqLiteralCompound, extras: [text], playbookUsed };
  }

  if (personalServicioExtra) {
    return { reply: text, extras: [personalServicioExtra], playbookUsed };
  }

  return { reply: text, playbookUsed };
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
 * indica que el experto confirmará el total.
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
 * depósito tienen reglas particulares que el experto confirma en el contrato.
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

  // Sin nada → fallback. Texto pensado para NO ser contradictorio con el
  // pedido de datos del contrato que viene después (antes decía "Un experto te
  // confirma el total" pero seguía pidiendo datos para contrato — mensaje
  // mixto que confundía al cliente).
  if (!stayQuoteTotals) {
    return [
      intro,
      "El *total exacto* (incluyendo cargos por mascotas si aplica) queda confirmado en el contrato 📋",
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

  const damageDeposit = Math.max(0, Number(t.damageDeposit ?? 0) || 0);
  const wristbandFee = Math.max(0, Number(t.wristbandFee ?? 0) || 0);

  if (damageDeposit > 0) {
    lines.push(
      `🛡️ Depósito por daños (reembolsable): ${formatCop(damageDeposit)}`,
    );
  }
  if (wristbandFee > 0) {
    lines.push(`🎫 Manilla condominio: ${formatCop(wristbandFee)}`);
  }

  const grandTotal = t.subtotal + petsTotal + damageDeposit + wristbandFee;
  lines.push("━━━━━━━━━━━━━━━━━━━━");
  lines.push(`💳 *Total estimado:* ${formatCop(grandTotal)}`);

  const footnotes: string[] = [];
  if (petsTotal > 0) {
    footnotes.push(
      "El depósito de mascotas es reembolsable al check-out si no hay novedades",
    );
  }
  if (damageDeposit > 0) {
    footnotes.push(
      "el depósito por daños se reintegra al check-out si la propiedad queda en orden",
    );
  }
  if (footnotes.length > 0) {
    lines.push(
      "",
      `_(${footnotes.join(". ")}. El experto confirma el total final en tu contrato.)_`,
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
    playbookContext,
  } = input;

  const alreadyGreeted =
    hasBotGreetedInHistory(conversationHistory) ||
    Boolean(input.resumeOngoingConversation);

  // PAGINACIÓN DEL CATÁLOGO: si el cliente pidió "ver más opciones" y el
  // guard de `index.ts` sobrescribió `tr` con `action: send_catalog +
  // paginate: true`, devolvemos el texto pre-catálogo de paginación INMEDIA-
  // TAMENTE — sin pasar por las ramas del FSM ni por el LLM. Si caemos al
  // LLM, este dice "esas son las opciones" y después llegan las fichas
  // nuevas de la paginación, generando una respuesta contradictoria.
  if (
    tr.action.type === "send_catalog" &&
    tr.action.paginate === true
  ) {
    return [
      "¡Claro! Aquí van *más opciones* 🏡✨",
      "",
      "💰 Los valores son *aproximados* por noche y pueden variar según la *temporada*.",
      "👉 Cuéntanos *cuál te llama la atención* y con gusto te ayudamos con la reserva 🤝",
    ].join("\n");
  }

  // Si el cliente envió datos útiles en el PRIMER mensaje (fase `welcome`),
  // saltamos el WELCOME_MESSAGE genérico y tratamos la fase efectiva como
  // `collecting` para el resto del flujo (catálogo, missing fields, puente,
  // etc.). El saludo corto se prepende en el wrapper `generateReply`.
  let currentPhase: BotPhase = input.currentPhase;
  const firstTurnHasContent = isFirstTurnWithRealContent(input.currentPhase, tr, entities);
  if (firstTurnHasContent) {
    currentPhase = "collecting";
  }
  if (input.resumeOngoingConversation && currentPhase === "welcome") {
    currentPhase = "collecting";
  }

  const llmContextOpts = {
    stayQuoteBlock,
    samePhaseTurnCount,
    faqContext,
    fetchPlaybookContext: input.fetchPlaybookContext,
    playbookContext,
    tagFlags: input.tagFlags,
    channel: input.channel,
    alreadyGreeted,
    contactName: input.contactName,
    onPlaybookUsed: input.onPlaybookUsed,
  };

  // Helper local: cae al LLM con contexto enriquecido cuando el static-text ya se envió.
  const fallback = async (): Promise<string> => {
    const r = await contextualLlmReply(
      currentPhase,
      entities,
      conversationHistory,
      incomingText,
      llmContextOpts,
    );
    if (r.playbookUsed) input.onPlaybookUsed?.();
    return r.text;
  };

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
  //   - la transición NO avanza de fase (`tr.nextPhase === currentPhase`). Si
  //     el cliente progresó el flujo en el mismo turno (ej. "tengo 3 mascotas
  //     + ¿cuáles son los horarios?"), el wrapper `generateReply` se encarga
  //     de emitir DOS burbujas separadas: (1) la FAQ literal y (2) el mensaje
  //     del FSM correspondiente al nuevo phase. Aquí solo cubrimos preguntas
  //     "puras" donde el cliente NO aportó datos nuevos.
  const faqLiteral = (faqContext ?? "").trim();
  const phaseAllowsRagBypass =
    currentPhase !== "welcome" && currentPhase !== "collecting";
  const phaseAdvancing = tr.nextPhase !== currentPhase;
  if (
    faqLiteral.length >= 30 &&
    phaseAllowsRagBypass &&
    !isGreetingOrVague &&
    !phaseAdvancing
  ) {
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

  if (isClientFrustratedOrPushingBack(incomingText)) {
    return fallback();
  }

  // ── Bienvenida pura ───────────────────────────────────────────────────────
  if (currentPhase === "welcome" && !input.resumeOngoingConversation && !alreadyGreeted) {
    // Personalizamos con el primer nombre del contacto (si YCloud lo trajo).
    // El anti-repetición compara contra el WELCOME_MESSAGE genérico (alias),
    // así que aunque el texto personalizado difiera en los primeros 50 chars
    // el chequeo `wasJustSent` no genera falso positivo aquí (welcome solo
    // se emite una vez por sesión normalmente).
    return respond(buildWelcomeMessage(input.contactName, input.channel, entities.clientGender));
  }

  // NOTA: el paso `quote_shown → contract` cae al branch `contract` más abajo
  // (con `tr.nextPhase === "contract"`), que ya gestiona la primera vez con
  // `CONTRACT_REQUEST_MESSAGE` y la anti-duplicación.
  //
  // NOTA: el paquete `pet_check → contract` (mascotas / resumen / contrato) se
  // maneja arriba en `generateReply` (wrapper), que lo descompone en 2-3 burbujas.
  // Aquí ya no lo procesamos para no devolver un muro de texto compuesto.

  // ── Collecting: pregunta por campo faltante ───────────────────────────────
  // Se EXCLUYE cuando la transición avanzó a una fase de reserva (pet_check /
  // pet_rules_shown / quote_shown / contract) — eso pasa cuando el cliente
  // nombró una finca puntual y se saltó el catálogo: en ese caso dejamos que
  // los branches de esas fases (más abajo) emitan el mensaje correcto, en vez
  // de caer al `preCatalogText` de este branch.
  if (
    (currentPhase === "collecting" || tr.nextPhase === "collecting") &&
    tr.nextPhase !== "pet_check" &&
    tr.nextPhase !== "pet_rules_shown" &&
    tr.nextPhase !== "quote_shown" &&
    tr.nextPhase !== "contract"
  ) {
    // Fechas incoherentes = BLOQUEO duro. Devolvemos el texto DIRECTO (sin
    // `respond()`): si cayéramos al `fallback()` por anti-repetición (el
    // mensaje ya se envió un turno antes), el LLM IGNORA el problema de
    // fechas y alucina un happy-path — "¡Ya tengo todo, te envío el
    // catálogo!" — sin que el catálogo exista (las fechas inválidas impiden
    // generarlo). Repetir la pregunta de fechas es correcto y necesario; el
    // anti-bucle de `index.ts` (con `madeProgress` bloqueado por fechas
    // incoherentes) escala a un experto si el cliente nunca las corrige.
    // Fechas en el pasado: si el cliente corrige o ya vimos el bloque, usar LLM.
    if (tr.datesInPast) {
      const staticMsg = datesInPastMessage();
      if (shouldPreferContextualLlm(incomingText, conversationHistory, staticMsg)) {
        return fallback();
      }
      return respond(staticMsg);
    }
    if (tr.datesIncoherent) {
      const staticMsg = datesIncoherentMessage(entities);
      if (shouldPreferContextualLlm(incomingText, conversationHistory, staticMsg)) {
        return fallback();
      }
      return respond(staticMsg);
    }
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
      // BLOQUEO DURO de puente: SIEMPRE devolvemos texto DIRECTO (sin
      // `respond()`). Si cayéramos al `fallback()` por anti-repetición el LLM
      // ignoraría el bloqueo y alucinaría "ya tengo todo, te envío el
      // catálogo" — el mismo bug que teníamos con `datesIncoherent`. Repetir
      // el recordatorio de puente es correcto; el anti-bucle de `index.ts`
      // escala a un experto si el cliente nunca extiende las fechas.
      if (entities.checkIn && entities.checkOut) {
        // "¿cómo así que un puente festivo?" → explicación clara.
        if (userAsksWhatIsPuente(incomingText)) {
          return buildPuenteExplanationEs(entities.checkIn, entities.checkOut);
        }
        // El cliente pide/insiste en 1 noche u otra fecha → copy de seguimiento.
        if (userAsksPuenteAlternative(incomingText)) {
          return buildPuenteFollowUpConversationEs(entities.checkIn, entities.checkOut);
        }
        // 1er turno con bloqueo → aviso completo (nombra el festivo).
        // 2º+ turno (ya avisado, no extendió fechas) → recordatorio corto.
        return entities.puenteAcknowledged === true
          ? buildPuenteShortReminderEs(entities.checkIn, entities.checkOut)
          : buildPuenteShortNoticeEs(entities.checkIn, entities.checkOut);
      }
      return buildPuenteShortNoticeEs("", "");
    }
    if (tr.missingField === "planType" && userAsksWhyPlanTypeMatters(incomingText)) {
      return respond(planTypeWhyAnswerAndReask());
    }
    if (isGreetingOrVague && tr.missingField) {
      return respond(followUpCollectingRecapMessage(entities, tr.missingField));
    }
    if (tr.missingField) {
      // El FSM decide QUÉ datos faltan; la IA los pide con el TONO del equipo
      // (playbook), no con el bloque estático de viñetas. Si la IA falla, caemos
      // al texto estático preciso (combinada → bundle → pregunta única).
      const staticFallback =
        combinedQuestionForMissing(entities) ??
        missingFieldsBundle(entities) ??
        missingFieldQuestion(tr.missingField, entities);
      const missingHuman = missingFieldsHuman(entities);
      if (missingHuman.length === 0) return respond(staticFallback);
      const r = await contextualLlmReply(
        currentPhase,
        entities,
        conversationHistory,
        incomingText,
        { ...llmContextOpts, collectingAsk: missingHuman },
      );
      if (r.playbookUsed) input.onPlaybookUsed?.();
      return r.failed ? staticFallback : r.text;
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
      // Si el cliente solo eligió la finca (sin dar info de mascotas en el
      // mismo turno), preguntamos por mascotas. Si YA dio info de mascotas
      // (burst tipo "Quiero esta + Tengo 3 mascotas"), dejamos caer a los
      // branches de pet_rules_shown / quote_shown según `tr.nextPhase`
      // — la transición ya tomó esa decisión arriba en `transitions.ts`.
      if (entities.hasPets === undefined) {
        return respond(petCheckMessage(propertyDisplayNameForPet(entities)));
      }
      // Fall-through al branch que corresponda según tr.nextPhase.
    } else {
      if (isGreetingOrVague) {
        return respond(followUpCatalogSentVagueMessage());
      }
      // Cliente preguntó algo (precio, detalles, otra zona, etc.) → LLM
      // contextual, que ya tiene fase + entidades + reglas anti-invención.
      return fallback();
    }
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
  //   3. `hasPets` resuelto → DEJAR CAER al branch `pet_rules_shown` (si
  //      tiene mascotas) o `quote_shown` (si no), que vienen más abajo. NO
  //      retornamos `petConfirmationMessage` aquí porque ese mensaje promete
  //      "Te envío el resumen" sin enviarlo realmente, y bloquea el avance
  //      al branch que sí muestra reglas/resumen.
  // `tr.nextPhase === "pet_check"` cubre el caso "finca nombrada": el cliente
  // nombró una finca puntual, la transición se saltó el catálogo y entra
  // directo a pet_check desde welcome/collecting.
  if (currentPhase === "pet_check" || tr.nextPhase === "pet_check") {
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
    // hasPets resuelto → fall-through al branch que corresponda según
    // `tr.nextPhase`. (No `return` aquí.)
  }

  // ── Pet rules shown ─────────────────────────────────────────────────────
  // Sólo emitimos las reglas cuando la transición nos ESTÁ LLEVANDO a esta
  // fase (`tr.nextPhase === "pet_rules_shown"`) y veníamos de otra (típica-
  // mente `pet_check`). Si ya estábamos en `pet_rules_shown` y la transición
  // se queda en `pet_rules_shown`, significa que el cliente NO confirmó —
  // dejamos al LLM contextual gestionar la respuesta (puede aclarar dudas
  // sobre las reglas, costos, depósito, etc.) sin reenviar el bloque entero.
  if (tr.nextPhase === "pet_rules_shown") {
    if (currentPhase === "pet_rules_shown") {
      // Cliente está en pet_rules_shown pero no confirmó: LLM contextual.
      return fallback();
    }
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

  // ── Quote shown ─────────────────────────────────────────────────────────
  // Sólo emitimos el resumen cuando la transición nos LLEVA a `quote_shown`,
  // o cuando el cliente se queda en quote_shown sin confirmar claramente. En
  // este último caso ANTES caíamos al LLM contextual — pero el LLM, al verse
  // pidiendo un resumen sin tener `stayQuoteTotals` resuelto, inventaba
  // números absurdos (ej. multiplicaba el precio mal, calculaba 3 depósitos
  // en lugar de 2 según la política de mascotas). El bug era una violación
  // sistemática de `ANTI_HALLUCINATION_RULES` que afectaba la cotización
  // final visible al cliente.
  //
  // Solución: cuando estamos en quote_shown stay, re-emitir el MISMO resumen
  // estructurado (con cotización si está, o fallback "el total exacto se
  // confirma en el contrato"). Es determinístico y nunca inventa números.
  // Si el cliente pregunta algo ortogonal (ej. "tienen wifi?"), el wrapper
  // `generateReply` adicionará la respuesta FAQ como burbuja previa si el
  // RAG matchea.
  if (tr.nextPhase === "quote_shown") {
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
    // recientemente (incluso incrustado en un mensaje compuesto), NO caemos al
    // LLM (que tiende a entrar en loops de "¿quieres que te explique?" + invenc-
    // ión de cálculos de abono). En su lugar, mandamos un recordatorio CORTO
    // y determinístico que pide los datos puntuales. Solo después de 12+
    // mensajes desde el primer envío permitimos LLM para reformular puntual-
    // mente — para entonces ya pasaron varios turnos y el contexto es otro.
    if (!entities.contractName && !entities.contractCedula && !entities.contractEmail) {
      if (recentlySent(CONTRACT_REQUEST_MESSAGE, conversationHistory, 12)) {
        return (
          "Cuando tengas a la mano los datos, me los pasas para preparar el contrato 📋\n\n" +
          "👤 Nombre completo\n" +
          "🪪 Cédula\n" +
          "📧 Correo electrónico\n" +
          "📱 Teléfono\n" +
          "🏠 Dirección"
        );
      }
      return CONTRACT_REQUEST_MESSAGE;
    }
    // Datos parciales → LLM contextual con sistema de contrato (más rico que el viejo).
    const contractReply = await contextualLlmReply(
      currentPhase,
      entities,
      conversationHistory,
      incomingText,
      {
        stayQuoteBlock,
        samePhaseTurnCount,
        contractMode: true,
        faqContext,
        fetchPlaybookContext: input.fetchPlaybookContext,
        playbookContext,
        tagFlags: input.tagFlags,
        channel: input.channel,
        onPlaybookUsed: input.onPlaybookUsed,
      },
    );
    if (contractReply.playbookUsed) input.onPlaybookUsed?.();
    return contractReply.text;
  }

  // ── Done ─────────────────────────────────────────────────────────────────
  if (currentPhase === "done") {
    return respond("¡Gracias! Un experto te contactará en breve para finalizar los detalles 🤝✨");
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
    fetchPlaybookContext?: () => Promise<string | null>;
    playbookContext?: string | null;
    /** Datos faltantes (frases) para que el LLM los pida con tono. */
    collectingAsk?: string[] | null;
    tagFlags?: ConversationTagFlags;
    channel?: "whatsapp" | "web";
    alreadyGreeted?: boolean;
    contactName?: string | null;
    onPlaybookUsed?: () => void;
  } = {},
): Promise<{ text: string; playbookUsed: boolean; failed?: boolean }> {
  // Anti-bucle suave: si el cliente lleva varios turnos atascado SIN APORTAR DATOS,
  // ofrecer humano una vez. `samePhaseTurnCount` ya es "inteligente" (resetea con
  // progreso), así que aquí solo confirmamos que no se ofreció humano hace poco.
  if ((opts.samePhaseTurnCount ?? 0) >= 4) {
    if (!recentlySent(LOOP_OFFER_HUMAN_MESSAGE, history, 12)) {
      return { text: LOOP_OFFER_HUMAN_MESSAGE, playbookUsed: false };
    }
  }

  let playbookContext = String(opts.playbookContext ?? "").trim();
  let playbookUsed = playbookContext.length > 0;
  if (!playbookContext && opts.fetchPlaybookContext) {
    try {
      const fetched = String((await opts.fetchPlaybookContext()) ?? "").trim();
      if (fetched) {
        playbookContext = fetched;
        playbookUsed = true;
        opts.onPlaybookUsed?.();
      }
    } catch (err) {
      console.error("[contextualLlmReply] fetchPlaybookContext falló:", err);
    }
  }

  const baseSystem = buildContextSystemPrompt(phase, entities, {
    stayQuoteBlock: opts.stayQuoteBlock,
    samePhaseTurnCount: opts.samePhaseTurnCount,
    ragContext: opts.faqContext,
    playbookContext: playbookContext || null,
    collectingAsk: opts.collectingAsk,
    tagFlags: opts.tagFlags,
    channel: opts.channel,
    alreadyGreeted: opts.alreadyGreeted,
    contactName: opts.contactName,
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
      temperature: 0.5,
      maxTokens: 400,
    });
    const out = text.trim();
    // Defensa final: si el LLM por accidente reescribe un bloque ya enviado, lo cortamos.
    if (wasJustSent(out, history, 4)) {
      return {
        text: "Perdona, ¿puedes contarme un poco más? Quiero ayudarte sin pedirte lo mismo otra vez 🙏",
        playbookUsed,
      };
    }
    return { text: out, playbookUsed };
  } catch (err) {
    // OpenAI falló (timeout, 429, 5xx, sin cupo). Logueamos para diagnosticar
    // — si esto aparece seguido, revisar la cuenta de OpenAI (cuota/billing).
    console.error("[contextualLlmReply] generateText falló — fallback técnico:", err);
    return {
      text: "Perdona, tuve un problema técnico. ¿Puedes repetir tu mensaje? 🙏",
      playbookUsed,
      failed: true,
    };
  }
}
