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
  StayQuoteResult,
  StayQuoteTotals,
} from "./types";
import {
  MAX_PETS_AUTO_HANDLING,
  inferRetailerIdFromCatalogTitle,
  mergeEntities,
} from "./entities";
import { petsExceedLimitMessage } from "./prompts";
import { extractEntities } from "./extractor";
import { recoverDatesFromUserHistory } from "./historyRecovery";
import { transition } from "./transitions";
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
 * Detecta intención del cliente de empezar una cotización nueva o cambiar fechas/lugar
 * cuando ya estaba avanzado en el flujo. Patrones cubiertos:
 *   "deseo hacer una nueva cotización", "otra cotización", "otra reserva",
 *   "cambiar fechas / cambiar la reserva", "otra fecha", "otro municipio",
 *   "otro lugar", "otra zona", "olvida lo anterior", "empezar de nuevo".
 */
function userWantsNewQuote(text: string): boolean {
  const t = String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  if (t.length === 0 || t.length > 240) return false;
  return (
    /\b(nueva\s+(cotizacion|reserva|busqueda)|otra\s+(cotizacion|reserva|busqueda))\b/.test(t) ||
    /\b(cambiar\s+(la\s+)?(reserva|cotizacion|fechas?|finca|lugar|municipio|zona))\b/.test(t) ||
    /\b(otra(s)?\s+fechas?|otros?\s+d[ií]as?|fechas?\s+diferentes?)\b/.test(t) ||
    /\b(otro\s+(municipio|lugar|sitio)|otra\s+(zona|ciudad)|en\s+otro\s+lado)\b/.test(t) ||
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
  } = input;

  // 1. Extraer entidades del mensaje actual
  const extracted = await extractEntities(
    messageText,
    currentEntities,
    conversationHistory,
  );

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
    };
  }

  let updatedEntities = mergeEntities(baseEntities, {
    location: extracted.location ?? (extracted.wantsRecomendadas ? "RECOMENDADAS" : undefined),
    checkIn: extracted.checkIn,
    checkOut: extracted.checkOut,
    cupo: extracted.cupo,
    isEvento: extracted.isEvento,
    planType: extracted.planType,
    selectedPropertyName: extracted.selectedPropertyName,
    hasPets: extracted.hasPets,
    petCount: extracted.petCount,
    eventPeopleCount: extracted.eventPeopleCount,
    eventLogistics: extracted.eventLogistics,
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
  const autoRebroadcastCatalog =
    !wantsNewQuote &&
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
    wantsNewQuote || autoRebroadcastCatalog ? "collecting" : currentPhase;

  updatedEntities = applyPetSelectionHeuristics(
    messageText,
    effectivePhase,
    updatedEntities,
  );

  const ridGuess = inferRetailerIdFromCatalogTitle(updatedEntities.selectedPropertyName);
  if (ridGuess && !(updatedEntities.selectedPropertyRetailerId ?? "").trim()) {
    updatedEntities = mergeEntities(updatedEntities, { selectedPropertyRetailerId: ridGuess });
  }

  // 3. Calcular transición (determinista)
  const tr = transition(effectivePhase, updatedEntities, messageText);

  // 3.5 Calcular contador de turnos consecutivos SIN PROGRESO en la misma fase.
  // Se resetea a 0 cuando: (a) cambia la fase, (b) el cliente aportó datos
  // nuevos en este turno, o (c) hubo soft reset por "nueva cotización".
  // Solo incrementa cuando el cliente está realmente atascado.
  const phaseChanged = tr.nextPhase !== effectivePhase;
  const madeProgress =
    wantsNewQuote ||
    autoRebroadcastCatalog ||
    entitiesProgressed(currentEntities, updatedEntities);
  const now = Date.now();
  const samePhaseTurnCount =
    phaseChanged || madeProgress ? 0 : (currentSamePhaseTurnCount ?? 0) + 1;
  const phaseEnteredAt = phaseChanged ? now : (currentPhaseEnteredAt ?? now);

  // 3.55 Política de mascotas: el bot maneja hasta MAX_PETS_AUTO_HANDLING (3)
  // automáticamente. Si el cliente declara más, escalamos a un asesor humano
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
        "Veo que llevamos varios mensajes sin avanzar 🙏 Te conecto con un asesor humano para que te termine de ayudar más rápido. En un momento te escribe ✨",
      action: { type: "escalate_human", reason: "stuck_loop" },
      nextPhase: effectivePhase,
      updatedEntities,
      samePhaseTurnCount,
      phaseEnteredAt,
    };
  }

  let stayQuoteBlock: string | null = null;
  let stayQuoteTotals: StayQuoteTotals | null = null;
  const loadStayQuoteForContractHandoff =
    tr.nextPhase === "contract" &&
    (effectivePhase === "pet_check" || effectivePhase === "property_selected");
  if (loadStayQuoteForContractHandoff && fetchStayQuote) {
    const quote = await fetchStayQuote(updatedEntities);
    if (quote) {
      stayQuoteBlock = quote.text;
      stayQuoteTotals = quote.totals ?? null;
    }
  }

  // 4. Generar respuesta (puede ser 1 mensaje o un paquete de varios).
  const generated = await generateReply({
    currentPhase: effectivePhase,
    transition: tr,
    entities: updatedEntities,
    incomingText: messageText,
    conversationHistory: conversationHistory as CoreMessage[],
    stayQuoteBlock,
    stayQuoteTotals,
    samePhaseTurnCount,
    faqContext,
  });

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
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Re-exports para uso desde ycloud.ts
// ─────────────────────────────────────────────────────────────────────────────

export type { BotTurnResult, BotEntities, BotPhase, BotAction };
