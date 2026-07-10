/**
 * Bot v2 — Orquestador principal.
 *
 * Punto de entrada único del nuevo bot.  El webhook de ycloud.ts llama a `runBotTurn`
 * cuando la variable de entorno CONVEX_BOT_V2=1 está activa.
 *
 * Flujo de 1 turno:
 *   1. Cargar (o crear) la BotSession.
 *   2. Extraer entidades del mensaje con el LLM extractor (liviano).
 *   3. Mergear entidades nuevas sobre las existentes.
 *   4. Calcular la transición (sin LLM).
 *   5. Generar la respuesta (estática o LLM según fase).
 *   6. Actualizar la BotSession en BD.
 *   7. Devolver {replyText, action, nextPhase, updatedEntities}.
 */

import type { CoreMessage } from "ai";
import type {
  BotAction,
  BotEntities,
  BotPhase,
  BotTurnResult,
  ConversationTagFlags,
  StayQuoteResult,
  StayQuoteTotals,
} from "./types";
import {
  MAX_PETS_AUTO_HANDLING,
  inferRetailerIdFromCatalogTitle,
  mergeEntities,
} from "./entities";
import { petsExceedLimitMessage } from "./prompts";
import { stage1CatalogPickHandoffMsg } from "../businessHours";
import { extractEntities } from "./extractor";
import { recoverDatesFromUserHistory, recoverRelativeDatesFromText, recoverRelativeDatesFromUserHistory } from "./historyRecovery";
import { detectPuenteReference } from "../colombiaPublicHolidays";
import { transition } from "./transitions";
import { dedupeGenerateReplyResult } from "../ycloud/assistantOutbound";
import { generateReply } from "./replies";
import { applyPetSelectionHeuristics } from "./petHeuristic";

function isVaguePropertyLabel(name?: string): boolean {
  const n = (name ?? "").trim();
  if (!n) return true;
  const lower = n.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  return /^(esta|esa|ese|e[sa]|la primera|esta finca|esa finca|lo de arriba|quiero esta|quiero esa|la finca elegida)$/.test(
    lower,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tipos de entrada
// ─────────────────────────────────────────────────────────────────────────────

export interface BotTurnInput {
  /** Mensaje de texto del cliente en este turno. */
  messageText: string;
  /** Fase actual guardada en BD (o "welcome" si es primera vez). */
  currentPhase: BotPhase;
  /** Entidades actuales guardadas en BD. */
  currentEntities: BotEntities;
  /** Historial de la conversación para contexto del LLM. */
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>;
  /** Turnos consecutivos en la fase actual antes de este turno (default 0). */
  currentSamePhaseTurnCount?: number;
  /** Timestamp en que se entró a la fase actual (default now). */
  currentPhaseEnteredAt?: number;
  /**
   * Cotización de alojamiento (Convex) al cerrar mascotas y pasar a `contract`.
   * Lo rellena el webhook con `whatsappCatalogs.getBotStayQuoteByRetailerId`.
   * Devuelve texto + totales numéricos (para que el reply pueda calcular el gran
   * total con cargos por mascotas).
   */
  fetchStayQuote?: (entities: BotEntities) => Promise<StayQuoteResult | null>;
  /**
   * Resultado pre-fetchado de búsqueda RAG en el namespace `"faq"`. Lo rellena
   * `inbound.ts` con `knowledge.searchFaqForBot` cuando el mensaje del cliente
   * parece una pregunta (ver `looksLikeQuestion`). Si está, se inyecta en el
   * system prompt enriquecido para que el LLM responda con info verificada en
   * lugar de inventar o caer en "déjame confirmarlo".
   */
  faqContext?: string | null;
  /**
   * Ejemplos de TONO del playbook (`searchPlaybookForBot`), filtrados por fase.
   * Lazy: solo se consulta cuando el turno va a usar LLM contextual (mismo
   * patrón que `fetchStayQuote`).
   */
  fetchPlaybookContext?: () => Promise<string | null>;
  /** @deprecated Usar `fetchPlaybookContext`. Solo para tests. */
  playbookContext?: string | null;
  /**
   * Nombre del contacto desde el perfil de WhatsApp (lo pasa YCloud en el
   * webhook). Se usa SOLO para personalizar el saludo de bienvenida. Si está
   * vacío o no es usable, el copy cae a "¡Hola!" sin nombre.
   */
  contactName?: string | null;
  /**
   * `productRetailerId`s del ÚLTIMO batch de catálogo enviado en esta
   * conversación. Lo rellena `inbound.ts` con
   * `internal.ycloud.getLatestCatalogRetailerIds`. Se usa para resolver picks
   * ambiguos del cliente: cuando dice "Quiero esta" / "esa" sin más contexto
   * y el último catálogo contenía exactamente UNA finca, podemos asumir que
   * se refiere a ella y setear `selectedPropertyRetailerId` automáticamente.
   * Sin esto, `fetchStayQuote` no podía resolver el retailerId y el resumen
   * caía al fallback "No pude calcular el valor automático…".
   */
  lastCatalogRetailerIds?: string[];
  /**
   * Resuelve una finca por NOMBRE. Lo rellena `inbound.ts` con
   * `whatsappCatalogs.findPropertyByNameForBot`. Se usa cuando el cliente
   * nombra una finca puntual desde el inicio ("quiero la finca X") — si se
   * resuelve, el bot salta el catálogo y va directo al flujo de reserva de
   * esa finca.
   */
  resolvePropertyByName?: (
    name: string,
  ) => Promise<{
    productRetailerId: string;
    title: string;
    location: string;
  } | null>;
  /**
   * Flags derivados de las etiquetas activas de la conversación. El LLM las
   * usa para ajustar tono (VIP → más personalizado, complicado → más
   * cauteloso, recurrente → saluda como conocido, sin repetir). Las
   * etiquetas que implican handoff duro (`cliente-grosero`, `propietario`,
   * `reserva-activa`) ya las maneja `inbound.ts` antes de llamar al bot.
   */
  tagFlags?: ConversationTagFlags;
  /**
   * Canal de la conversación (`web` widget o `whatsapp`). En ambos el bot se
   * presenta como *asistente virtual de FincasYa* (no como persona humana).
   */
  channel?: "whatsapp" | "web";
  /**
   * Conversación en curso (experto humano o historial previo): no enviar
   * bienvenida genérica ni tratar como cliente nuevo.
   */
  resumeOngoingConversation?: boolean;
}

/** Si el cliente lleva más de N turnos consecutivos en la misma fase sin avanzar,
 *  forzamos escalada a humano para no dejarlo en bucle.
 */
const MAX_SAME_PHASE_TURNS_BEFORE_HANDOFF = 6;

/**
 * Campos que cuentan como "progreso real". Si alguno cambia entre turnos,
 * resetea el contador anti-bucle aunque la fase aún no haya cambiado.
 * Esto evita que recolectar 5 datos seguidos en `collecting` se interprete como atasco.
 */
const PROGRESS_FIELDS: Array<keyof BotEntities> = [
  "location",
  "checkIn",
  "checkOut",
  "cupo",
  "isEvento",
  "planType",
  "selectedPropertyRetailerId",
  "selectedPropertyName",
  "catalogUserPickedReply",
  "hasPets",
  "petCount",
  "eventPeopleCount",
  "eventLogistics",
  "contractName",
  "contractCedula",
  "contractEmail",
  "contractPhone",
  "contractAddress",
];

function entitiesProgressed(prev: BotEntities, next: BotEntities): boolean {
  for (const f of PROGRESS_FIELDS) {
    if (prev[f] !== next[f]) return true;
  }
  return false;
}

/**
 * Detecta intención del cliente de empezar una cotización **completamente nueva**
 * cuando ya estaba avanzado en el flujo (soft-reset COMPLETO: borra todo
 * excepto datos personales del contrato).
 *
 * NO incluye frases tipo "otra zona", "otro municipio", "otra ciudad", ni
 * "en otro lado" — esas las maneja `catalogFiltersChanged` con soft-reset
 * PARCIAL cuando el extractor recoge un municipio diferente. Esto evita el
 * bug donde el cliente dice "Si otra zona cercana por favor" (en respuesta a
 * la sugerencia del bot) y el bot interpreta que quiere empezar de cero,
 * borrando fechas/cupo/plan/evento y volviendo a preguntarlos uno por uno.
 *
 * Patrones cubiertos:
 *   "deseo hacer una nueva cotización", "otra cotización", "otra reserva",
 *   "cambiar fechas / cambiar la reserva", "otra fecha", "olvida lo anterior",
 *   "empezar de nuevo", "reiniciar", "borrar todo".
 */
function userWantsNewQuote(text: string): boolean {
  const t = String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  if (t.length === 0 || t.length > 240) return false;
  return (
    /\b(nueva\s+(cotizacion|reserva|busqueda)|otra\s+(cotizacion|reserva|busqueda))\b/.test(t) ||
    /\b(cambiar\s+(la\s+)?(reserva|cotizacion|fechas?|finca))\b/.test(t) ||
    /\b(otra(s)?\s+fechas?|otros?\s+d[ií]as?|fechas?\s+diferentes?)\b/.test(t) ||
    /\b(olvida(r)?\s+(lo\s+)?(anterior|previo)|empezar\s+de\s+nuevo|reiniciar|borrar\s+todo)\b/.test(t)
  );
}

/** Fases en las que un "nueva cotización" tiene sentido (cliente ya avanzó). */
function isPostCollectingPhase(phase: BotPhase): boolean {
  return (
    phase === "catalog_sent" ||
    phase === "property_selected" ||
    phase === "pet_check" ||
    phase === "pet_rules_shown" ||
    phase === "quote_shown"
  );
}

/**
 * Detecta intención del cliente de ver MÁS opciones del catálogo (paginación).
 * NO es soft-reset; mantiene los filtros actuales (location, dates, cupo,
 * etc.) y solicita otro batch de fincas excluyendo las ya enviadas.
 *
 * Patrones cubiertos:
 *   "ver más", "ver mas", "más opciones", "mas opciones", "muéstrame más",
 *   "muestrame mas", "quiero ver más", "tienes más", "hay más", "más fincas",
 *   "otras opciones", "otras fincas", "muestra más", "envíame más".
 */
function userWantsMoreCatalogOptions(text: string): boolean {
  const t = String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  if (t.length === 0 || t.length > 200) return false;
  return (
    /\b(ver|mostrar|muestrame|envia(me)?|env[ií]ame|quiero\s+ver|qu[ie]ero|necesito|dame)\s+(mas|m[aá]s|otras?)\s+(opciones|fincas|alternativas|opcion)\b/.test(
      t,
    ) ||
    /\b(mas|m[aá]s)\s+(opciones|fincas|alternativas)\b/.test(t) ||
    /\b(otras?)\s+(opciones|fincas|alternativas)\b/.test(t) ||
    /\b(hay|tienes|tenes|tendr[aá])s?\s+(mas|m[aá]s|otras?)\s*(fincas|opciones|alternativas)?\b/.test(
      t,
    ) ||
    /\b(quiero\s+ver\s+m[aá]s|qu[ie]ero\s+m[aá]s|ver\s+otras?)\b/.test(t)
  );
}

/**
 * ¿El ÚLTIMO mensaje del bot OFRECIÓ recomendar / mostrar más opciones o buscar
 * en otra zona? (ej. "¿Quieres que te recomiende opciones en otros
 * municipios?"). Se usa junto con una confirmación del cliente ("sí") para
 * disparar el re-envío del catálogo: sin esto, el cliente decía "sí" y el bot
 * respondía algo incoherente ("¿cuál finca de las que viste querés?") porque
 * el FSM no sabía a qué pregunta del LLM le estaba diciendo que sí.
 */
function botOfferedMoreOptions(
  history: Array<{ role: "user" | "assistant"; content: string }>,
): boolean {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === "assistant") {
      const c = String(history[i].content ?? "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{M}/gu, "");
      return /(recomend\w*\s+(te\s+)?opciones|recomiende\w*|otros?\s+municipios?|otra\s+zona|otras\s+zonas|en\s+otra\s+(zona|ciudad|parte)|ver\s+(mas|otras)|m[aá]s\s+opciones|otras\s+opciones|te\s+(muestro|recomiendo|env[ií]o)\s+(mas|otras)|buscar\s+en\s+otr)/.test(
        c,
      );
    }
  }
  return false;
}

/** ¿Alguna línea del mensaje es una afirmación corta ("sí", "dale", "ok", "para sí")? */
function isShortAffirmation(text: string): boolean {
  return String(text ?? "")
    .split(/\n+/)
    .some((line) => {
      const t = line
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{M}/gu, "");
      return /^(s+i+p?|sip|dale|clar[oa]|ok+|okey|listo|de\s+una|por\s*favor|porfa|si\s+por\s*favor|para\s+si|de\s+acuerdo|bueno|vale|hagamoslo|obvio)[\s.!,]*$/.test(
        t,
      );
    });
}

/**
 * Campos que filtran el catálogo. Si cualquiera cambia estando ya post-catálogo,
 * el catálogo viejo deja de ser válido y hay que regenerarlo.
 *
 * No incluye `planType` porque actualmente no afecta el filtro server-side del
 * catálogo (solo `location + cupo + fechas + isEvento`). Si en el futuro
 * `planType` se usa para filtrar, agrégalo aquí.
 */
const CATALOG_FILTER_FIELDS: Array<keyof BotEntities> = [
  "location",
  "checkIn",
  "checkOut",
  "cupo",
  "isEvento",
  // `eventPeopleCount` también afecta el filtro server-side cuando `isEvento=true`
  // (porque pasamos `minCapacity = max(cupo, eventPeopleCount)` en `inbound.ts`).
  "eventPeopleCount",
];

function catalogFiltersChanged(
  prev: BotEntities,
  next: BotEntities,
): boolean {
  for (const f of CATALOG_FILTER_FIELDS) {
    const a = prev[f];
    const b = next[f];
    // Solo cuenta como "cambio" si AMBOS lados están definidos y son distintos.
    // (Si antes no había valor y ahora sí, es progreso normal, no un cambio que
    // invalide un catálogo previo.)
    if (a !== undefined && b !== undefined && a !== b) return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Función principal
// ─────────────────────────────────────────────────────────────────────────────

export async function runBotTurn(input: BotTurnInput): Promise<BotTurnResult> {
  const {
    messageText,
    currentPhase,
    currentEntities,
    conversationHistory,
    fetchStayQuote,
    currentSamePhaseTurnCount,
    currentPhaseEnteredAt,
    faqContext,
    fetchPlaybookContext,
    contactName,
    lastCatalogRetailerIds,
    resumeOngoingConversation,
  } = input;

  // 1. Extraer entidades del mensaje actual
  const extracted = await extractEntities(
    messageText,
    currentEntities,
    conversationHistory,
    contactName,
  );

  // 1.3 Resolución de "puente festivo": si el cliente dijo algo como "segundo
  // puente de agosto", el extractor LLM puede equivocarse e interpretar
  // "segundo" como el DÍA 2 (ej. checkIn=2026-08-02). Aquí detectamos la
  // referencia con el calendario REAL de festivos colombianos y sobre-
  // escribimos checkIn/checkOut con las fechas correctas del puente
  // (ej. "segundo puente de agosto 2026" → Sáb 15 → Lun 17). Determinístico.
  const puenteRef = detectPuenteReference(messageText, Date.now());
  if (puenteRef) {
    extracted.checkIn = puenteRef.checkIn;
    extracted.checkOut = puenteRef.checkOut;
  }

  // 1.4 Petición de experto humano detectada por el LLM. El extractor clasifica
  // `requestsHumanAgent` analizando la intención real — más confiable que la
  // regex de `inbound.ts` (que es solo fast-path para casos obvios). Si el
  // LLM lo marca, escalamos a humano de inmediato. Esto cubre casos con
  // matices que la regex no captura, y EVITA falsos positivos (ej. "somos 13
  // personas" — la regex vieja escalaba por la palabra "persona").
  if (extracted.requestsHumanAgent === true) {
    return {
      replyText:
        "Perfecto, te comunico con un experto 🤝 Te escribirá en breve para ayudarte ✨",
      action: { type: "escalate_human", reason: "client_requested" },
      nextPhase: currentPhase,
      updatedEntities: currentEntities,
      samePhaseTurnCount: currentSamePhaseTurnCount ?? 0,
      phaseEnteredAt: currentPhaseEnteredAt ?? Date.now(),
    };
  }

  // 1.5 Detectar intención de "nueva cotización" cuando el cliente ya está
  // post-catálogo. Si aplica, hacemos un soft reset: borramos finca elegida +
  // mascotas + flags de bloqueo, y forzamos `effectivePhase = "collecting"` para
  // que la transición vuelva a recolectar datos en lugar de avanzar con la
  // sesión anterior (que es lo que hacía aparecer respuestas tipo
  // "ya tengo la info de la cotización que envié antes" mezclando reservas).
  const wantsNewQuote =
    userWantsNewQuote(messageText) && isPostCollectingPhase(currentPhase);

  // 2. Mergear entidades (las nuevas tienen prioridad sobre las viejas)
  let baseEntities: BotEntities = currentEntities;
  if (wantsNewQuote) {
    // Soft reset: conserva solo datos personales del contrato (si se habían capturado).
    // Todo lo relativo a la búsqueda/cotización vieja se borra.
    baseEntities = {
      contractName: currentEntities.contractName,
      contractCedula: currentEntities.contractCedula,
      contractEmail: currentEntities.contractEmail,
      contractPhone: currentEntities.contractPhone,
      contractAddress: currentEntities.contractAddress,
      clientGender: currentEntities.clientGender,
    };
  }

  // BELT-AND-SUSPENDERS contra cambio espurio de zona por "pointing":
  // si ya hay catálogo enviado y el mensaje del cliente apunta a una finca
  // específica del catálogo ("la de Girardot 2", "la primera", "esa de
  // Melgar"), NO debemos tratar la ciudad mencionada como filtro nuevo —
  // disparaba `autoRebroadcastCatalog` y re-enviaba el catálogo filtrado en
  // vez de responder con info de la finca apuntada. El prompt del extractor
  // ya pide ignorar location en estos casos, pero por si el LLM falla
  // limpiamos `extracted.location` aquí antes del merge.
  const POINTING_REGEX =
    /\b(la|el|esa|ese|esta|este)\s+(?:de|del|en|que)\s+\w+|\b(la|el)\s+(primera|segunda|tercera|cuarta|quinta|sexta|septima|octava|novena|decima|primer|segundo|tercer|cuart[oa]|ultim[oa]|antepenultim[oa])\b|\b(la|el|esa|ese|esta|este)\s+\d{1,2}\b/i;
  const isPointingPick =
    isPostCollectingPhase(currentPhase) &&
    POINTING_REGEX.test(messageText) &&
    extracted.location !== undefined &&
    !extracted.wantsRecomendadas;
  const safeExtractedLocation = isPointingPick ? undefined : extracted.location;

  let updatedEntities = mergeEntities(baseEntities, {
    location: safeExtractedLocation ?? (extracted.wantsRecomendadas ? "RECOMENDADAS" : undefined),
    checkIn: extracted.checkIn,
    checkOut: extracted.checkOut,
    cupo: extracted.cupo,
    isEvento: extracted.isEvento,
    planType: extracted.planType,
    excludedRegions: extracted.excludedRegions,
    selectedPropertyName: extracted.selectedPropertyName,
    hasPets: extracted.hasPets,
    petCount: extracted.petCount,
    eventPeopleCount: extracted.eventPeopleCount,
    eventLogistics: extracted.eventLogistics,
    clientGender: extracted.clientGender,
    ...(extracted.contractFields ?? {}),
  });

  // Solo recuperar `selectedPropertyName` desde la sesión anterior si NO estamos
  // haciendo soft-reset por "nueva cotización" (en ese caso queremos olvidar la finca
  // anterior aunque el cliente diga "esta" sin claridad).
  if (
    !wantsNewQuote &&
    isVaguePropertyLabel(updatedEntities.selectedPropertyName) &&
    currentEntities.selectedPropertyName &&
    !isVaguePropertyLabel(currentEntities.selectedPropertyName)
  ) {
    updatedEntities = {
      ...updatedEntities,
      selectedPropertyName: currentEntities.selectedPropertyName,
    };
  }

  const recovered = recoverDatesFromUserHistory(conversationHistory, Date.now());
  updatedEntities = mergeEntities(updatedEntities, {
    ...(!updatedEntities.checkIn && recovered.checkIn ? { checkIn: recovered.checkIn } : {}),
    ...(!updatedEntities.checkOut && recovered.checkOut ? { checkOut: recovered.checkOut } : {}),
  });

  // Fechas coloquiales ("este fin de semana", "sábado al lunes") tienen prioridad
  // sobre el extractor cuando el cliente las repite o aclara.
  const nowMs = Date.now();
  const relativeFromMsg = recoverRelativeDatesFromText(messageText, nowMs);
  const relativeFromHistory = recoverRelativeDatesFromUserHistory(
    conversationHistory,
    nowMs,
  );
  const relative =
    relativeFromMsg.checkIn && relativeFromMsg.checkOut
      ? relativeFromMsg
      : relativeFromHistory;
  if (relative.checkIn && relative.checkOut) {
    updatedEntities = mergeEntities(updatedEntities, {
      checkIn: relative.checkIn,
      checkOut: relative.checkOut,
    });
  }

  // Si las fechas cambiaron en este turno, el aviso de puente vuelve a ser válido
  // (porque el bloqueo aplicaba a las fechas anteriores).
  const datesChangedThisTurn =
    updatedEntities.checkIn !== currentEntities.checkIn ||
    updatedEntities.checkOut !== currentEntities.checkOut;
  if (datesChangedThisTurn && currentEntities.puenteAcknowledged) {
    updatedEntities = { ...updatedEntities, puenteAcknowledged: undefined };
  }

  // 2.5 Auto-rebroadcast del catálogo si el cliente cambió un filtro estando ya
  // post-catálogo (ej. estaba en `catalog_sent` con cupo=22 y dice "miento es
  // para 13 personas"). El catálogo viejo ya no aplica.
  //
  // Soft-reset PARCIAL: borramos solo la selección de finca + mascotas + flag
  // de puente. Mantenemos los filtros con los valores nuevos del extractor.
  // Forzamos `effectivePhase = "collecting"` para que `transition` re-dispare
  // el `send_catalog` con los filtros actualizados.
  //
  // Distinto de `wantsNewQuote` (que sí borra todos los filtros porque el
  // cliente pide empezar de cero). Aquí solo descartamos la finca elegida y
  // las mascotas porque ya no encajan con el nuevo cupo/fechas/etc.
  //
  // EXCEPCIÓN — si el cliente envió datos de contrato en este turno (nombre,
  // cédula, email, teléfono o dirección), NO disparamos el rebroadcast aunque
  // el extractor haya "detectado" una location en el mismo mensaje (p.ej. la
  // ciudad que aparece en la dirección del cliente). El flujo de contrato tiene
  // prioridad absoluta sobre el re-envío del catálogo.
  const contractFieldsInThisTurn = !!(
    extracted.contractFields &&
    Object.values(extracted.contractFields).some(
      (v) => typeof v === "string" && v.trim().length > 0,
    )
  );
  const autoRebroadcastCatalog =
    !wantsNewQuote &&
    !contractFieldsInThisTurn &&
    isPostCollectingPhase(currentPhase) &&
    catalogFiltersChanged(currentEntities, updatedEntities);
  if (autoRebroadcastCatalog) {
    updatedEntities = {
      ...updatedEntities,
      selectedPropertyName: undefined,
      selectedPropertyRetailerId: undefined,
      catalogUserPickedReply: undefined,
      hasPets: undefined,
      petCount: undefined,
      puenteAcknowledged: undefined,
    };
  }

  // Fase efectiva para esta transición. Si hay soft reset, partimos de "collecting"
  // (no de la fase anterior) para que la lógica de `transition` no intente
  // avanzar usando la sesión vieja.
  const effectivePhase: BotPhase =
    wantsNewQuote || autoRebroadcastCatalog
      ? "collecting"
      : resumeOngoingConversation && currentPhase === "welcome"
        ? "collecting"
        : currentPhase;

  updatedEntities = applyPetSelectionHeuristics(
    messageText,
    effectivePhase,
    updatedEntities,
  );

  const ridGuess = inferRetailerIdFromCatalogTitle(updatedEntities.selectedPropertyName);
  if (ridGuess && !(updatedEntities.selectedPropertyRetailerId ?? "").trim()) {
    updatedEntities = mergeEntities(updatedEntities, { selectedPropertyRetailerId: ridGuess });
  }

  // 2.6 Finca nombrada por el cliente (ej. "quiero reservar la finca Acacias
  // Biocontainer", "quiero ver la VILLAVICENCIO CASA HORIZON LUXURY"). Si
  // nombró una finca concreta y todavía no tenemos su
  // `selectedPropertyRetailerId`, la resolvemos por nombre contra el catálogo
  // del bot (`findPropertyByNameForBot`, que SOLO devuelve fincas activas,
  // visibles y con `visibleInWhatsAppCatalog ≠ false`). Si se encuentra →
  // seteamos retailerId + location → la transición salta el catálogo y va
  // directo al flujo de reserva. Si NO se encuentra → `namedPropertyNotFound`
  // → escalamos (no avanzamos con un nombre fantasma).
  //
  // CRÍTICO (fix 2026-05-21): corre en CUALQUIER fase salvo contract/done —
  // antes solo welcome/collecting, así que si la sesión venía de otra fase
  // (ej. heredada de ayer) el bot aceptaba el `selectedPropertyName` CRUDO sin
  // validar → un cliente podía "reservar" una finca con el Catálogo Meta
  // (WhatsApp) DESACTIVADO (`visibleInWhatsAppCatalog=false`) solo nombrándola.
  // Ahora esa finca no resuelve → escala a un experto. El guard
  // `!selectedPropertyRetailerId` evita re-resolver cuando ya hay finca elegida.
  let namedPropertyNotFound = false;
  if (
    !wantsNewQuote &&
    !autoRebroadcastCatalog &&
    effectivePhase !== "contract" &&
    effectivePhase !== "done" &&
    !(updatedEntities.selectedPropertyRetailerId ?? "").trim() &&
    !!updatedEntities.selectedPropertyName?.trim() &&
    !isVaguePropertyLabel(updatedEntities.selectedPropertyName) &&
    typeof input.resolvePropertyByName === "function"
  ) {
    const resolved = await input.resolvePropertyByName(
      updatedEntities.selectedPropertyName,
    );
    if (resolved) {
      updatedEntities = mergeEntities(updatedEntities, {
        selectedPropertyRetailerId: resolved.productRetailerId,
        selectedPropertyName: resolved.title,
        location: updatedEntities.location || resolved.location,
      });
    } else {
      namedPropertyNotFound = true;
    }
  }

  // 2.65 El cliente nombró una finca puntual pero NO la pudimos ubicar (nombre
  // muy distinto / no está en catálogo). En vez de pedir municipio sin sentido
  // (el cliente ya dijo qué finca quiere), escalamos a un experto que la ubica.
  if (namedPropertyNotFound) {
    const fincaName = (updatedEntities.selectedPropertyName ?? "").trim();
    return {
      replyText: [
        `Veo que te interesa la finca *${fincaName}* 🏡`,
        "",
        "Déjame conectarte con un experto que la ubica y te confirma disponibilidad para tus fechas 🤝 ✨",
      ].join("\n"),
      action: { type: "escalate_human", reason: "client_requested" },
      nextPhase: effectivePhase,
      updatedEntities,
      samePhaseTurnCount: currentSamePhaseTurnCount ?? 0,
      phaseEnteredAt: currentPhaseEnteredAt ?? Date.now(),
    };
  }

  // Resolución de pick ambiguo: el cliente dijo "Quiero esta" sin más contexto
  // (selectedPropertyName quedó como "esta" / "esa" o vacío, y NO trae código
  // tipo "VLL#002" para que `inferRetailerIdFromCatalogTitle` lo resuelva).
  // Si el último catálogo contenía EXACTAMENTE UNA finca, asumimos que se
  // refiere a ella y seteamos el retailerId. Sin esto, `fetchStayQuote` no
  // resuelve y el resumen cae al fallback "No pude calcular el valor
  // automático…".
  //
  // No aplicamos esta heurística cuando el batch tiene 2+ retailerIds, porque
  // "esta" ahí es genuinamente ambiguo y necesitamos que el cliente especifique.
  const pickedVaguelyOrEmpty =
    !(updatedEntities.selectedPropertyRetailerId ?? "").trim() &&
    (!updatedEntities.selectedPropertyName?.trim() ||
      isVaguePropertyLabel(updatedEntities.selectedPropertyName));
  if (
    pickedVaguelyOrEmpty &&
    lastCatalogRetailerIds &&
    lastCatalogRetailerIds.length === 1
  ) {
    const onlyRetailerId = lastCatalogRetailerIds[0].trim();
    if (onlyRetailerId) {
      updatedEntities = mergeEntities(updatedEntities, {
        selectedPropertyRetailerId: onlyRetailerId,
      });
    }
  }

  // 3. Calcular transición (determinista)
  let tr = transition(
    effectivePhase,
    updatedEntities,
    messageText,
    extracted.confirmsCurrentStep,
  );

  // 3.05 Paginación del catálogo: si el cliente está en una fase post-catálogo
  // y pide "ver más opciones", forzamos un nuevo `send_catalog` (con flag
  // `paginate: true` para que `inbound.ts` aplique `excludeRetailerIds`).
  // No es soft-reset: mantenemos los filtros (location, dates, cupo, plan,
  // evento) y simplemente le pedimos al query la SIGUIENTE página de fincas.
  //
  // TAMBIÉN dispara cuando el cliente solo dice "sí" Y el bot le acababa de
  // ofrecer recomendar/mostrar más opciones ("¿quieres que te recomiende
  // opciones en otros municipios?"). Sin esto, el "sí" caía al LLM y el bot
  // respondía algo incoherente ("¿cuál finca de las que viste querés?").
  //
  // Solo aplica cuando ya tenemos toda la data del catálogo (location +
  // checkIn + checkOut + cupo). Si falta algo, dejamos el flujo normal.
  const clientConfirmedMoreOptions =
    botOfferedMoreOptions(conversationHistory) &&
    (extracted.confirmsCurrentStep === "yes" ||
      isShortAffirmation(messageText));
  if (
    (userWantsMoreCatalogOptions(messageText) || clientConfirmedMoreOptions) &&
    isPostCollectingPhase(currentPhase) &&
    updatedEntities.location &&
    updatedEntities.checkIn &&
    updatedEntities.checkOut &&
    (updatedEntities.cupo ?? 0) > 0
  ) {
    tr = {
      nextPhase: "catalog_sent",
      action: {
        type: "send_catalog",
        location: updatedEntities.location,
        checkIn: updatedEntities.checkIn,
        checkOut: updatedEntities.checkOut,
        cupo: updatedEntities.cupo!,
        isEvento: updatedEntities.isEvento === true,
        paginate: true,
      },
    };
  }

  // 3.5 Calcular contador de turnos consecutivos SIN PROGRESO en la misma fase.
  // Se resetea a 0 cuando: (a) cambia la fase, (b) el cliente aportó datos
  // nuevos en este turno, o (c) hubo soft reset por "nueva cotización".
  // Solo incrementa cuando el cliente está realmente atascado.
  //
  // EXCEPCIÓN — bloqueos duros de fechas: mientras las fechas estén en un
  // estado que IMPIDE enviar el catálogo, NADA cuenta como progreso aunque el
  // cliente aporte cupo/grupo/etc. Cubre 3 casos:
  //   • `datesIncoherent`  — fechas incoherentes (ej. "del 15 al 15").
  //   • `datesInPast`      — la fecha de entrada ya pasó (días anteriores a hoy).
  //   • `catalogPuenteOneNight` — 1 noche sobre un puente festivo (mín. 2).
  //   • `catalogSpecialSeason`  — temporada especial sin cumplir el mínimo.
  // Sin esta excepción el cliente "progresaba" en otros campos, el contador se
  // reseteaba cada turno y el anti-bucle nunca escalaba → el bot quedaba
  // pidiendo lo mismo para siempre (o peor, el LLM alucinaba un happy-path).
  // Con la excepción, el contador sube y tras 6 turnos atascado escala a un
  // experto humano que resuelve las fechas con el cliente.
  const phaseChanged = tr.nextPhase !== effectivePhase;
  const dateHardBlock =
    tr.datesIncoherent === true ||
    tr.datesInPast === true ||
    tr.catalogPuenteOneNight === true ||
    tr.catalogSpecialSeason != null;
  const madeProgress =
    !dateHardBlock &&
    (wantsNewQuote ||
      autoRebroadcastCatalog ||
      entitiesProgressed(currentEntities, updatedEntities));
  const now = Date.now();
  const samePhaseTurnCount =
    phaseChanged || madeProgress ? 0 : (currentSamePhaseTurnCount ?? 0) + 1;
  const phaseEnteredAt = phaseChanged ? now : (currentPhaseEnteredAt ?? now);

  // 3.54 Etapa 1 (piloto): al elegir finca, handoff a humano con copy fijo.
  if (
    tr.action.type === "escalate_human" &&
    tr.action.reason === "stage1_catalog_pick"
  ) {
    return {
      replyText: stage1CatalogPickHandoffMsg(Date.now()),
      action: tr.action,
      nextPhase: effectivePhase,
      updatedEntities,
      samePhaseTurnCount,
      phaseEnteredAt,
    };
  }

  // 3.55 Política de mascotas: el bot maneja hasta MAX_PETS_AUTO_HANDLING (3)
  // automáticamente. Si el cliente declara más, escalamos a un experto humano
  // para que evalúe condiciones especiales (aseo extra, finca con espacio,
  // depósito ajustado). NO calculamos costo ni avanzamos al contrato — el
  // resumen automático con 30 mascotas no aplica.
  if (
    updatedEntities.hasPets === true &&
    (updatedEntities.petCount ?? 0) > MAX_PETS_AUTO_HANDLING &&
    tr.action.type !== "escalate_human"
  ) {
    return {
      replyText: petsExceedLimitMessage(updatedEntities.petCount ?? 0),
      action: { type: "escalate_human", reason: "pets_exceed_limit" },
      nextPhase: effectivePhase,
      updatedEntities,
      samePhaseTurnCount,
      phaseEnteredAt,
    };
  }

  // 3.57 Política comercial de eventos: escalada SOLO para eventos con
  // logística pesada ("extra": DJ, banda en vivo, sonido pro, iluminación,
  // mariachis, grupos musicales, matrimonios, etc.). En esos casos el bot NO
  // calcula el sobreprecio del evento (depende de horario, capacidad de la
  // fiesta, equipos extras, condiciones especiales) — el experto es quien
  // confirma precio.
  //
  // En cambio, los eventos con logística "básica" (cumpleaños familiares,
  // departir tranquilos con el sonido de la finca, reuniones íntimas) SIGUEN
  // EL FLUJO NORMAL: pet_check → quote_shown → contract. La cotización
  // estándar aplica sin sobreprecio.
  //
  // Esto cubre el caso post-catálogo: el cliente vio las opciones, eligió una,
  // y dio los datos del evento que el bot le pidió DESPUÉS del catálogo (ver
  // `inbound.ts` → bloque `action.isEvento === true`).
  //
  // Importante: este guard solo dispara cuando el cliente está post-catálogo
  // (es decir, ya pasó por `catalog_sent`). Si el cliente está en `welcome` /
  // `collecting` con `isEvento=true` pero todavía sin finca elegida, el
  // catálogo debe enviarse primero (lo hace la transición normal).
  const isPostCatalogEventReadyExtra =
    updatedEntities.isEvento === true &&
    (updatedEntities.eventPeopleCount ?? 0) > 0 &&
    updatedEntities.eventLogistics === "extra" &&
    !!(
      (updatedEntities.selectedPropertyName ?? "").trim() ||
      (updatedEntities.selectedPropertyRetailerId ?? "").trim()
    ) &&
    effectivePhase !== "welcome" &&
    effectivePhase !== "collecting" &&
    tr.action.type !== "escalate_human" &&
    tr.action.type !== "send_catalog";
  if (isPostCatalogEventReadyExtra) {
    return {
      replyText: [
        "¡Perfecto! Con los datos del evento que me diste te conecto con un experto para confirmarte el *precio final* y la *disponibilidad* del evento 🎉",
        "",
        "Un experto te escribirá en breve para finalizar los detalles 🤝 ✨",
      ].join("\n"),
      action: { type: "escalate_human", reason: "event_after_catalog" },
      nextPhase: effectivePhase,
      updatedEntities,
      samePhaseTurnCount,
      phaseEnteredAt,
    };
  }

  // 3.6 Anti-bucle: si el cliente lleva demasiados turnos atascado SIN APORTAR DATOS,
  // escalar a humano. `samePhaseTurnCount` ya es inteligente (resetea si hubo progreso).
  if (
    samePhaseTurnCount >= MAX_SAME_PHASE_TURNS_BEFORE_HANDOFF &&
    tr.action.type !== "escalate_human" &&
    effectivePhase !== "done" &&
    !madeProgress
  ) {
    return {
      replyText:
        "Veo que llevamos varios mensajes sin avanzar 🙏 Te conecto con un experto humano para que te termine de ayudar más rápido. En un momento te escribe ✨",
      action: { type: "escalate_human", reason: "stuck_loop" },
      nextPhase: effectivePhase,
      updatedEntities,
      samePhaseTurnCount,
      phaseEnteredAt,
    };
  }

  let stayQuoteBlock: string | null = null;
  let stayQuoteTotals: StayQuoteTotals | null = null;
  // Cargar la cotización (alojamiento) cuando el bot vaya a mostrar el
  // resumen al cliente. Esto ocurre en dos casos:
  //
  // (a) **Flujo nuevo (paso a paso):** la transición va a `quote_shown` desde
  //     `pet_check` (sin mascotas) o desde `pet_rules_shown` (con mascotas).
  //     `replies.ts` arma el resumen con `buildSummaryWithTotals` usando los
  //     totals que cargamos acá. SIN esta carga, el resumen cae al fallback
  //     "No pude calcular el valor automático... un experto te confirma" — que
  //     es exactamente el bug reportado por la usuaria con MELGAR QUINTA
  //     TRAMONTINI: el bot pasó de pet_rules_shown a quote_shown pero NO
  //     había cotización cargada porque el trigger viejo solo miraba
  //     nextPhase==="contract".
  //
  // (b) **Flujo legacy (paquete contract):** la transición va directo de
  //     `pet_check` o `property_selected` a `contract`. `generateReply`
  //     arma `buildContractHandoffPacket` con las 3 burbujas (reglas
  //     mascotas / resumen / pedido contrato) y necesita los totals para
  //     calcular el gran total con cargos por mascotas.
  const loadStayQuote =
    tr.nextPhase === "quote_shown" ||
    (tr.nextPhase === "contract" &&
      (effectivePhase === "pet_check" || effectivePhase === "property_selected"));
  if (loadStayQuote && fetchStayQuote) {
    const quote = await fetchStayQuote(updatedEntities);
    if (quote) {
      stayQuoteBlock = quote.text;
      stayQuoteTotals = quote.totals ?? null;
    }
  }

  // 4. Generar respuesta (puede ser 1 mensaje o un paquete de varios).
  const generated = dedupeGenerateReplyResult(
    await generateReply({
      currentPhase: effectivePhase,
      transition: tr,
      entities: updatedEntities,
      incomingText: messageText,
      conversationHistory: conversationHistory as CoreMessage[],
      stayQuoteBlock,
      stayQuoteTotals,
      samePhaseTurnCount,
      faqContext,
      fetchPlaybookContext,
      contactName,
      tagFlags: input.tagFlags,
      channel: input.channel,
      resumeOngoingConversation,
    }),
  );

  // 4.5 Si en este turno se emitió el aviso de puente festivo O el aviso de
  // temporada especial (Navidad / Fin de año / Reyes), marcarlo como "ya
  // advertido". Reutilizamos el mismo flag `puenteAcknowledged` porque la
  // semántica es la misma: "el cliente ya vio el aviso para estas fechas, no
  // repetirlo textual". El flag se resetea automáticamente si las fechas
  // cambian (ver bloque 2.5 más arriba).
  let finalEntities = updatedEntities;
  const emittedSeasonalNotice =
    tr.catalogPuenteOneNight === true || tr.catalogSpecialSeason != null;
  if (emittedSeasonalNotice && !finalEntities.puenteAcknowledged) {
    finalEntities = { ...finalEntities, puenteAcknowledged: true };
  }

  return {
    replyText: generated.reply,
    additionalMessages:
      generated.extras && generated.extras.length > 0 ? generated.extras : undefined,
    action: tr.action,
    nextPhase: tr.nextPhase,
    updatedEntities: finalEntities,
    samePhaseTurnCount,
    phaseEnteredAt,
    playbookUsed: generated.playbookUsed === true,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Re-exports para uso desde ycloud.ts
// ─────────────────────────────────────────────────────────────────────────────

export type { BotTurnResult, BotEntities, BotPhase, BotAction };
