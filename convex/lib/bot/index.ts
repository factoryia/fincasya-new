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
import type { BotEntities, BotPhase, BotTurnResult, BotAction } from "./types";
import { inferRetailerIdFromCatalogTitle, mergeEntities } from "./entities";
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
  /**
   * Cotización de alojamiento (Convex) al cerrar mascotas y pasar a `contract`.
   * Lo rellena el webhook con `whatsappCatalogs.getBotStayQuoteByRetailerId`.
   */
  fetchStayQuote?: (entities: BotEntities) => Promise<string | null>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Función principal
// ─────────────────────────────────────────────────────────────────────────────

export async function runBotTurn(input: BotTurnInput): Promise<BotTurnResult> {
  const { messageText, currentPhase, currentEntities, conversationHistory, fetchStayQuote } =
    input;

  // 1. Extraer entidades del mensaje actual
  const extracted = await extractEntities(
    messageText,
    currentEntities,
    conversationHistory,
  );

  // 2. Mergear entidades (las nuevas tienen prioridad sobre las viejas)
  let updatedEntities = mergeEntities(currentEntities, {
    location: extracted.location ?? (extracted.wantsRecomendadas ? "RECOMENDADAS" : undefined),
    checkIn: extracted.checkIn,
    checkOut: extracted.checkOut,
    cupo: extracted.cupo,
    isEvento: extracted.isEvento,
    planType: extracted.planType,
    selectedPropertyName: extracted.selectedPropertyName,
    hasPets: extracted.hasPets,
    petCount: extracted.petCount,
    ...(extracted.contractFields ?? {}),
  });

  if (
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

  updatedEntities = applyPetSelectionHeuristics(
    messageText,
    currentPhase,
    updatedEntities,
  );

  const ridGuess = inferRetailerIdFromCatalogTitle(updatedEntities.selectedPropertyName);
  if (ridGuess && !(updatedEntities.selectedPropertyRetailerId ?? "").trim()) {
    updatedEntities = mergeEntities(updatedEntities, { selectedPropertyRetailerId: ridGuess });
  }

  // 3. Calcular transición (determinista)
  const tr = transition(currentPhase, updatedEntities, messageText);

  let stayQuoteBlock: string | null = null;
  const loadStayQuoteForContractHandoff =
    tr.nextPhase === "contract" &&
    (currentPhase === "pet_check" || currentPhase === "property_selected");
  if (loadStayQuoteForContractHandoff && fetchStayQuote) {
    stayQuoteBlock = await fetchStayQuote(updatedEntities);
  }

  // 4. Generar respuesta
  const replyText = await generateReply({
    currentPhase,
    transition: tr,
    entities: updatedEntities,
    incomingText: messageText,
    conversationHistory: conversationHistory as CoreMessage[],
    stayQuoteBlock,
  });

  return {
    replyText,
    action: tr.action,
    nextPhase: tr.nextPhase,
    updatedEntities,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Re-exports para uso desde ycloud.ts
// ─────────────────────────────────────────────────────────────────────────────

export type { BotTurnResult, BotEntities, BotPhase, BotAction };
