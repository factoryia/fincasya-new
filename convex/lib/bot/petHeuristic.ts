/**
 * Refuerzo determinista para mascotas y product_retailer_id en texto plano
 * (cuando el extractor no rellena hasPets / petCount).
 */

import type { BotEntities, BotPhase } from "./types";
import { mergeEntities } from "./entities";

/** Respuesta típica al elegir una tarjeta del catálogo sin citar el nombre. */
/**
 * Heurística para detectar que el cliente, estando en `catalog_sent`, escogió
 * una finca usando un mensaje natural ("está", "está en condominio", "ya dije
 * esta", "esa misma", etc.) en lugar del botón de "Responder" sobre la tarjeta.
 *
 * IMPORTANTE: solo se invoca cuando la fase es `catalog_sent` (ver
 * `applyPetSelectionHeuristics`). En cualquier otra fase el resultado se
 * ignora — eso evita falsos positivos cuando "esta" aparece como verbo
 * ("esta lloviendo", "no está disponible") en un contexto sin catálogo.
 */
function inferCatalogPickIntent(raw: string): boolean {
  const t = raw.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").trim();
  if (t.length === 0 || t.length > 200) return false;

  // Preguntas no son selección.
  if (t.includes("?") || t.includes("¿")) return false;

  // Frases explícitas de elección.
  if (
    /\b(quiero\s+(esta|esa)|me\s+quedo\s+con\s+(esta|esa)|me\s+interesa\s+(esta|esa|esa\s+opcion|esta\s+opcion)|esa\s+me\s+gusta|esta\s+me\s+gusta|la\s+quiero|esa\s+finca|esta\s+finca|esta\s+es|esa\s+es|esta\s+esta\s+bien|esa\s+esta\s+bien|esta\s+sirve|esa\s+sirve|esta\s+vale|esa\s+vale|elijo\s+(esta|esa)|seleccione\s+(esta|esa)|tomo\s+(esta|esa)|me\s+gusta\s+(esta|esa))\b/.test(
      t,
    )
  ) {
    return true;
  }

  // Mensaje EXACTO "esta" / "esa" / "esta misma" / etc. (con o sin puntuación).
  if (
    /^(esta|esa|esta\s+misma|esa\s+misma|la\s+primera|esa\s+opcion|esta\s+opcion)[\s,.\-:!]*$/i.test(
      t,
    )
  ) {
    return true;
  }

  // Mensaje EMPIEZA con "esta" / "esa" + cualquier descriptor.
  // Cubre: "esta, esta en condominio", "esa de la piscina", "esta con jacuzzi", etc.
  if (t.length <= 150 && /^(esta|esa)[\s,.\-:]/.test(t)) {
    return true;
  }

  // Cliente frustrado: "ya dije esta", "ya te dije que esa", "ya lo dije esta".
  if (/\b(ya\s+(te\s+)?dije|ya\s+lo\s+dije|ya\s+habia\s+dicho)\b[\s\S]{0,30}\b(esta|esa)\b/.test(t)) {
    return true;
  }

  // Frases cortas de confirmación: "que esta", "es esa", "esta!".
  if (
    t.length <= 30 &&
    /\b(que\s+(esta|esa)|es\s+(esta|esa)|si\s+(esta|esa)|sip\s+(esta|esa))\b/.test(
      t,
    )
  ) {
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
  // ⚠️ Solo aceptamos "sí, N" como N mascotas si el mensaje NO menciona "personas/cupo/gente"
  // y cumple alguna de estas: tiene sustantivo de mascota, abreviatura "perr/gat/masc",
  // o el mensaje completo es muy corto ("sí 3", "sí, 2"). Así evitamos falsos positivos
  // como "sí, 9 personas" interpretado como 9 mascotas.
  const mentionsPeopleNoun = /\b(personas?|gente|adult[oa]s?|ni[nñ]os?|invitad[oa]s?|hu[eé]spedes|cupo)\b/.test(t);
  const hasPetNoun = /\b(perr[oa]s?|gatos?|mascotas?|peludit[oa]s?|fid[oó]|michis?)\b/.test(t);
  const hasPetStem = /\b(perr|gat|masc)/.test(t);
  if (!mentionsPeopleNoun) {
    const siConNum = t.match(/^\s*(si|s[ií])\s*[,.\-:!]?\s*(\d{1,2})\s*\.?\s*$/);
    if (siConNum) {
      const n = parseInt(siConNum[2], 10);
      if (n >= 1 && n <= 20) return { hasPets: true, petCount: n };
    }
    if (hasPetStem) {
      const m = t.match(/\b(si|s[ií])\D{0,4}(\d{1,2})\b/);
      if (m) {
        const n = parseInt(m[2], 10);
        if (n >= 1 && n <= 20) return { hasPets: true, petCount: n };
      }
    }
  }
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
