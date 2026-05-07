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
import type { BotPhase, BotEntities } from "./types";
import { isPureGreeting, type TransitionResult } from "./transitions";
import {
  WELCOME_MESSAGE,
  missingFieldQuestion,
  missingFieldsBundle,
  datesIncoherentMessage,
  preCatalogText,
  petCheckMessage,
  CONTRACT_REQUEST_MESSAGE,
  CATALOG_SENT_SYSTEM,
  contractSystemPrompt,
  IDENTITY,
  GLOBAL_RULES,
  followUpCollectingRecapMessage,
  followUpCatalogSentVagueMessage,
  isVagueShortMessage,
  petFeesSummaryForQuote,
} from "./prompts";
import {
  buildPuenteFollowUpConversationEs,
  buildPuenteShortNoticeEs,
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
    return `Perfecto, anotamos ${n} mascota${n > 1 ? "s" : ""} 🐾 Te envío el resumen con el costo adicional.`;
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
}

/**
 * Genera el texto de respuesta para este turno.
 * Prioriza textos estáticos; solo llama al LLM cuando es imprescindible.
 */
export async function generateReply(input: ReplyInput): Promise<string> {
  const {
    currentPhase,
    transition: tr,
    entities,
    incomingText,
    conversationHistory,
    stayQuoteBlock,
  } = input;

  // ── Bienvenida pura ───────────────────────────────────────────────────────
  if (currentPhase === "welcome") {
    return WELCOME_MESSAGE;
  }

  /** Sesiones antiguas: ya en quote_shown y el siguiente paso es contract (solo pedido contrato). */
  if (currentPhase === "quote_shown" && tr.nextPhase === "contract") {
    if (!entities.contractName && !entities.contractCedula && !entities.contractEmail) {
      return CONTRACT_REQUEST_MESSAGE;
    }
  }

  // ── Resumen + pedido de contrato en un solo mensaje (tras mascotas) ───────
  const firstContractPacketAfterPets =
    tr.nextPhase === "contract" &&
    (currentPhase === "pet_check" || currentPhase === "property_selected") &&
    entities.hasPets !== undefined &&
    !entities.contractName &&
    !entities.contractCedula &&
    !entities.contractEmail;

  if (firstContractPacketAfterPets) {
    const intro = petConfirmationMessage(entities);
    const quote = (stayQuoteBlock ?? "").trim();
    const pets = petFeesSummaryForQuote(entities);
    const mid = quote
      ? [intro, quote, pets].filter(Boolean).join("\n\n")
      : [
          intro,
          "No pude calcular el valor automático con los datos guardados. Un asesor te confirma el total en segundos 📲",
        ]
          .filter(Boolean)
          .join("\n\n");
    return [mid, CONTRACT_REQUEST_MESSAGE].join("\n\n");
  }

  // ── Collecting: pregunta por campo faltante ───────────────────────────────
  if (currentPhase === "collecting" || tr.nextPhase === "collecting") {
    if (tr.datesIncoherent) return datesIncoherentMessage(entities);
    const userSaysTheyAlreadyAnswered =
      /\b(ya te hab[ií]a dicho|ya te lo dije|ya te dije|eso ya te|pero si te dije|ya lo dije arriba)\b/i.test(
        incomingText,
      );
    if (userSaysTheyAlreadyAnswered && tr.missingField) {
      return followUpCollectingRecapMessage(entities, tr.missingField);
    }
    // Puente: solo fechas en este mensaje; municipio/cupo/etc. van en el **siguiente** turno
    // cuando el cliente ya eligió fechas válidas (≥2 noches o sin bloqueo).
    if (tr.catalogPuenteOneNight) {
      if (entities.checkIn && entities.checkOut) {
        if (userAsksPuenteAlternative(incomingText)) {
          return buildPuenteFollowUpConversationEs(entities.checkIn, entities.checkOut);
        }
        return buildPuenteShortNoticeEs(entities.checkIn, entities.checkOut);
      }
      return buildPuenteShortNoticeEs("", "");
    }
    if (tr.missingField === "planType" && userAsksWhyPlanTypeMatters(incomingText)) {
      return planTypeWhyAnswerAndReask();
    }
    const fuzzy =
      isPureGreeting(incomingText) || isVagueShortMessage(incomingText);
    if (fuzzy && tr.missingField) {
      return followUpCollectingRecapMessage(entities, tr.missingField);
    }
    if (tr.missingField) {
      const bundle = missingFieldsBundle(entities);
      if (bundle) return bundle;
      return missingFieldQuestion(tr.missingField, entities);
    }
    // Todos los datos listos → texto pre-catálogo
    return preCatalogText(entities);
  }

  // ── Catálogo enviado ──────────────────────────────────────────────────────
  if (currentPhase === "catalog_sent") {
    const picked =
      entities.selectedPropertyName ||
      entities.selectedPropertyRetailerId ||
      entities.catalogUserPickedReply;
    if (picked) {
      return petCheckMessage(propertyDisplayNameForPet(entities));
    }
    if (isPureGreeting(incomingText) || isVagueShortMessage(incomingText)) {
      return followUpCatalogSentVagueMessage();
    }
    return llmReply(CATALOG_SENT_SYSTEM, conversationHistory, incomingText);
  }

  // ── Property selected → pet check (o confirmación si ya respondió mascotas) ─
  if (currentPhase === "property_selected") {
    if (entities.hasPets !== undefined) {
      return petConfirmationMessage(entities);
    }
    return petCheckMessage(propertyDisplayNameForPet(entities));
  }

  // ── Pet check ────────────────────────────────────────────────────────────
  if (currentPhase === "pet_check") {
    if (
      entities.hasPets === undefined &&
      (isPureGreeting(incomingText) || isVagueShortMessage(incomingText))
    ) {
      const name = propertyDisplayNameForPet(entities);
      return (
        `¡Sigamos! 👋 Para avanzar con *${name}* necesito que me confirmes: ` +
        `¿vas con *mascotas* (cuántas) o sin ellas? 🐕‍🦺✨`
      ).trim();
    }
    if (entities.hasPets !== undefined) {
      return petConfirmationMessage(entities);
    }
    return petCheckMessage(propertyDisplayNameForPet(entities));
  }

  // ── Contract ──────────────────────────────────────────────────────────────
  if (currentPhase === "contract" || tr.nextPhase === "contract") {
    // Primer turno en contract → pedir todos los datos
    if (!entities.contractName && !entities.contractCedula && !entities.contractEmail) {
      return CONTRACT_REQUEST_MESSAGE;
    }
    // Turno siguiente → LLM pide lo que falta con el sistema de contrato
    return llmReply(contractSystemPrompt(entities), conversationHistory, incomingText);
  }

  // ── Done ─────────────────────────────────────────────────────────────────
  if (currentPhase === "done") {
    return "¡Gracias! Un asesor te contactará en breve para finalizar los detalles 🤝✨";
  }

  // ── Fallback: LLM genérico ────────────────────────────────────────────────
  return llmReply(
    [IDENTITY, "", GLOBAL_RULES].join("\n"),
    conversationHistory,
    incomingText,
  );
}

async function llmReply(
  systemPrompt: string,
  history: CoreMessage[],
  userMessage: string,
): Promise<string> {
  try {
    const { text } = await generateText({
      model: openai(MODEL),
      system: systemPrompt,
      messages: [
        ...history.slice(-8),
        { role: "user", content: userMessage },
      ],
      temperature: 0.4,
      maxTokens: 400,
    });
    return text.trim();
  } catch {
    return "Perdona, tuve un problema técnico. ¿Puedes repetir tu mensaje? 🙏";
  }
}
