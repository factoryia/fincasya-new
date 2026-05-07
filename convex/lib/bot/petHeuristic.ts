/**
 * Refuerzo determinista para mascotas y product_retailer_id en texto plano
 * (cuando el extractor no rellena hasPets / petCount).
 */

import type { BotEntities, BotPhase } from "./types";
import { mergeEntities } from "./entities";

/** Respuesta típica al elegir una tarjeta del catálogo sin citar el nombre. */
function inferCatalogPickIntent(raw: string): boolean {
  const t = raw.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").trim();
  if (t.length === 0 || t.length > 120) return false;
  if (
    /\b(quiero\s+esta|quiero\s+esa|me\s+quedo\s+con\s+(esta|esa)|me\s+interesa\s+(esta|esa|esa\s+opcion|esta\s+opcion)|esa\s+me\s+gusta|esta\s+me\s+gusta|la\s+quiero|esa\s+finca|esta\s+finca)\b/.test(
      t,
    )
  ) {
    return true;
  }
  if (/^(esta|esa|esta\s+misma|esa\s+misma|la\s+primera|esa\s+opcion|esta\s+opcion)$/i.test(t)) {
    return true;
  }
  return false;
}

function parseProductRetailerIdFromMessage(text: string): string | undefined {
  const m = text.match(/product_retailer_id:\s*(\S+)/i);
  const v = m?.[1]?.trim();
  return v && v.length > 2 ? v : undefined;
}

function inferPetsFromSpanish(raw: string): Partial<Pick<BotEntities, "hasPets" | "petCount">> {
  const t = raw.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  if (
    /\b(sin\s+mascotas?|no\s+llevo|no\s+voy\s+a\s+llevar|no\s+vamos?\s+con\s+mascotas?|no\s+tengo\s+mascotas?)\b/.test(
      t,
    )
  ) {
    return { hasPets: false };
  }
  /** "si 9", "sí, 3" justo después de la pregunta de mascotas (sin decir "perros"). */
  const siConNum = t.match(/\b(si|s[ií])\D{0,4}(\d{1,2})\b/);
  if (siConNum) {
    const n = parseInt(siConNum[2], 10);
    if (n >= 1 && n <= 50) return { hasPets: true, petCount: n };
  }
  const hasPetNoun = /\b(perr[oa]s?|gatos?|mascotas?)\b/.test(t);
  const carrying =
    /\b(llevo|llevar|traigo|vamos?\s+con|vienen)\b/.test(t) ||
    /\b(si|s[ií])\b[\s\S]{0,40}\b(llevo|llevar|traigo)\b/.test(t);
  if (!hasPetNoun && !carrying) return {};

  let petCount = 1;
  const mNum = t.match(/\b(\d{1,2})\s*(perr|gato|mascot)/);
  if (mNum) petCount = parseInt(mNum[1], 10);
  else if (/\b(un|una)\s+perr/.test(t)) petCount = 1;
  else if (/\bdos\s+perr/.test(t)) petCount = 2;
  else if (/\btres\s+perr/.test(t)) petCount = 3;
  else if (/\bcuatro\s+perr/.test(t)) petCount = 4;
  else if (/\bcinco\s+perr/.test(t)) petCount = 5;

  if (hasPetNoun || (/\b(si|s[ií])\b/.test(t) && carrying)) {
    return { hasPets: true, petCount };
  }
  return {};
}

/** Aplica antes de `transition`: fase catálogo/selección/mascotas. */
export function applyPetSelectionHeuristics(
  messageText: string,
  phase: BotPhase,
  entities: BotEntities,
): BotEntities {
  let next = entities;
  if (phase === "catalog_sent" && inferCatalogPickIntent(messageText)) {
    next = mergeEntities(next, { catalogUserPickedReply: true });
  }
  const rid = parseProductRetailerIdFromMessage(messageText);
  if (
    rid &&
    (phase === "catalog_sent" ||
      phase === "property_selected" ||
      phase === "pet_check")
  ) {
    next = mergeEntities(next, { selectedPropertyRetailerId: rid });
  }
  if (phase !== "property_selected" && phase !== "pet_check") return next;
  if (next.hasPets !== undefined) return next;
  const inferred = inferPetsFromSpanish(messageText);
  if (Object.keys(inferred).length > 0) {
    next = mergeEntities(next, inferred);
  }
  return next;
}
