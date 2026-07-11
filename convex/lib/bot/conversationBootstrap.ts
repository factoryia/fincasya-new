/**
 * Reanuda el estado del bot en conversaciones que ya tenían historial
 * (asesor humano, mensajes previos del cliente, o reintento del bot).
 */

import type { BotEntities, BotPhase } from "./types";
import { mergeEntities } from "./entities";
import { extractEntities } from "./extractor";
import { recoverDatesFromUserHistory } from "./historyRecovery";

export function conversationHasPriorEngagement(
  history: Array<{ role: "user" | "assistant"; content: string }>,
): boolean {
  // Hay "engagement previo" SOLO si alguien (bot o asesor) ya respondió.
  // Contar mensajes del cliente NO sirve: el primer contacto suele llegar en
  // ráfaga ("Hola" / "quiero" / "alquilar una finca" / "para villavicencio")
  // y con `userCount >= 2` se clasificaba como conversación en curso →
  // se saltaba la bienvenida oficial y el bot abría en frío (bug real).
  // Los casos legítimos de reanudación (retry, volver de humano, conversación
  // preexistente) llegan por `forceResume`, no por esta heurística.
  const assistantCount = history.filter((m) => m.role === "assistant").length;
  return assistantCount >= 1;
}

export function catalogEntitiesPresent(entities: BotEntities): boolean {
  return Boolean(
    entities.checkIn ||
      entities.checkOut ||
      (entities.cupo != null && entities.cupo > 0) ||
      entities.location ||
      entities.planType ||
      entities.hasPets !== undefined,
  );
}

export async function bootstrapBotStateFromHistory(params: {
  currentPhase: BotPhase;
  currentEntities: BotEntities;
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>;
  recentUserText: string;
  forceResume?: boolean;
}): Promise<{
  phase: BotPhase;
  entities: BotEntities;
  resumeOngoingConversation: boolean;
}> {
  const {
    currentPhase,
    currentEntities,
    conversationHistory,
    recentUserText,
    forceResume = false,
  } = params;

  const priorEngagement =
    forceResume || conversationHasPriorEngagement(conversationHistory);
  if (!priorEngagement) {
    return {
      phase: currentPhase,
      entities: currentEntities,
      resumeOngoingConversation: false,
    };
  }

  if (
    currentPhase !== "welcome" &&
    currentPhase !== "collecting"
  ) {
    return {
      phase: currentPhase,
      entities: currentEntities,
      resumeOngoingConversation: true,
    };
  }

  let entities = currentEntities;
  if (!catalogEntitiesPresent(entities)) {
    const seedText =
      recentUserText.trim() ||
      conversationHistory
        .filter((m) => m.role === "user")
        .map((m) => m.content)
        .join("\n");
    const extracted = await extractEntities(
      seedText.trim() || "continuar",
      entities,
      conversationHistory,
    );
    entities = mergeEntities(entities, {
      location: extracted.wantsRecomendadas
        ? "RECOMENDADAS"
        : extracted.location,
      checkIn: extracted.checkIn,
      checkOut: extracted.checkOut,
      cupo: extracted.cupo,
      isEvento: extracted.isEvento,
      planType: extracted.planType,
      hasPets: extracted.hasPets,
      petCount: extracted.petCount,
      excludedRegions: extracted.excludedRegions,
    });
    const recovered = recoverDatesFromUserHistory(
      conversationHistory,
      Date.now(),
    );
    entities = mergeEntities(entities, {
      ...(!entities.checkIn && recovered.checkIn
        ? { checkIn: recovered.checkIn }
        : {}),
      ...(!entities.checkOut && recovered.checkOut
        ? { checkOut: recovered.checkOut }
        : {}),
    });
  }

  const resume =
    priorEngagement &&
    (catalogEntitiesPresent(entities) ||
      conversationHistory.filter((m) => m.role === "user").length >= 2);

  const phase =
    resume && currentPhase === "welcome" ? "collecting" : currentPhase;

  return {
    phase,
    entities,
    resumeOngoingConversation: resume,
  };
}
