import { openai } from "@ai-sdk/openai";
import { generateText, type CoreMessage } from "ai";
import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal, api } from "./_generated/api";
import type { Id, Doc } from "./_generated/dataModel";
import rag from "./rag";
import {
  CONSULTANT_SYSTEM_PROMPT,
  DEFAULT_CONSULTANT_SYSTEM_PROMPT,
  PROMPT_INTERNAL_PAGE_ID,
} from "./lib/consultantPrompt";
import { CONVEX_OPENAI_CHAT_MODEL } from "./lib/openaiModel";
import { transcribeAudio } from "./lib/transcription";
import {
  bogotaCalendarDateNoonMs,
  PUENTE_ONE_NIGHT_CATALOG_NOTICE_ES,
  shouldBlockCatalogForPuenteOneNightSatSun,
} from "./lib/colombiaPublicHolidays";

/**
 * Convex env: `_id` del usuario asesor. Si está definido, al escalar a humano el bot asigna la conversación.
 */
function botEscalateAssignedUserId(): string | undefined {
  const raw = process.env.CHATBOT_AUTO_ASSIGN_ADVISOR_ID?.trim();
  return raw && raw.length > 0 ? raw : undefined;
}

function extractOfficialWelcomeMessage(promptText: string): string | null {
  const marker =
    "### MENSAJE DE BIENVENIDA OFICIAL (solo cuando el cliente envía únicamente un saludo simple)";
  const start = promptText.indexOf(marker);
  if (start < 0) return null;

  const afterMarker = promptText.slice(start + marker.length);
  const exactMsgIntro =
    "Si el cliente envía solamente \"hola\", \"buenas\", \"buen día\", \"hello\", \"hey\" o un saludo equivalente SIN más contexto, envía EXACTAMENTE este mensaje:";
  const introIndex = afterMarker.indexOf(exactMsgIntro);
  if (introIndex < 0) return null;

  const afterIntro = afterMarker
    .slice(introIndex + exactMsgIntro.length)
    .replace(/^\s+/, "");
  const nextSectionIndex = afterIntro.indexOf("\n### ");
  const messageBlock =
    nextSectionIndex >= 0 ? afterIntro.slice(0, nextSectionIndex) : afterIntro;

  const clean = messageBlock.trim();
  return clean.length > 0 ? sanitizeOfficialWelcomeFromPrompt(clean) : null;
}

/**
 * Si la bienvenida en BD aún pide mascotas en el checklist inicial, la quitamos:
 * mascotas se confirman al elegir finca / cotizar (regla comercial actual).
 */
function sanitizeOfficialWelcomeFromPrompt(welcome: string): string {
  const lines = welcome.split(/\r?\n/);
  const out: string[] = [];
  let skippedMascotas = false;
  for (const line of lines) {
    if (/\b(mascotas?|perros?|gatos?)\b/i.test(line) && /viajan|llevar|llevan/i.test(line)) {
      skippedMascotas = true;
      continue;
    }
    out.push(line);
  }
  if (!skippedMascotas) return welcome;
  const joined = out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const note =
    "\n\n(Las mascotas las confirmamos cuando elijas una finca del catálogo, para aplicar bien depósitos y reglas de esa propiedad. 🐾)";
  return joined + note;
}

function extractQuickReplyBlock(promptText: string, intentKey: string): string | null {
  const escapedKey = intentKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const markerRegex = new RegExp(`###\\s*\\[\\/\\s*${escapedKey}\\b[^\\n]*`);
  const markerMatch = promptText.match(markerRegex);
  if (!markerMatch || markerMatch.index === undefined) return null;

  const afterMarker = promptText.slice(markerMatch.index + markerMatch[0].length);
  const nextSectionIndex = afterMarker.indexOf("\n### ");
  const messageBlock =
    nextSectionIndex >= 0 ? afterMarker.slice(0, nextSectionIndex) : afterMarker;
  const clean = messageBlock.trim();
  return clean.length > 0 ? clean : null;
}

/**
 * Solo afirmación corta (confirmación), sin datos nuevos de búsqueda.
 * Evita enrutar plantillas genéricas de catálogo cuando el usuario confirma "sí" a mostrar opciones.
 */
export function isAffirmativeOnly(userMessage: string): boolean {
  const t = userMessage.trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^\w\s]/g, "");
  if (t.length > 50) return false;
  return /^(s[ií]|si(\s+.*)?|ok|okey|dale|claro|va|yes|listo|bueno|uhum|aja|por\s+supuesto|adelante|confirmo|exacto|eso(\s+mismo)?)$/i.test(t);
}

/**
 * Detecta si el mensaje es una respuesta de seguimiento a preguntas sobre mascotas, personal, 
 * eventos o requerimientos de convivencia, para evitar disparar el catálogo erróneamente.
 */
export function isProvidingFollowUpData(userMessage: string): boolean {
  const t = userMessage.trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  // Fechas o capacidad
  if (/\b(\d{1,2}\s*(al|hasta)\s*\d{1,2}|para\s+\d+|huespedes|personas)\b/i.test(t)) return true;
  // Mascotas
  if (/\b(mascotas?|perros?|gatos?|llevamos|traemos|2 mascot|sin mascot)\b/i.test(t)) return true;
  // Personal / Servicios
  if (/\b(personal|servicio|empleada|cocinera|aseo)\b/i.test(t)) return true;
  // Intención de reserva / Convivencia
  if (/\b(confirmo|de\s+acuerdo|entendido|leido|requerimientos|convivencia)\b/i.test(t)) return true;
  return false;
}

/**
 * Solo respuesta negativa corta (ej. no, nada, ni idea), sin datos nuevos.
 * Evita enrutar plantillas de mascotas/etc cuando el usuario responde "no".
 */
export function isNegativeOnly(userMessage: string): boolean {
  const t = userMessage.trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^\w\s]/g, "");
  if (t.length > 50) return false;
  return /^(no(\s+.*)?|nada|ningun[oa]|tampoco|ni\s+idea|para\s+nada)$/i.test(t);
}

type KnownReservationData = {
  /** true solo si el usuario dio rango calendario (ej. del 5 al 8 de julio), no basta con "fin de semana". */
  hasDates: boolean;
  dateLabel?: string;
  /** Mencionó fin de semana / sábado pero sin fechas concretas — hace falta día y mes para cotizar temporada. */
  mentionsWeekendOnly?: boolean;
  /** Municipio/ciudad reconocido (lista de fincas en BD o keywords de respaldo). */
  hasLocation: boolean;
  locationLabel?: string;
  hasCapacity: boolean;
  capacity?: number;
  hasGroup: boolean;
  groupLabel?: string;
  hasPetsAnswer: boolean;
  petsLabel?: string;
};

/** Coincidencia por palabra completa en texto ya `normalizeAsciiText`. */
function extractCatalogLocationMention(
  normalizedUserText: string,
  locationKeywords: readonly string[] | undefined,
): { label?: string } {
  if (!locationKeywords?.length) return {};
  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const raw of locationKeywords) {
    const k = normalizeAsciiText(String(raw));
    if (k.length < 3 || seen.has(k)) continue;
    if (isInvalidCatalogLocation(k)) continue;
    seen.add(k);
    candidates.push(k);
  }
  candidates.sort((a, b) => b.length - a.length);
  const padded = ` ${normalizedUserText} `;
  for (const loc of candidates) {
    if (padded.includes(` ${loc} `)) {
      return { label: loc };
    }
  }
  return {};
}

/**
 * Evita búsquedas con "mayo amigos" / "melgar sábado y domingo": prioriza municipios
 * reconocidos en el hilo fusionado y, si no, el token de keyword más largo contenido en el parse.
 */
function resolveCatalogLocationForSearch(
  parsedLocation: string,
  mergedThread: string,
  keywords: readonly string[],
): string {
  if (isAllLocationsCatalogLocation(parsedLocation)) {
    return normalizeCatalogLocation(parsedLocation);
  }
  const threadNorm = normalizeAsciiText(mergedThread);
  const fromThread = extractCatalogLocationMention(threadNorm, keywords);
  if (fromThread.label) {
    const original = keywords.find((k) => normalizeAsciiText(String(k)) === fromThread.label);
    return normalizeCatalogLocation(String(original ?? fromThread.label));
  }
  const preliminary = normalizeCatalogLocation(parsedLocation);
  const rawNorm = normalizeAsciiText(parsedLocation);
  let bestNorm = "";
  for (const k of keywords) {
    const kn = normalizeAsciiText(String(k));
    if (kn.length >= 3 && rawNorm.includes(kn) && kn.length > bestNorm.length) {
      bestNorm = kn;
    }
  }
  if (bestNorm) {
    const original = keywords.find((k) => normalizeAsciiText(String(k)) === bestNorm);
    return normalizeCatalogLocation(String(original ?? bestNorm));
  }
  return preliminary;
}

function tryParseCatalogIntentJson(rawInput: string): Record<string, unknown> | null {
  const stripped = rawInput.trim().replace(/^```\w*\n?|\n?```$/g, "").trim();
  const tryParse = (s: string): Record<string, unknown> | null => {
    try {
      return JSON.parse(s) as Record<string, unknown>;
    } catch {
      return null;
    }
  };
  let candidate = stripped;
  const attempts: string[] = [candidate];
  candidate = candidate.replace(/\\u(?![0-9a-fA-F]{4})/g, "\\\\u");
  attempts.push(candidate);
  attempts.push(candidate.replace(/\\(?!["\\/bfnrtu])/g, "\\\\"));
  for (const s of attempts) {
    const ok = tryParse(s);
    if (ok) return ok;
  }
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const slice = stripped.slice(start, end + 1);
    const ok =
      tryParse(slice) ??
      tryParse(slice.replace(/,\s*}/g, "}").replace(/,\s*]/g, "]"));
    if (ok) return ok;
  }
  return null;
}

function wordNumberToNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const normalized = normalizeAsciiText(value);
  if (/^\d+$/.test(normalized)) return Number(normalized);
  const words: Record<string, number> = {
    un: 1,
    una: 1,
    uno: 1,
    dos: 2,
    tres: 3,
    cuatro: 4,
    cinco: 5,
    seis: 6,
  };
  return words[normalized];
}

function extractKnownReservationData(
  text: string,
  opts?: {
    assistantAskedPets?: boolean;
    currentMessage?: string;
    /** Lista de municipios desde `getAllUniqueLocations` (minúsculas/ASCII). */
    catalogLocationKeywords?: readonly string[];
  },
): KnownReservationData {
  const normalized = normalizeAsciiText(text);
  const currentNormalized = normalizeAsciiText(opts?.currentMessage ?? "");
  const locHit = extractCatalogLocationMention(normalized, opts?.catalogLocationKeywords);
  const dateRange = extractDateRangeFromText(text);
  const hasWeekend =
    /\b(fin\s+de\s+semana|este\s+fin|proximo\s+fin|el\s+fin\s+de\s+semana|sabado\s+y\s+domingo|sabado|domingo)\b/i.test(
      normalized
    );
  const capacity = extractCapacityFromText(text);
  let groupMatch = normalized.match(
    /\b(?:grupo\s+)?(familiar|familia|amigos|amigas|empresarial|empresa|corporativo|pareja)\b/i
  );
  if (!groupMatch) {
    groupMatch = normalized.match(/\bplan\s+de\s+(familiar|familia|amigos|amigas|empresarial|pareja)\b/i);
  }
  if (!groupMatch) {
    groupMatch = normalized.match(
      /\b(?:ya\s+te\s+)?d[ií]je[^.!?\n]{0,160}\b(familiar|familia|amigos|amigas|empresarial|empresa|pareja)\b/i
    );
  }
  const groupRaw = groupMatch?.[1];
  const groupLabel = groupRaw
    ? groupRaw === "familia"
      ? "familiar"
      : groupRaw === "empresa" || groupRaw === "corporativo"
        ? "empresarial"
        : groupRaw
    : undefined;

  const negativePets =
    /\b(sin\s+mascotas?|0\s+(?:mascotas?|perros?|gatos?)|no\s+(?:llevamos|llevo|viajan|van|tenemos|hay)\s+(?:mascotas?|perros?|gatos?)|ningun[ao]s?\s+(?:mascotas?|perros?|gatos?))\b/i.test(
      normalized
    ) ||
    (opts?.assistantAskedPets === true &&
      !!currentNormalized &&
      isNegativeOnly(opts.currentMessage ?? ""));
  const petCountMatch =
    normalized.match(/(\d+)\s*(?:mascotas?|perros?|gatos?)\b/i) ||
    normalized.match(/(?:mascotas?|perros?|gatos?)\s*[:\-]?\s*(\d+)/i) ||
    normalized.match(/\b(un|una|uno|dos|tres|cuatro|cinco|seis)\s+(?:mascotas?|perros?|gatos?)\b/i);
  const petCount = wordNumberToNumber(petCountMatch?.[1]);
  const positivePets =
    !negativePets &&
    (petCount != null ||
      /\b(mascotas?|perros?|gatos?|animal(?:es)?|llev[oa]\s+(?:mi\s+)?(?:perro|gato|mascota))\b/i.test(
        normalized
      ) ||
      (opts?.assistantAskedPets === true &&
        !!opts.currentMessage &&
        messageLooksLikePetAnswer(opts.currentMessage) &&
        !isNegativeOnly(opts.currentMessage)));

  return {
    hasDates: !!dateRange,
    dateLabel: dateRange?.label,
    mentionsWeekendOnly: hasWeekend && !dateRange,
    hasLocation: !!locHit.label,
    locationLabel: locHit.label,
    hasCapacity: capacity != null,
    capacity,
    hasGroup: !!groupLabel,
    groupLabel,
    hasPetsAnswer: negativePets || positivePets,
    petsLabel: negativePets ? "no" : positivePets ? (petCount ? `sí, ${petCount}` : "sí") : undefined,
  };
}

function formatKnownReservationDataSummary(known: KnownReservationData): string {
  return [
    known.hasLocation && known.locationLabel ? `destino: ${known.locationLabel}` : null,
    known.hasDates && known.dateLabel ? `fechas: ${known.dateLabel}` : null,
    !known.hasDates && known.mentionsWeekendOnly
      ? "preferencia: fin de semana (sin fechas calendario aún — pedir día/mes entrada y salida)"
      : null,
    known.hasCapacity && known.capacity ? `personas: ${known.capacity}` : null,
    known.hasGroup && known.groupLabel ? `grupo: ${known.groupLabel}` : null,
    known.hasPetsAnswer && known.petsLabel ? `mascotas: ${known.petsLabel}` : null,
  ]
    .filter(Boolean)
    .join(", ");
}

function joinSpanishList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} y ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

function buildPostCatalogFollowUp(
  excludePropertyIds: unknown[] | undefined,
  known: KnownReservationData
): string {
  if (excludePropertyIds?.length) {
    return "¿Te gustó alguna de estas opciones? 🏡 Si quieres, te comparto más alternativas con los mismos filtros.";
  }

  const pending: string[] = ["cuál finca te gustó"];
  if (!known.hasDates) pending.push("fechas exactas de entrada y salida (día y mes)");
  if (!known.hasCapacity) pending.push("número de personas");
  if (!known.hasGroup) pending.push("tipo de grupo");

  if (pending.length === 1) {
    return "Ya te compartí algunas opciones ✅ ¿Cuál finca te gustó? 🏡 Si quieres, también puedo mostrarte más alternativas.";
  }

  return `Ya te compartí algunas opciones ✅ Para continuar, dime ${joinSpanishList(pending)}.`;
}

function buildMissingReservationDetailsPrompt(
  known: KnownReservationData,
  fincaTitle?: string
): string {
  const missing: string[] = [];
  if (!known.hasDates) missing.push("fechas exactas de entrada y salida (día y mes)");
  if (!known.hasCapacity) missing.push("número de personas");
  if (!known.hasGroup) missing.push("tipo de grupo");
  if (fincaTitle && !known.hasPetsAnswer) missing.push("si viajan con mascotas");

  if (missing.length === 0) {
    if (fincaTitle) {
      return `¡Listo! Ya tengo fechas, personas, grupo y mascotas para ${fincaTitle}. ¿Avanzamos con la cotización? 🏡`;
    }
    return "Ya tengo fechas, personas y tipo de grupo ✅ Solo dime cuál finca te gustó para validar disponibilidad y valor final. 🏡";
  }

  if (fincaTitle) {
    return `Perfecto. Para avanzar con ${fincaTitle}, dime ${joinSpanishList(missing)}.`;
  }
  return `Para continuar, dime ${joinSpanishList(missing)}.`;
}

/** Paso 5 del embudo: solo la pregunta (sin párrafo de “Te hacemos esta pregunta porque…”). */
function buildEventVsDescansoFunnelPrompt(_known: KnownReservationData): string {
  return "¿Tienes contemplada la finca para algún tipo de evento o solamente para descansar y compartir? 🎉";
}

/**
 * El prompt incluye un ejemplo de "saludo inicial"; el modelo a veces lo concatena a mitad de embudo
 * antes de la pregunta evento/descanso. Si ya hay datos de reserva, dejar solo la parte útil.
 */
function stripConsultantMidFlowStep1Opening(
  text: string,
  known: KnownReservationData,
  isMidConversation: boolean,
): string {
  if (!text || text.length < 30) return text;
  const hasAnyKnownSignal =
    known.hasDates || known.hasLocation || known.hasGroup || known.hasCapacity;
  if (!isMidConversation && !hasAnyKnownSignal) return text;
  const roboticOpeningPatterns: RegExp[] = [
    /\bHola,?\s+con\s+gusto\s+te\s+ayudamos\b/i,
    /\bpreguntas\s+r[aá]pidas\b/i,
    /\brestricciones\s+sobre\s+cantidad\s+de\s+personas\b/i,
    /\btipo\s+de\s+evento,\s*sonido,\s*decoraci[oó]n/i,
    /\bingreso\s+de\s+invitados\s+adicionales\b/i,
  ];
  const robotic = roboticOpeningPatterns.some((re) => re.test(text));
  if (!robotic) return text;
  const eventMatch = text.match(
    /(?:¿\s*)?(?:La\s+idea\s+es\s+solo\s+descansar|Tienes\s+contemplada\s+la\s+finca)\b/i,
  );
  if (eventMatch && eventMatch.index != null && eventMatch.index > 0) {
    let rest = text.slice(eventMatch.index).trim();
    const cutExpl = rest.search(
      /\n+(?:Te\s+hacemos\s+esta\s+pregunta|Te\s+hacemos\s+esta\s+pregunta)/i,
    );
    if (cutExpl > 0) rest = rest.slice(0, cutExpl).trim();
    if (rest.length >= 40) return rest;
  }
  return buildEventVsDescansoFunnelPrompt(known);
}

/** Evita que el modelo pegue los textos viejos de los pasos 16–17 del prompt antes del catálogo. */
function stripPreCatalogFunnelBoilerplate(text: string): string {
  if (!text) return text;
  return text
    .replace(
      /\bSeg[uú]n\s+la\s+informaci[oó]n\s+que\s+nos\s+compartiste[^.!?\n]*[.!?]?\s*/gi,
      "",
    )
    .replace(/\bAlgunas\s+fincas\s+pueden\s+no\s+aplicar[^.!?]*[.!?]\s*/gi, "")
    .replace(/\bVamos\s+a\s+mostrarte\s+las\s+opciones[^.!?]*[.!?]\s*/gi, "")
    .replace(/Te\s+hacemos\s+esta\s+pregunta\s+porque[\s\S]*?(?:\.|!|\?)(?:\s*\n)?/gi, "")
    .replace(/\bPerfecto\.?\s+Entonces\s+buscaremos[\s\S]*?(?:\.|!|\?)\s*/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * El prompt sugiere listar municipios y preguntar "¿En dónde te gustaría empezar?"; si el cliente
 * ya nombró un destino (Melgar, Villeta, etc.) en el hilo, eso suena a que el bot no escuchó.
 */
function stripGeographicPickerWhenLocationKnown(
  text: string,
  known: KnownReservationData,
): string {
  if (!text || !known.hasLocation) return text;
  const mentionsPicker =
    /\bTe\s+puedo\s+mostrar\s+opciones\s+en\s*:/i.test(text) ||
    /\bEstas\s+son\s+algunas\s+zonas\s+donde\s+manejamos\s+disponibilidad/i.test(text);
  if (!mentionsPicker) return text;

  let cleaned = text
    .replace(
      /\bTe\s+puedo\s+mostrar\s+opciones\s+en\s*:[^\n]*(?:\n[^\n]*)?\s*¿?\s*En\s+(?:d[oó]nde|donde)\s+te\s+gustar[íi][aá][^\n?]*\?/gi,
      " ",
    )
    .replace(
      /\bEstas\s+son\s+algunas\s+zonas\s+donde\s+manejamos\s+disponibilidad\s*:[^\n]*(?:\n[^\n]*)?\s*¿?\s*En\s+(?:d[oó]nde|donde)\s+te\s+gustar[íi][aá][^\n?]*\?/gi,
      " ",
    )
    .replace(
      /\bPerfecto\s+👌\s+Para\s+mostrarte\s+opciones\s+disponibles\s+en\s+esas\s+fechas,?\s*¿[^\n]+\?\s*/gi,
      " ",
    );
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").replace(/\s{2,}/g, " ").trim();
  if (
    cleaned.length < 40 &&
    known.hasDates &&
    known.hasCapacity &&
    known.hasGroup
  ) {
    return buildEventVsDescansoFunnelPrompt(known);
  }
  return cleaned;
}

/**
 * Si el modelo mezcla recap ("¡Claro! Ya tengo Melgar…") con la pregunta de personas o evento,
 * dejar solo la pregunta (el historial ya muestra lo demás).
 */
function narrowEmbudoReplyToSingleQuestion(text: string): string {
  if (!text) return text;

  const capacityWithEmoji = /🏡\s*¿\s*Para\s+cu[aá]ntas\s+personas/i;
  const capacityPlain = /¿\s*Para\s+cu[aá]ntas\s+personas\s+necesit/i;
  for (const re of [capacityWithEmoji, capacityPlain]) {
    const m = text.match(re);
    if (m && m.index != null && m.index > 0) {
      const slice = text.slice(m.index).trim();
      if (slice.length > 35) return slice;
    }
  }

  const eventRe = /¿\s*Tienes\s+contemplada\s+la\s+finca\s+para\b/i;
  const em = text.match(eventRe);
  if (em && em.index != null && em.index > 0) {
    let slice = text.slice(em.index).trim();
    const cut = slice.search(
      /\n+(?:Te\s+hacemos\s+esta\s+pregunta|Te\s+hacemos\s+esta\s+pregunta)/i,
    );
    if (cut > 0) slice = slice.slice(0, cut).trim();
    if (slice.length > 40) return slice;
  }

  const ideaRe = /¿\s*La\s+idea\s+es\s+solo\s+descansar/i;
  const im = text.match(ideaRe);
  if (im && im.index != null && im.index > 0) {
    const slice = text.slice(im.index).trim();
    if (slice.length > 40) return slice;
  }

  return text;
}

/**
 * Si quedó solo la pregunta de personas sin 🏡 al inicio, normalizar al formato acordado.
 */
function ensureCapacityQuestionEmojiPrefix(text: string): string {
  const t = text.trim();
  if (t.length > 280) return text;
  if (/^¿\s*Para\s+cu[aá]ntas\s+personas/i.test(t) && !/^🏡/.test(t)) {
    return `🏡 ${t}`;
  }
  return text;
}

/**
 * Si la IA copia el ejemplo del PASO 3 con corchetes sin rellenar, rearmar el encabezado con datos del hilo.
 */
function repairExcelenteEleccionPlaceholders(
  text: string,
  known: KnownReservationData,
  fincaTitleFromCtx?: string | null,
): string {
  if (!text || !/¡\s*Excelente\s+elecci[oó]n/i.test(text)) return text;
  if (!/\[[^\]\n]{1,120}\]/.test(text)) return text;

  const desgloseIdx = text.search(/\n?\s*💰\s*Desglose/i);
  if (desgloseIdx < 0) return text;

  const tail = text.slice(desgloseIdx).trim();
  let fincaName = (fincaTitleFromCtx || "").trim();
  if (!fincaName) {
    const m = text.match(/Has\s+seleccionado\s+la\s+finca\s+([^\n]+?)(?:\s+para|\n)/i);
    fincaName = m?.[1]?.replace(/\[[^\]]+\]/g, "").trim() || "";
  }
  if (!fincaName) fincaName = "la finca elegida";

  const datePart = known.hasDates && known.dateLabel ? known.dateLabel : null;
  const capPart =
    known.hasCapacity && known.capacity != null ? `${known.capacity} personas` : null;
  const petPart =
    known.hasPetsAnswer && known.petsLabel && known.petsLabel !== "no"
      ? ` · Mascotas: ${known.petsLabel}`
      : "";

  let lead = `¡Excelente elección! 🏡 **${fincaName}**`;
  if (datePart && capPart) {
    lead += ` — ${datePart}, ${capPart}${petPart}`;
  } else if (datePart) {
    lead += ` — ${datePart}${petPart}`;
  } else if (capPart) {
    lead += ` — ${capPart}${petPart}`;
  } else if (petPart) {
    lead += petPart.replace(/^ ·/, " —");
  }

  return `${lead}:\n\n${tail}`;
}

function messageLooksLikeNoLocationPreference(userMessage: string): boolean {
  const normalized = normalizeAsciiText(userMessage);
  if (!normalized || normalized.length > 80) return false;
  return /^(no\s+se|no\s+tengo\s+preferencia|cualquiera|cualquier(?:a)?\s+esta\s+bien|sin\s+preferencia|me\s+da\s+igual|donde\s+haya|varios?|varias?)$/i.test(
    normalized
  );
}

function parseCatalogSelectionPayload(userMessage: string): {
  productRetailerId?: string;
  catalogId?: string;
} | null {
  const text = String(userMessage ?? "");
  if (!text) return null;
  const retailerMatch = text.match(/product_retailer_id\s*:\s*([a-zA-Z0-9_-]+)/i);
  const catalogMatch = text.match(/catalog_id\s*:\s*([a-zA-Z0-9_-]+)/i);
  if (!retailerMatch && !catalogMatch) return null;
  return {
    productRetailerId: retailerMatch?.[1]?.trim(),
    catalogId: catalogMatch?.[1]?.trim(),
  };
}

/**
 * Elimina frases del bot que preguntan por fechas cuando el cliente ya las dio (fin de semana).
 * También limpia artefactos de puntuación como ".?" que quedan tras el strip.
 */
function stripDateQuestions(text: string): string {
  return text
    // "fechas exactas de tu estadía", "fecha exacta de entrada/salida", etc.
    .replace(/[^.!?\n]*fechas?\s+exactas?[^.!?\n]*/gi, "")
    // "día/mes/año", "día, mes"
    .replace(/[^.!?\n]*d[ií]a[/,]\s*mes[^.!?\n]*/gi, "")
    // "¿Qué fechas serían?", "¿Qué fechas tienes?"
    .replace(/[^.!?\n]*qu[eé]\s+fechas?[^.!?\n]*/gi, "")
    // "fechas de entrada y salida", "fecha de ingreso y salida"
    .replace(/[^.!?\n]*fecha[^.!?\n]*(entrada|ingreso|salida|estad[ií]a)[^.!?\n]*/gi, "")
    // "📅 Fechas:", "📅 fecha:" con bullets
    .replace(/[^.!?\n]*📅[^.!?\n]*fecha[^.!?\n]*/gi, "")
    // "¿Para cuándo sería?", "¿Cuándo serían las fechas?"
    .replace(/[^.!?\n]*para\s+cu[aá]ndo\s+ser[ií]a[^.!?\n]*/gi, "")
    // Artefactos de puntuación: ".?" → ".", "?." → "?", "!?" → "!", ".." → "."
    .replace(/([.!?])\s*[?]/g, "$1")
    .replace(/([?!])\s*\./g, "$1")
    .replace(/\.{2,}/g, ".")
    // Restos típicos al quitar solo una de dos preguntas de fecha en la misma línea
    .replace(/^\s*[¿?]+\s*/g, "")
    .replace(/\s*📅\s*$/g, "")
    // Limpiar líneas vacías múltiples
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripGroupQuestions(text: string): string {
  return text
    .replace(/[^.!?\n]*tipo\s+de\s+grupo[^.!?\n]*/gi, "")
    // Literal del embudo: "familiar, de amigos" (con "de") y variantes
    .replace(
      /[^.!?\n]*(?:para\s+orientarte\s+mejor\s+con\s+el\s+filtro|plan\s+es\s+m[aá]s\s+familiar,\s*de\s+amigos|plan\s+es\s+m[aá]s\s+familiar|familiar,\s*de\s+amigos,\s*empresarial|familiar,\s+amigos,\s*empresarial|pareja\s+u\s+otro)[^.!?\n]*/gi,
      ""
    )
    .replace(/[^.!?\n]*(plan\s+es\s+m[aá]s\s+familiar|familiar,\s+amigos,\s+empresarial|pareja\s+u\s+otro)[^.!?\n]*/gi, "")
    .replace(/[^.!?\n]*familiar,\s*amigos,\s*empresarial[^.!?\n]*/gi, "")
    // "Gracias." suelto + signos + emoji tras quitar la pregunta de grupo
    .replace(/^\s*gracias\.?\s*[¿?]+\s*/gi, "")
    .replace(/\s*🏡\s*$/g, "")
    .replace(/([.!?])\s*[?]/g, "$1")
    .replace(/([?!])\s*\./g, "$1")
    .replace(/\.{2,}/g, ".")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Detecta mensajes fuera del alcance del bot (ej. operaciones matemáticas o trivia).
 * Busca ahorrar tokens evitando llamadas al LLM cuando no hay intención de reserva.
 */
export function isOutOfDomainMessage(userMessage: string): boolean {
  const normalized = userMessage
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  if (!normalized) return false;

  // Si menciona contexto de negocio, no bloquear.
  const domainSignals =
    /\b(finca|fincas|reserva|reservar|alquiler|hospedaje|estad[ií]a|check[-\s]?in|check[-\s]?out|fecha|personas|huesped|hu[eé]sped|mascota|contrato|cotiza|cotizacion|precio|disponibilidad|noche|noches|catalogo|cat[aá]logo|ubicaci[oó]n|ciudad|municipio|melgar|girardot|anapoima|tocaima|ricaurte|amigos?|familiar|familia|empresarial|empresa|pareja)\b/i;
  if (domainSignals.test(normalized)) return false;

  // Fechas comunes sin la palabra "fecha": "10-12 mayo", "del 10 al 12", etc.
  const dateLikeSignals =
    /\b(\d{1,2}\s*[-/]\s*\d{1,2}\s*(de\s+)?(ene|enero|feb|febrero|mar|marzo|abr|abril|may|mayo|jun|junio|jul|julio|ago|agosto|sep|sept|septiembre|oct|octubre|nov|noviembre|dic|diciembre)|del?\s+\d{1,2}\s+al\s+\d{1,2}\s*(de\s+)?(ene|enero|feb|febrero|mar|marzo|abr|abril|may|mayo|jun|junio|jul|julio|ago|agosto|sep|sept|septiembre|oct|octubre|nov|noviembre|dic|diciembre))\b/i;
  if (dateLikeSignals.test(normalized)) return false;

  // Operaciones aritméticas típicas: "4x4", "2+2", "10/5", etc.
  const mathExpression =
    /(^|\s)\d{1,5}\s*([x×*+\-\/]|por)\s*\d{1,5}(\s|$)/i;
  // Preguntas de calculadora / trivia no relacionadas al servicio.
  const offTopicQuestion =
    /\b(cu[aá]nto\s+es|resuelve|calcula|capital\s+de|quien\s+es|que\s+hora\s+es)\b/i;

  return mathExpression.test(normalized) || offTopicQuestion.test(normalized);
}

/**
 * Cliente pide hablar con persona / asesor (incluye errores típicos: "psasar", etc.).
 */
export function userRequestedHumanAdvisor(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (
    /(hablar\s+con\s+(un\s+)?(humano|persona|asesor|agente)|quiero\s+(un\s+)?asesor|atenci[oó]n\s+humana|operador(\s+humano)?|comunicarme\s+con(\s+alguien)?)/i.test(
      t
    )
  ) {
    return true;
  }
  if (
    /\b(me\s+)?(puede|podr[ií]a)s?\s+.{0,16}(pasar|psasar|pásar|pásame|pasame|conectar|transferir|comunicar).{0,24}(humano|persona|asesor|agente)/i.test(
      t
    )
  ) {
    return true;
  }
  if (
    /\b(pas(ar|ame|arme|enos)|conect(ar|ame|en)|derivar)\s+(con\s+)?(un\s+)?(humano|asesor|agente|persona(\s+real)?)\b/i.test(
      t
    )
  ) {
    return true;
  }
  if (/\b(persona\s+real|agente\s+humano|no\s+(quiero|es)\s+(el\s+)?bot)\b/i.test(t)) {
    return true;
  }
  return false;
}

/**
 * Etiquetas internas `[STATUS:...]` en la respuesta del modelo: quitar del texto al cliente
 * y disparar escalación cuando aplique.
 */
export function stripAssistantStatusTags(text: string): {
  clean: string;
  requiresAdvisor: boolean;
} {
  let requiresAdvisor = false;
  const clean = text
    .replace(/\s*\[\s*STATUS\s*:\s*([^\]]+?)\s*\]/gi, (_full, rawCode: string) => {
      const code = String(rawCode)
        .trim()
        .toLowerCase()
        .replace(/-/g, "_")
        .replace(/\s+/g, "_");
      if (code === "requiere_asesor") requiresAdvisor = true;
      return "";
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  return { clean, requiresAdvisor };
}

/**
 * La respuesta visible del asistente promete derivación a humano → debe ejecutarse escalate.
 */
export function assistantPromisesHumanHandoff(text: string): boolean {
  const t = text.toLowerCase();
  return (
    /\b(te\s+paso\s+con\s+(un\s+)?(asesor|humano|agente)|paso\s+con\s+un\s+asesor|pasarte\s+con\s+un\s+asesor|comunico\s+con\s+un\s+asesor)\b/i.test(
      t
    ) ||
    /\b(te\s+conectamos\s+con\s+(un\s+)?asesor|conectamos\s+con\s+un\s+asesor|te\s+conecto\s+con\s+un\s+asesor)\b/i.test(
      t
    ) ||
    /\b(un\s+asesor\s+humano|asesor\s+humano\s+de\s+inmediato|con\s+un\s+asesor\s+humano)\b/i.test(
      t
    ) ||
    /\b(ya\s+te\s+atiende\s+un\s+asesor|un\s+asesor\s+humano\s+te\s+atiende|un\s+asesor\s+te\s+(atender|escribir|contactar[aá]))\b/i.test(
      t
    ) ||
    /\b(te\s+deriv|te\s+transfier|derivaci[oó]n\s+a\s+un\s+asesor)\b/i.test(t)
  );
}

/** Ventana de tiempo para mantener conversaciones activas sin re-saludar al cliente. */
const SESSION_ACTIVE_TTL_MS = 24 * 60 * 60 * 1000; // 24 horas: conversación activa reutilizable
const SESSION_REACTIVATE_TTL_MS = 72 * 60 * 60 * 1000; // 72 horas: cliente que regresa, retomar con seguimiento

/** Retraso breve y aleatorio antes de enviar respuesta de texto (ritmo más humano; complementa el debounce). */
function humanReplyPacingMs(visibleText: string): number {
  const len = (visibleText ?? "").trim().length;
  if (len < 72) return 30 + Math.floor(Math.random() * 50);
  return 60 + Math.floor(Math.random() * 80);
}

/**
 * Deduplicación de eventos YCloud (reintentos).
 */
export const recordProcessedEvent = internalMutation({
  args: { eventId: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("ycloudProcessedEvents")
      .withIndex("by_event_id", (q) => q.eq("eventId", args.eventId))
      .unique();
    if (existing) return { duplicate: true };
    await ctx.db.insert("ycloudProcessedEvents", { eventId: args.eventId });
    return { duplicate: false };
  },
});

/**
 * Obtener o crear contacto por teléfono.
 */
export const getOrCreateContact = internalMutation({
  args: { phone: v.string(), name: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("contacts")
      .withIndex("by_phone", (q) => q.eq("phone", args.phone))
      .unique();
    if (existing) return existing._id;
    const now = Date.now();
    return await ctx.db.insert("contacts", {
      phone: args.phone,
      name: args.name || args.phone,
      crmType: "lead",
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Cuando el bot ya identifica finca + cupo, enriquecer el nombre en CRM como lead
 * (ej. "Santiago Quinta Tramonti 10p Melgar") sin tratarlo como cliente con reserva.
 * No pisa contactos ya marcados como client o con reserva confirmada en BD.
 */
export const syncLeadDisplayFromBotContext = internalMutation({
  args: {
    contactId: v.id("contacts"),
    whatsappDisplayName: v.string(),
    fincaTitle: v.string(),
    capacity: v.number(),
    locationHint: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const c = await ctx.db.get(args.contactId);
    if (!c) return;
    if (c.crmType === "client" || c.lastReservationAt) return;

    const raw = String(args.whatsappDisplayName ?? "").trim();
    const phoneLike = /^[\d\s\-+()]{10,}$/.test(raw.replace(/\s/g, ""));
    const customerLabel =
      raw.length > 0 && !phoneLike ? raw.slice(0, 48) : "Cliente";

    const finca = String(args.fincaTitle ?? "").trim();
    const cap = Math.floor(Number(args.capacity));
    if (!finca || cap < 1 || cap > 999) return;

    const locRaw = String(args.locationHint ?? "").trim();
    const locShort =
      locRaw.length > 0
        ? locRaw.split(/[\s,]+/).filter(Boolean).slice(0, 2).join(" ")
        : "";

    const parts = [customerLabel, finca, `${cap}p`, locShort].filter(Boolean);
    const leadName = parts.join(" ").replace(/\s+/g, " ").trim().slice(0, 200);
    if (leadName.length < 3) return;

    if (c.name === leadName && c.crmType === "lead") return;

    await ctx.db.patch(args.contactId, {
      name: leadName,
      crmType: "lead",
      updatedAt: Date.now(),
    });
  },
});

/**
 * Obtener o crear conversación para un contacto.
 * - Si hay una activa (ai o human) dentro de las últimas 24h, se reutiliza.
 * - Si la más reciente está resuelta y fue hace menos de 72h, se reactiva (isReactivated=true) para usar mensaje de seguimiento.
 * - Si pasó más tiempo, se crea conversación nueva (isNew=true).
 */
export const getOrCreateConversation = internalMutation({
  args: { contactId: v.id("contacts") },
  handler: async (ctx, args) => {
    const now = Date.now();
    const all = await ctx.db
      .query("conversations")
      .withIndex("by_contact", (q) => q.eq("contactId", args.contactId))
      .order("desc")
      .collect();

    const active = all.find((c) => c.status === "ai" || c.status === "human");
    if (active) {
      const activeTs = Number(active.lastMessageAt ?? active.createdAt ?? 0);
      const withinActiveWindow = activeTs > 0 && (now - activeTs) < SESSION_ACTIVE_TTL_MS;
      if (withinActiveWindow) {
        return { conversationId: active._id, isNew: false, isReactivated: false };
      }
      // Fuera de ventana activa: cerrar para evitar arrastrar contexto obsoleto.
      await ctx.db.patch(active._id, { status: "resolved" });
    }

    const latestResolved = all.find((c) => c.status === "resolved");
    if (latestResolved) {
      const resolvedTs = Number(
        latestResolved.lastMessageAt ?? latestResolved.createdAt ?? 0
      );
      const withinReactivateWindow = resolvedTs > 0 && (now - resolvedTs) < SESSION_REACTIVATE_TTL_MS;
      if (withinReactivateWindow) {
        await ctx.db.patch(latestResolved._id, {
          status: "ai",
          operationalState: "pending_data",
        });
        // isReactivated=true: cliente que regresó → usar mensaje de seguimiento, NO bienvenida desde cero.
        return { conversationId: latestResolved._id, isNew: false, isReactivated: true };
      }
    }

    const conversationId = await ctx.db.insert("conversations", {
      contactId: args.contactId,
      channel: "whatsapp",
      status: "ai",
      operationalState: "pending_data",
      lastMessageAt: now,
      createdAt: now,
    });

    // La bienvenida va por plantilla YCloud (elegida del listado), no por texto falso en BD.
    return { conversationId, isNew: true, isReactivated: false };
  },
});

/**
 * Procesar mensaje entrante: guardar mensaje del usuario y, si status === "ai", generar respuesta con RAG + fincas y enviar por WhatsApp.
 */
export const processInboundMessage = internalAction({
  args: {
    eventId: v.string(),
    phone: v.string(),
    name: v.string(),
    text: v.string(),
    wamid: v.optional(v.string()),
    type: v.optional(
      v.union(
        v.literal("text"),
        v.literal("image"),
        v.literal("audio"),
        v.literal("video"),
        v.literal("document")
      )
    ),
    mediaUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Ignorar ruido técnico que no viene del cliente (presencia/estado del canal).
    const rawInboundText = String(args.text ?? "").trim();
    if (
      /^status\s*:\s*active$/i.test(rawInboundText) ||
      /^presence\s*:\s*active$/i.test(rawInboundText)
    ) {
      console.log("[inbound-filter] Mensaje técnico ignorado:", rawInboundText, {
        phone: args.phone,
        eventId: args.eventId,
      });
      return;
    }

    const contactId: Id<"contacts"> = await ctx.runMutation(
      internal.ycloud.getOrCreateContact,
      { phone: args.phone, name: args.name }
    );

    const { conversationId, isReactivated } = await ctx.runMutation(
      internal.ycloud.getOrCreateConversation,
      { contactId }
    );

    const now = Date.now();
    let finalContent = args.text;

    // ── TRANSCRIPCIÓN: Si es audio, intentar transcribir antes de guardar ──
    if (args.type === "audio" && args.mediaUrl) {
      try {
        console.log("[transcription] Iniciando transcripción...");
        // Obtener nombres de fincas para el prompt de Whisper
        const allFincas = await ctx.runQuery(api.fincas.search, { query: " ", limit: 1000 });
        const fincaNames = allFincas.map(p => p.title).join(", ");
        
        const contextualPrompt = `FincasYa, reservación de fincas, hospedaje, fin de semana. Fincas: ${fincaNames}. Palabras clave: mascotas, adultos, niños, personas, depósito, reserva, entrada, salida, disponibilidad.`;
        
        const transcription = await transcribeAudio(args.mediaUrl, contextualPrompt);
        console.log("[transcription] Resultado:", transcription);
        finalContent = `[Voz] ${transcription}`;
      } catch (err) {
        console.error("[voice] Error transcribiendo audio:", err);
        // Fallback a [Audio] si falla la transcripción
        finalContent = "[Audio] (Transcripción fallida)";
      }
    }

    const insertedUserMessageId = await ctx.runMutation(internal.messages.insertUserMessage, {
      conversationId,
      content: finalContent,
      createdAt: now,
      type: args.type,
      mediaUrl: args.mediaUrl,
    });

    // ── Debounce dinámico para balancear rapidez y agrupación de mensajes ──
    // Casos simples (saludo corto) responden casi inmediato.
    // Mensajes normales esperan un poco para agrupar ráfagas ("hola" + detalle).
    const rawText = (args.text ?? "").trim().toLowerCase();
    const isShortGreeting =
      /^(hola|buenas|buenos dias|buen día|buen dia|hi|hey)\??!?$/i.test(rawText);
    const isTinyFollowUpFragment =
      /^(\?|!|ok|oka+y?|dale|listo|si|sí|no|aja|ajá|mmm|hmm|👍|🙏|👀)\??!?$/i.test(
        rawText
      );
    // Para fragmentos cortos esperamos más para permitir "burst-merge" y evitar doble respuesta.
    const DEBOUNCE_MS = isTinyFollowUpFragment ? 700 : isShortGreeting ? 250 : 700;
    await new Promise((resolve) => setTimeout(resolve, DEBOUNCE_MS));

    // Releer la conversación para obtener el lastMessageAt más actualizado
    const convAfterDebounce = await ctx.runQuery(api.conversations.getById, {
      conversationId,
    });
    if (!convAfterDebounce) return;

    // Si llegó un mensaje más nuevo durante la espera, este handler cede el turno
    if ((convAfterDebounce.lastMessageAt ?? 0) > now) {
      console.log("[debounce] Mensaje más nuevo detectado, cediendo turno al handler posterior", {
        phone: args.phone,
        theirMessageAt: now,
        newerMessageAt: convAfterDebounce.lastMessageAt,
      });
      return;
    }

    // Guardia anti-duplicados: solo el handler del último mensaje de usuario responde.
    const latestMessage = await ctx.runQuery(api.messages.getLatestUserMessage, {
      conversationId,
      scanLimit: 50,
    });
    const latest = latestMessage as any;
    if (!latest || String(latest._id) !== String(insertedUserMessageId)) {
      console.log("[debounce] Handler no es el último mensaje de usuario, se omite respuesta", {
        phone: args.phone,
        insertedUserMessageId,
        latestUserMessageId: latest?._id,
      });
      return;
    }
    const shouldAbortIfNotLatestUser = async (stage: string) => {
      const latestUser = (await ctx.runQuery(api.messages.getLatestUserMessage, {
        conversationId,
        scanLimit: 50,
      })) as any;
      if (!latestUser || String(latestUser._id) !== String(insertedUserMessageId)) {
        console.log("[debounce] Handler desfasado, se cancela", {
          stage,
          phone: args.phone,
          insertedUserMessageId,
          latestUserMessageId: latestUser?._id,
        });
        return true;
      }
      return false;
    };
    const shouldAbortIfAssistantAlreadyReplied = async (stage: string) => {
      const recentMsgs = (await ctx.runQuery(api.messages.listRecent, {
        conversationId,
        // Un catálogo puede insertar hasta 8 fichas + un follow-up; el límite
        // debe alcanzar a ver el último mensaje del cliente para deduplicar bien.
        limit: 40,
      })) as any[];
      const latestUserIdx = [...recentMsgs]
        .map((m, i) => ({ m, i }))
        .reverse()
        .find((x) => x.m.sender === "user")?.i;
      if (latestUserIdx === undefined) return false;
      const latestUserMsg = recentMsgs[latestUserIdx];
      if (String(latestUserMsg?._id) !== String(insertedUserMessageId)) return false;
      const newerAssistantExists = recentMsgs.some((m, i) => {
        if (i <= latestUserIdx) return false;
        return m.sender === "assistant";
      });
      if (newerAssistantExists) {
        console.log("[dedupe] ya existe respuesta de asistente para este turno, se cancela", {
          stage,
          phone: args.phone,
          insertedUserMessageId,
        });
        return true;
      }
      return false;
    };

    const conv = convAfterDebounce;
    const shouldReply = conv.status === "ai";

    /** Usuario pide hablar con un humano → escalar y marcar "Requiere asesor". */
    const rawForHuman =
      args.type === "audio" && finalContent.startsWith("[Voz]")
        ? finalContent.replace(/^\[Voz\]\s*/, "")
        : String(args.text || "");
    const wantsHumanAdvisor = userRequestedHumanAdvisor(rawForHuman);
    if (shouldReply && wantsHumanAdvisor) {
      await ctx.runMutation(internal.conversations.escalate, {
        conversationId,
        assignedUserId: botEscalateAssignedUserId(),
      });
      const handoffMsg =
        "Perfecto, te comunico con un asesor de nuestro equipo para ayudarte personalmente. Un agente te escribirá en breve. ✨";
      await ctx.runMutation(internal.messages.insertAssistantMessage, {
        conversationId,
        content: handoffMsg,
        createdAt: Date.now(),
      });
      await ctx.runAction(internal.ycloud.sendWhatsAppMessage, {
        to: args.phone,
        text: handoffMsg,
        wamid: args.wamid,
      });
      await ctx.runMutation(internal.conversations.updateLastMessageAt, {
        conversationId,
      });
      return;
    }

    if (shouldReply) {
      // Contexto para la IA
      let currentMessageText = (args.type === "audio" && finalContent.startsWith("[Voz]")) 
        ? finalContent 
        : (args.text || "");
      const promptOverrideForGreeting = await ctx.runQuery(api.internalPages.getById, {
        pageId: PROMPT_INTERNAL_PAGE_ID,
      });
      const promptOverrideGreetingText =
        promptOverrideForGreeting &&
        typeof promptOverrideForGreeting === "object" &&
        "prompt" in promptOverrideForGreeting &&
        typeof (promptOverrideForGreeting as { prompt?: unknown }).prompt === "string"
          ? (promptOverrideForGreeting as { prompt: string }).prompt.trim()
          : "";
      const effectivePromptForGreeting =
        promptOverrideGreetingText.length > 0
          ? promptOverrideGreetingText
          : DEFAULT_CONSULTANT_SYSTEM_PROMPT;
      const normalizedIncomingText = String(currentMessageText || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .trim();
      const OPENING_QUALIFICATION_TEXT =
        extractOfficialWelcomeMessage(effectivePromptForGreeting) ||
        "¡Hola! Es un gusto saludarte. Te escribe Hernán de FincasYa.com 🏡✨\n\n" +
          "Tenemos opciones espectaculares de fincas listas para ti 🤩 y quiero ayudarte a encontrar la ideal según tu plan.\n\n" +
          "Compárteme por favor:\n\n" +
          "📅 Fechas: entrada y salida\n\n" +
          "👨‍👩‍👧‍👦 Cupo: número de personas (desde los 2 años)\n\n" +
          "🏡 Tipo de grupo: familiar, amigos o empresarial\n\n" +
          "📍 Ubicación: municipio o zona (si ya tienes una en mente)\n\n" +
          "Con esto te envío opciones disponibles, fotos, precios y promociones ajustadas a lo que buscas 🔥\n\n" +
          "Las mascotas las confirmamos cuando elijas una finca, para cotizar bien depósitos y reglas de esa propiedad. 🐾\n\n" +
          "Estoy atento para ayudarte a reservar tu finca perfecta ✨";
      const userRequestedFlowRestart =
        /^(clear|limpiar|reiniciar|reinicia|reset|start over|empezar de nuevo|iniciar de nuevo)$/i.test(
          normalizedIncomingText
        );
      const isSimpleGreetingOnly =
        /^(hola|buenas|buenos dias|buen día|buen dia|hello|hi|hey)\??!?$/i.test(
          normalizedIncomingText
        );
      if (userRequestedFlowRestart) {
        await ctx.runMutation(internal.messages.insertAssistantMessage, {
          conversationId,
          content: OPENING_QUALIFICATION_TEXT,
          createdAt: Date.now(),
        });
        await ctx.runAction(internal.ycloud.sendWhatsAppMessage, {
          to: args.phone,
          text: OPENING_QUALIFICATION_TEXT,
          wamid: args.wamid,
        });
        await ctx.runMutation(internal.conversations.updateLastMessageAt, {
          conversationId,
        });
        return;
      }
      if (isSimpleGreetingOnly) {
        await ctx.runMutation(internal.messages.insertAssistantMessage, {
          conversationId,
          content: OPENING_QUALIFICATION_TEXT,
          createdAt: Date.now(),
        });
        await ctx.runAction(internal.ycloud.sendWhatsAppMessage, {
          to: args.phone,
          text: OPENING_QUALIFICATION_TEXT,
          wamid: args.wamid,
        });
        await ctx.runMutation(internal.conversations.updateLastMessageAt, {
          conversationId,
        });
        return;
      }
      let singleFincaSent = false;
      let fincaTitle = "";
      let confirmedFincaTitle: string | undefined; // Título oficial encontrado en DB
      let selectedCatalogPropertyTitle: string | undefined;
      let whatsappCatalogSentForSearch = false;
      let catalogLocation = "";
      let catalogFincasCount = 0;
      let catalogFoundFincasButFailed = false;
      let catalogIntent: CatalogIntent = { intent: "none" };

      const recentForCatalogIntent = await ctx.runQuery(api.messages.listRecent, {
        conversationId,
        limit: 14,
      });
      const dynamicLocationsList = await ctx.runQuery(api.fincas.getAllUniqueLocations, {});
      const normalizedAllUserTextForFilters = [currentMessageText]
        .concat(
          recentForCatalogIntent
            .filter((m: any) => m.sender === "user")
            .map((m: any) => String(m.content ?? ""))
        )
        .join("\n")
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{M}/gu, "");
      // Si ya estamos recolectando datos para contrato/reserva, NO reabrir catálogo.
      const contractPromptInHistory = recentForCatalogIntent.some((m: any) => {
        if (m.sender !== "assistant") return false;
        const t = String(m.content ?? "").toLowerCase();
        return (
          /elaborar\s+tu\s+contrato|datos\s+de\s+la\s+persona|documento\s+de\s+identidad|lugar\s+de\s+expedici[oó]n|correo\s+electr[oó]nico|direcci[oó]n|hora\s+aproximada\s+de\s+ingreso|formalizar\s+la\s+reserva/.test(
            t
          )
        );
      });
      const currentLooksLikeContractData =
        /\b\d{6,}\b/.test(currentMessageText) ||
        /@\w+\.\w+/.test(currentMessageText) ||
        /#\d+/.test(currentMessageText) ||
        /(calle|carrera|cra\.?|cl\.?|avenida|av\.?|mz|manzana|barrio)\s*[\w\d]/i.test(currentMessageText);
      const shouldBlockCatalogByContractFlow =
        contractPromptInHistory && currentLooksLikeContractData;
      if (shouldBlockCatalogByContractFlow) {
        console.log("[catalog-guard] Bloqueado por flujo de contrato/datos personales");
      }

      // Detectar si el cliente YA está entregando los datos personales requeridos (PASO 5).
      // Combina el mensaje actual + mensajes recientes del cliente (pudo haberlos mandado en ráfaga).
      const userTextsAfterContractPrompt: string[] = (() => {
        if (!contractPromptInHistory) return [];
        const out: string[] = [];
        // Tomar user messages posteriores al último mensaje assistant con la plantilla.
        let foundAssistantPrompt = false;
        for (let i = recentForCatalogIntent.length - 1; i >= 0; i--) {
          const m: any = recentForCatalogIntent[i];
          if (m.sender === "assistant") {
            const t = String(m.content ?? "").toLowerCase();
            if (/elaborar\s+tu\s+contrato|datos\s+de\s+la\s+persona/.test(t)) {
              foundAssistantPrompt = true;
              break;
            }
          }
        }
        if (!foundAssistantPrompt) return [];
        let seenPrompt = false;
        for (const m of recentForCatalogIntent) {
          if (!seenPrompt) {
            if (
              m.sender === "assistant" &&
              /elaborar\s+tu\s+contrato|datos\s+de\s+la\s+persona/i.test(String(m.content ?? ""))
            ) {
              seenPrompt = true;
            }
            continue;
          }
          if (m.sender === "user") out.push(String(m.content ?? ""));
        }
        out.push(currentMessageText);
        return out;
      })();
      const contractDataBlob = userTextsAfterContractPrompt.join("\n");
      const clientDataFlags = {
        hasFullName: /\b[A-ZÁÉÍÓÚÑa-záéíóúñ]{3,}\s+[A-ZÁÉÍÓÚÑa-záéíóúñ]{3,}(?:\s+[A-ZÁÉÍÓÚÑa-záéíóúñ]{3,})*/.test(
          contractDataBlob
        ),
        hasIdNumber: /\b\d{7,12}\b/.test(contractDataBlob),
        hasPhone: /\b3\d{9}\b/.test(contractDataBlob),
        hasEmail: /@\w+\.\w+/.test(contractDataBlob),
        hasAddress: /(calle|carrera|cra\.?|cl\.?|avenida|av\.?|mz|manzana|barrio)\s*[\w\d]/i.test(
          contractDataBlob
        ),
      };
      const providedDataCount =
        Number(clientDataFlags.hasFullName) +
        Number(clientDataFlags.hasIdNumber) +
        Number(clientDataFlags.hasPhone) +
        Number(clientDataFlags.hasEmail || clientDataFlags.hasAddress);
      const clientDeliveredPersonalData =
        contractPromptInHistory && providedDataCount >= 3;
      if (clientDeliveredPersonalData) {
        console.log("[contract-stage] cliente entregó sus datos →", clientDataFlags);
      }

      // Detectar si el asistente ya confirmó una finca específica en mensajes recientes
      // (evitar re-enviar catálogo en mensajes de seguimiento: "si", "dale", "quiero reservar", etc.)
      const fincaConfirmedInHistory = recentForCatalogIntent.some((m: any) => {
        if (m.sender !== "assistant") return false;
        const t = String(m.content ?? "");
        return /aqu[ií]\s+est[áa]\s+\w|confirmo\s+recepci[oó]n\s+de|excelente\s+elecci[oó]n|recib[ií]\s+tu\s+selecci[oó]n/i.test(t);
      });
      // Extraer el nombre de la finca confirmada del historial para reutilizarlo
      const confirmedFincaInHistoryTitle = (() => {
        for (const m of recentForCatalogIntent) {
          if (m.sender !== "assistant") continue;
          const t = String(m.content ?? "");
          const match = t.match(/(?:confirmo\s+recepci[oó]n\s+de|recib[ií]\s+tu\s+selecci[oó]n:\s*|excelente\s+elecci[oó]n[^*]*\*)\s*\*?([A-ZÁÉÍÓÚ][A-ZÁÉÍÓÚ\s]{2,40})\*?/i);
          if (match?.[1]) return match[1].trim();
        }
        return undefined;
      })();
      // Bloquear catálogos si finca ya está confirmada y el usuario NO está pidiendo explícitamente otras opciones
      const userExplicitlyWantsOtherOptions =
        /\b(otras\s+opciones?|otra\s+finca|diferente|cambiar\s+finca|ver\s+m[aá]s|m[aá]s\s+opciones?)\b/i.test(
          currentMessageText
        );
      const shouldBlockCatalogFincaConfirmed =
        fincaConfirmedInHistory && !userExplicitlyWantsOtherOptions;
      if (shouldBlockCatalogFincaConfirmed) {
        console.log("[catalog-guard] Bloqueado — finca ya confirmada en historial, usuario en flujo de reserva:", confirmedFincaInHistoryTitle);
        // Si no tenemos fincaTitle del run actual, usar el del historial
        if (!fincaTitle && confirmedFincaInHistoryTitle) {
          fincaTitle = confirmedFincaInHistoryTitle;
          confirmedFincaTitle = confirmedFincaInHistoryTitle;
        }
      }
      // Si hay varios mensajes consecutivos del cliente sin respuesta del asistente,
      // fusionarlos en una sola entrada para evitar respuestas fragmentadas/robóticas.
      if (args.type === "text") {
        const burst: string[] = [];
        for (let i = recentForCatalogIntent.length - 1; i >= 0; i--) {
          const m: any = recentForCatalogIntent[i];
          if (m.sender === "assistant") break;
          if (m.sender === "user" && (m.type === "text" || !m.type)) {
            const content = String(m.content ?? "").trim();
            if (content) burst.push(content);
          }
        }
        if (burst.length > 1) {
          burst.reverse();
          currentMessageText = burst.join("\n");
          console.log("[burst-merge] mensajes de cliente fusionados:", burst.length);
        }
      }

      // Tras fusionar ráfagas: el pedido de humano puede estar solo en un segmento anterior.
      if (userRequestedHumanAdvisor(currentMessageText)) {
        await ctx.runMutation(internal.conversations.escalate, {
          conversationId,
          assignedUserId: botEscalateAssignedUserId(),
        });
        const handoffMsg =
          "Perfecto, te comunico con un asesor de nuestro equipo para ayudarte personalmente. Un agente te escribirá en breve. ✨";
        await ctx.runMutation(internal.messages.insertAssistantMessage, {
          conversationId,
          content: handoffMsg,
          createdAt: Date.now(),
        });
        await ctx.runAction(internal.ycloud.sendWhatsAppMessage, {
          to: args.phone,
          text: handoffMsg,
          wamid: args.wamid,
        });
        await ctx.runMutation(internal.conversations.updateLastMessageAt, {
          conversationId,
        });
        return;
      }

      // Si el usuario selecciona un ítem de catálogo (payload order), resolver retailer_id a nombre real.
      const catalogSelection = parseCatalogSelectionPayload(currentMessageText);
      if (catalogSelection?.productRetailerId) {
        // Marcar que hubo selección aunque no se pueda resolver el nombre
        selectedCatalogPropertyTitle = "finca seleccionada";
        try {
          const selectedProperty = await ctx.runQuery(
            api.propertyWhatsAppCatalog.getPropertyByRetailerId,
            {
              productRetailerId: catalogSelection.productRetailerId,
              whatsappCatalogId: catalogSelection.catalogId,
            }
          );
          if (selectedProperty?.title) {
            selectedCatalogPropertyTitle = selectedProperty.title;
            confirmedFincaTitle = selectedProperty.title;
            fincaTitle = selectedProperty.title;
            currentMessageText = `${currentMessageText}\nFinca seleccionada del catálogo: ${selectedProperty.title}`;
            // Actualizar el mensaje en la BD para que el frontend pueda mostrar el nombre
            if (insertedUserMessageId) {
              await ctx.runMutation(internal.messages.updateMessageContent, {
                messageId: insertedUserMessageId,
                content: currentMessageText,
              });
            }
            console.log("[catalog-selection] retailer_id resuelto a finca:", {
              retailerId: catalogSelection.productRetailerId,
              fincaTitle: selectedProperty.title,
            });
          } else {
            console.log("[catalog-selection] retailer_id no resuelto, usando placeholder:", catalogSelection.productRetailerId);
          }
        } catch (e) {
          console.error("[catalog-selection] Error resolviendo retailer_id:", e);
        }
      }

      // Guardrail: evitar gastar tokens en consultas fuera del propósito del bot.
      const mergedUserTextForOODGuard = [
        currentMessageText,
        ...recentForCatalogIntent
          .filter((m: any) => m.sender === "user")
          .map((m: any) => String(m.content ?? "")),
      ].join("\n");
      const knownForOODGuard = extractKnownReservationData(mergedUserTextForOODGuard, {
        assistantAskedPets: recentForCatalogIntent.some(
          (m: any) => m.sender === "assistant" && /\bmascotas?|perros?|gatos?\b/i.test(String(m.content ?? "")),
        ),
        currentMessage: currentMessageText,
        catalogLocationKeywords: dynamicLocationsList,
      });
      const hasReservationSignalForOODGuard =
        knownForOODGuard.hasDates ||
        knownForOODGuard.hasLocation ||
        knownForOODGuard.hasCapacity ||
        knownForOODGuard.hasGroup ||
        knownForOODGuard.hasPetsAnswer;
      if (
        args.type === "text" &&
        isOutOfDomainMessage(currentMessageText) &&
        !hasReservationSignalForOODGuard
      ) {
        const outOfDomainReply =
          "Estoy para ayudarte con reservas de fincas (disponibilidad, precios y contrato). 🏡 Compárteme por favor ciudad, fechas y número de personas para asistirte de inmediato.";
        await ctx.runMutation(internal.messages.insertAssistantMessage, {
          conversationId,
          content: outOfDomainReply,
          createdAt: Date.now(),
        });
        await ctx.runAction(internal.ycloud.sendWhatsAppMessage, {
          to: args.phone,
          text: outOfDomainReply,
          wamid: args.wamid,
        });
        await ctx.runMutation(internal.conversations.setOperationalStateInternal, {
          conversationId,
          operationalState: "requires_advisor",
        });
        await ctx.runMutation(internal.conversations.updateLastMessageAt, {
          conversationId,
        });
        return;
      }
      const catalogIntentSnippet = recentForCatalogIntent
        .map(
          (m: any) =>
            `${m.sender === "user" ? "Cliente" : "Asistente"}: ${m.content.slice(0, 320)}`
        )
        .join("\n");

      // ── VISIÓN: Si el usuario envió una imagen, analizar primero para identificar la finca ──
      let imageIdentifiedFincaName: string | undefined;
      if (args.type === "image" && args.mediaUrl) {
        try {
          console.log("[vision] Analizando imagen del usuario...");
          const allFincas = await ctx.runQuery(api.fincas.search, {
            query: " ", // traer todas
            limit: 50,
          });
          const fincaNames = allFincas.map((f: any) => f.title).join(", ");

          const { text: visionResult } = await generateText({
            model: openai.chat(CONVEX_OPENAI_CHAT_MODEL),
            // Familia GPT-5.x suele exigir temperature por defecto (1); 0 puede rechazarse en la API.
            temperature: 1,
            system: `Eres un asistente que identifica propiedades (fincas) a partir de imágenes.
Se te dará una imagen y la lista de fincas disponibles. Tu ÚNICA tarea es responder con el NOMBRE EXACTO de la finca que aparece en la imagen.
Si ves el nombre de la finca escrito en la imagen (en un letrero, banner, overlay del catálogo, etc.), úsalo.
Si no puedes identificar la finca con certeza, responde SOLO: "NO_IDENTIFICADA".
NO expliques nada, NO agregues texto extra. Solo el nombre exacto o "NO_IDENTIFICADA".

Fincas disponibles: ${fincaNames}`,
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: currentMessageText === "[Imagen]" ? "¿Qué finca es esta?" : currentMessageText },
                  { type: "image", image: new URL(args.mediaUrl) },
                ],
              },
            ],
          });

          const trimmed = visionResult.trim();
          if (trimmed && trimmed !== "NO_IDENTIFICADA") {
            imageIdentifiedFincaName = trimmed;
            console.log("[vision] Finca identificada:", imageIdentifiedFincaName);
            // Override catalog intent para que se envíe la ficha
            catalogIntent = { intent: "single_finca", fincaName: imageIdentifiedFincaName };
          } else {
            console.log("[vision] No se pudo identificar la finca de la imagen");
          }
        } catch (e) {
          console.error("[vision] Error analizando imagen:", e);
        }
      }

      try {
        catalogIntent = await ctx.runAction(internal.ycloud.detectCatalogIntentWithAI, {
          userMessage: imageIdentifiedFincaName
            ? `Quiero reservar la finca ${imageIdentifiedFincaName}`
            : currentMessageText,
          conversationSnippet: catalogIntentSnippet,
        });
      } catch (e) {
        console.error("YCloud detectCatalogIntentWithAI error:", e);
      }

      // Si la visión ya identificó la finca, forzar el intent
      if (imageIdentifiedFincaName) {
        catalogIntent = { intent: "single_finca", fincaName: imageIdentifiedFincaName };
      }
      // Si llegó selección desde catálogo, forzar intent de finca específica usando nombre oficial.
      if (selectedCatalogPropertyTitle) {
        catalogIntent = { intent: "single_finca", fincaName: selectedCatalogPropertyTitle };
      }

      /** Reserva / consulta que requiere validar disponibilidad con el operador. */
      const wantsAvailabilityCheck =
        /\b(disponibilidad|disponible|hay\s+cupo|confirm(ar|en|ame)?\s+(que\s+)?(hay|est[áa])|verificar\s+fechas?)\b/i.test(
          currentMessageText
        ) &&
        /\b(reserva|reservar|alquil|finca|hosped|estad[íi]a|fechas?)\b/i.test(
          currentMessageText
        );
      if (
        wantsAvailabilityCheck &&
        (catalogIntent.intent === "search_catalog" ||
          catalogIntent.intent === "single_finca")
      ) {
        await ctx.runMutation(internal.conversations.setOperationalStateInternal, {
          conversationId,
          operationalState: "validate_availability",
        });
      }

      if (contractPromptInHistory && !clientDeliveredPersonalData) {
        await ctx.runMutation(internal.conversations.setOperationalStateInternal, {
          conversationId,
          operationalState: "pending_data",
        });
      }

      // Enviar ficha de una finca (IA o regex como respaldo).
      // PERO NO re-enviar si el usuario está dando datos de seguimiento (fechas, personas) SIN mencionar finca
      const followUpData = isProvidingFollowUpData(currentMessageText) 
        && catalogIntent.intent !== "single_finca";

      // Si ya se envió un catálogo múltiple antes (lastSentCatalogPropertyIds >= 1) y el usuario
      // ahora selecciona una finca específica (ya sea por nombre plano "villas privadas" o con
      // intención explícita "quiero reservar villas privadas"), NO re-enviar la ficha individual:
      // el cliente ya la vio dentro del catálogo anterior. Avanzar directo a la confirmación de
      // reserva + datos de contrato.
      const multipleCatalogAlreadySentInHistory =
        Array.isArray((conv as any).lastSentCatalogPropertyIds) &&
        ((conv as any).lastSentCatalogPropertyIds as unknown[]).length >= 1;
      // Cualquier catálogo WhatsApp enviado recientemente por el asistente también cuenta como
      // "ya le mostramos la ficha" (por si lastSentCatalogPropertyIds aún no se actualizó).
      const assistantSentCatalogRecently = recentForCatalogIntent.some((m: any) => {
        if (m.sender !== "assistant") return false;
        const t = String(m.content ?? "").toLowerCase();
        // Solo mensajes que implican envío real del catálogo interactivo — NO preguntas tipo "¿cuál finca?"
        // (la IA a veces las emite sin haber mandado tarjetas y eso rompe el flujo).
        return (
          /estas\s+son\s+las\s+fincas\s+disponibles|te\s+compart[íi]\s+el\s+cat[aá]logo|cat[aá]logo\s+con\s+las\s+opciones/.test(
            t
          ) || m.type === "whatsapp_catalog" || m.type === "catalog"
        );
      });
      const skipSingleFincaCardResend =
        (multipleCatalogAlreadySentInHistory || assistantSentCatalogRecently) &&
        catalogIntent.intent === "single_finca";
      if (skipSingleFincaCardResend) {
        console.log(
          "[single-finca-guard] Omitiendo reenvío de ficha individual — catálogo múltiple ya mostrado y usuario eligió finca:",
          (catalogIntent as any).fincaName
        );
        // NO asignar fincaTitle aquí: si lo hacemos, el bloque de resolución en BD no corre
        // (usa `!fincaTitle`) y el nombre queda en minúsculas tipo "villas privadas".
      }

      try {
        const singleFincaCandidate = parseSingleFincaRequest(currentMessageText);
        const shouldTrySingleFinca =
          catalogIntent.intent === "single_finca" ||
          !!imageIdentifiedFincaName ||
          !!singleFincaCandidate;

        if (
          !followUpData &&
          shouldTrySingleFinca &&
          !shouldBlockCatalogFincaConfirmed &&
          !skipSingleFincaCardResend
        ) {
          const result = await ctx.runAction(
            internal.ycloud.maybeSendSingleFincaCatalogForUserMessage,
            {
              phone: args.phone,
              conversationId,
              userMessage: imageIdentifiedFincaName
                ? `Quiero reservar la finca ${imageIdentifiedFincaName}`
                : currentMessageText,
              wamid: args.wamid,
              extractedFincaName:
                catalogIntent.intent === "single_finca"
                  ? catalogIntent.fincaName
                  : undefined,
            }
          );
          if (result && result.sent && result.fincaTitle) {
            singleFincaSent = true;
            fincaTitle = result.fincaTitle;
            confirmedFincaTitle = result.fincaTitle;
          }
        }
      } catch (e) {
        console.error("YCloud single-finca catalog error:", e);
      }

      try {
        if (
          !singleFincaSent &&
          !shouldBlockCatalogByContractFlow &&
          !shouldBlockCatalogFincaConfirmed &&
          !skipSingleFincaCardResend
        ) {
          // Nuevo criterio comercial: mascotas es un dato importante, pero no debe
          // bloquear el avance del catálogo si ya tenemos personas + fechas.
          console.log("[catalog-intent]", JSON.stringify(catalogIntent));
          const catalogIntentArg =
            catalogIntent.intent === "more_options"
              ? catalogIntent
              : catalogIntent.intent === "search_catalog" && 
                catalogIntent.location &&
                catalogIntent.location.length >= 3 &&
                !isInvalidCatalogLocation(catalogIntent.location)
                ? catalogIntent
                : undefined;
          if (!catalogIntentArg && catalogIntent.intent === "search_catalog") {
            console.warn("[catalog-guard] intent search_catalog descartado — ubicación inválida o muy corta:", (catalogIntent as any).location);
          }
          const catalogRes = await ctx.runAction(
            internal.ycloud.maybeSendCatalogForUserMessage,
            {
              conversationId,
              phone: args.phone,
              userMessage: currentMessageText,
              wamid: args.wamid,
              catalogIntent: catalogIntentArg,
            }
          );
          if (catalogRes?.puenteMinNightsNoticeSent || catalogRes?.petsQuestionSent) {
            await ctx.runMutation(internal.conversations.updateLastMessageAt, {
              conversationId,
            });
            return;
          }
          whatsappCatalogSentForSearch = catalogRes?.sent ?? false;
          catalogLocation = catalogRes?.location ?? "";
          catalogFincasCount = catalogRes?.fincasCount ?? 0;
          if (!whatsappCatalogSentForSearch && catalogRes?.fincasFoundButNoCatalog) {
            catalogFoundFincasButFailed = true;
            catalogLocation = catalogRes.location ?? "";
            catalogFincasCount = catalogRes.fincasCount ?? 0;
          }
          if (!whatsappCatalogSentForSearch && !catalogFoundFincasButFailed) {
            console.log("[catalog-debug] catálogo NO enviado y NO fallback.", {
              intentArg: catalogIntentArg ? catalogIntentArg.intent : "none/undefined",
              resLocation: catalogRes?.location,
              resFincasCount: catalogRes?.fincasCount,
            });
          }
        } else if (shouldBlockCatalogByContractFlow) {
          console.log("[catalog-debug] catálogo bloqueado por flujo de contrato");
        }
      } catch (e) {
        console.error("YCloud catalog send error:", e);
      }

      if (whatsappCatalogSentForSearch) {
        await ctx.runMutation(internal.conversations.updateLastMessageAt, {
          conversationId,
        });
        return;
      }

      // FALLBACK: si el catálogo NO se envió pero el usuario menciona una ciudad conocida,
      // forzar el envío del catálogo con esa ciudad usando fechas del próximo fin de semana.
      // IMPORTANTE: no aplicar este fallback cuando el usuario pidió una finca específica,
      // para no reemplazar la intención "single_finca" por un catálogo general de ciudad.
      if (
        !whatsappCatalogSentForSearch &&
        !singleFincaSent &&
        catalogIntent.intent !== "single_finca" &&
        !shouldBlockCatalogByContractFlow &&
        !shouldBlockCatalogFincaConfirmed
      ) {
        const msgLower_pre = currentMessageText.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
        const matchedCity = dynamicLocationsList.find(
          (loc: string) => msgLower_pre.includes(loc.toLowerCase().normalize("NFD").replace(/\p{M}/gu, ""))
        );
        if (matchedCity) {
          console.log("[catalog-fallback] Ciudad detectada sin catálogo, forzando envío:", matchedCity);
          const _fbMsgLower = currentMessageText.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
          const _fbPersonasMatch = _fbMsgLower.match(/(\d+)\s*(?:o\s+mas?\s+)?personas/i);
          // Buscar mascotas en todo el historial del usuario, no solo el mensaje actual
          const _fbAllUserText = [
            currentMessageText,
            ...recentForCatalogIntent
              .filter((m: any) => m.sender === "user")
              .map((m: any) => String(m.content ?? "")),
          ].join("\n");
          const _fbKnownPets = extractKnownReservationData(_fbAllUserText, {
            assistantAskedPets: recentForCatalogIntent.some(
              (m: any) =>
                m.sender === "assistant" &&
                /\bmascotas?|perros?|gatos?\b/i.test(String(m.content ?? "")),
            ),
            catalogLocationKeywords: dynamicLocationsList,
          });
          const _fbHasPets = _fbKnownPets.hasPetsAnswer
            ? (_fbKnownPets.petsLabel !== "no" ? true : false)
            : undefined;
          const _fbCapacity = _fbPersonasMatch ? parseInt(_fbPersonasMatch[1], 10) : undefined;
          try {
            const catalogRes = await ctx.runAction(
              internal.ycloud.maybeSendCatalogForUserMessage,
              {
                conversationId,
                phone: args.phone,
                userMessage: currentMessageText,
                wamid: args.wamid,
                catalogIntent: {
                  intent: "search_catalog" as const,
                  location: matchedCity,
                  hasWeekend: true,
                  minCapacity: _fbCapacity,
                  hasPets: _fbHasPets || undefined,
                },
              }
            );
            if (catalogRes?.puenteMinNightsNoticeSent || catalogRes?.petsQuestionSent) {
              await ctx.runMutation(internal.conversations.updateLastMessageAt, {
                conversationId,
              });
              return;
            }
            whatsappCatalogSentForSearch = catalogRes?.sent ?? false;
            catalogLocation = catalogRes?.location ?? matchedCity;
            catalogFincasCount = catalogRes?.fincasCount ?? 0;
            if (!whatsappCatalogSentForSearch && catalogRes?.fincasFoundButNoCatalog) {
              catalogFoundFincasButFailed = true;
            }
          } catch (e) {
            console.error("YCloud catalog fallback error:", e);
          }
        }
      }

      if (whatsappCatalogSentForSearch) {
        await ctx.runMutation(internal.conversations.updateLastMessageAt, {
          conversationId,
        });
        return;
      }

      const petCountMentions = (() => {
        const text = normalizedAllUserTextForFilters;
        const numericMatch =
          text.match(/(\d+)\s*(?:mascotas?|perros?)/i) ||
          text.match(/(?:mascotas?|perros?)\s*[:\-]?\s*(\d+)/i);
        if (numericMatch?.[1]) return Number(numericMatch[1]);
        if (/\b(tres)\s+(?:mascotas?|perros?)\b/i.test(text)) return 3;
        if (/\b(cuatro)\s+(?:mascotas?|perros?)\b/i.test(text)) return 4;
        if (/\b(cinco)\s+(?:mascotas?|perros?)\b/i.test(text)) return 5;
        return 0;
      })();
      const hasSelectedSpecificFinca =
        !!(
          fincaTitle ||
          confirmedFincaTitle ||
          confirmedFincaInHistoryTitle ||
          selectedCatalogPropertyTitle ||
          catalogIntent.intent === "single_finca"
        );
      const shouldEscalateByPetPolicy =
        petCountMentions > 2 &&
        hasSelectedSpecificFinca &&
        !userExplicitlyWantsOtherOptions;
      if (shouldEscalateByPetPolicy) {
        const petPolicyText =
          "Perfecto ✨ Ya con la finca de tu interés identificada, este caso por política de mascotas debe validarlo un asesor porque viajarían con más de 2 perros 🐾. Te comunico con nuestro equipo para confirmarte esta opción.";
        await ctx.runMutation(internal.messages.insertAssistantMessage, {
          conversationId,
          content: petPolicyText,
          createdAt: Date.now(),
        });
        await ctx.runAction(internal.ycloud.sendWhatsAppMessage, {
          to: args.phone,
          text: petPolicyText,
          wamid: args.wamid,
        });
        await ctx.runMutation(internal.conversations.escalate, {
          conversationId,
          operationalState: "requires_advisor",
          assignedUserId: botEscalateAssignedUserId(),
        });
        await ctx.runMutation(internal.conversations.updateLastMessageAt, {
          conversationId,
        });
        return;
      }

      // Plantillas: no pisar el flujo cuando ya mandamos catálogo interactivo, el cliente pide finca específica, o envía datos.
      let quickReplySent = false;
      let templateSent = false;
      const isProvidingData = /\d{7,}/.test(currentMessageText) || /@\w+\.\w+/.test(currentMessageText);
      const isSpecificFinca = singleFincaSent || catalogIntent.intent === "single_finca";
      
      // Detectar si el usuario menciona una ubicación o datos de reserva (no enviar template genérica)
      const msgLower = currentMessageText.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
      const mentionsCityOrFinca = dynamicLocationsList.some((loc: string) =>
        normalizedAllUserTextForFilters.includes(
          loc.toLowerCase().normalize("NFD").replace(/\p{M}/gu, ""),
        ),
      );
      const mentionsDatesOrPersonas = /\b(\d{1,2}\s*(al|hasta)\s*\d{1,2}|personas?|fin de semana)\b/i.test(currentMessageText);
      // También detectar intención de reserva con ubicación: "finca en X", "reservar en X"
      const mentionsBookingIntent = /\b(reservar|alquilar|arrendar|finca\s+en|fincas\s+en|fincas\s+de|finca\s+de|finca\s+para)\b/i.test(currentMessageText);
      const hasBookingContext = mentionsCityOrFinca || mentionsDatesOrPersonas || mentionsBookingIntent || !!selectedCatalogPropertyTitle;
      const normalizedCurrentText = msgLower.trim();
      const isShortBookingFollowUp =
        /^(amigos|familia|empresarial|empresa|si|sí|confirmo|ok|dale|listo)$/i.test(
          normalizedCurrentText
        );
      const hasActiveReservationContext = recentForCatalogIntent.some((m: any) => {
        if (m.sender !== "assistant") return false;
        const t = String(m.content ?? "").toLowerCase();
        return /\b(cotiz|disponibil|finca|cat[aá]logo|entrada|salida|personas?|mascotas?|tipo de grupo|evento)\b/.test(
          t
        );
      });
      const shouldBlockGenericTemplates =
        (hasActiveReservationContext && isShortBookingFollowUp) ||
        !!selectedCatalogPropertyTitle;
      
      console.log("[template-guard]", {
        mentionsCityOrFinca,
        mentionsDatesOrPersonas,
        mentionsBookingIntent,
        hasBookingContext,
        hasActiveReservationContext,
        isShortBookingFollowUp,
        selectedCatalogPropertyTitle,
        shouldBlockGenericTemplates,
        whatsappCatalogSentForSearch,
        isSpecificFinca,
        willBlockTemplate:
          whatsappCatalogSentForSearch ||
          isSpecificFinca ||
          isProvidingData ||
          hasBookingContext ||
          shouldBlockGenericTemplates,
      });
      
      if (
        isQuickReplyDbRoutingEnabled() &&
        !whatsappCatalogSentForSearch &&
        !isSpecificFinca &&
        !hasBookingContext &&
        !hasActiveReservationContext &&
        !shouldBlockGenericTemplates
      ) {
        try {
          const quickReply = await ctx.runAction(
            internal.ycloud.maybeSendQuickReplyTemplateByIntent,
            {
              phone: args.phone,
              wamid: args.wamid,
              conversationId,
              userMessage: currentMessageText,
              isReactivated: isReactivated ?? false,
            }
          );
          quickReplySent = quickReply?.sent ?? false;
        } catch (e) {
          console.error("YCloud maybeSendQuickReplyTemplateByIntent error:", e);
        }
      }

      if (
        isAutomaticTemplateRoutingEnabled() &&
        !quickReplySent &&
        !whatsappCatalogSentForSearch &&
        !isSpecificFinca &&
        !isProvidingData &&
        !hasBookingContext &&
        !hasActiveReservationContext &&
        !shouldBlockGenericTemplates
      ) {
        try {
          const routed = await ctx.runAction(
            internal.ycloud.maybeSendWhatsappTemplateReply,
            {
              phone: args.phone,
              wamid: args.wamid,
              conversationId,
              userMessage: currentMessageText,
            }
          );
          templateSent = routed?.sent ?? false;
        } catch (e) {
          console.error("YCloud maybeSendWhatsappTemplateReply error:", e);
        }
      }

      if (
        (await shouldAbortIfNotLatestUser("before_generate_reply")) ||
        (await shouldAbortIfAssistantAlreadyReplied("before_generate_reply"))
      ) {
        return;
      }

      if (quickReplySent || templateSent) {
        await ctx.runMutation(internal.conversations.updateLastMessageAt, {
          conversationId,
        });
        return;
      }

      // Generar respuesta de texto: si ya enviamos la ficha de una finca, que sea corta y no pida fechas.
      const searchOverride =
        catalogIntent.intent === "single_finca"
          ? catalogIntent.fincaName
          : singleFincaSent && fincaTitle
            ? fincaTitle
            : undefined;
      // Reutilizar dynamicLocationsList ya declarado arriba (template-guard)
      const dynamicLocations = dynamicLocationsList.join(", ");

      // Extraer datos ya conocidos para que el prompt no los vuelva a pedir
      const _allUserTextsEarly = [
        currentMessageText,
        ...recentForCatalogIntent.filter((m: any) => m.sender === "user").map((m: any) => String(m.content ?? "")),
      ].join("\n");
      const _assistantAskedPetsEarly = recentForCatalogIntent.some(
        (m: any) =>
          m.sender === "assistant" &&
          /\bmascotas?|perros?|gatos?\b/i.test(String(m.content ?? ""))
      );
      const knownReservationData = extractKnownReservationData(_allUserTextsEarly, {
        assistantAskedPets: _assistantAskedPetsEarly,
        currentMessage: currentMessageText,
        catalogLocationKeywords: dynamicLocationsList,
      });
      const knownDataSummary = formatKnownReservationDataSummary(knownReservationData);
      const hasKnownDates = knownReservationData.hasDates;

      // Si saltamos el reenvío de ficha, resolver el nombre oficial en BD para la IA y el contexto.
      if (skipSingleFincaCardResend) {
        const rawName = (catalogIntent as any).fincaName as string | undefined;
        if (rawName) {
          try {
            const hits = (await ctx.runQuery(api.fincas.search, { query: rawName, limit: 8 })) as any[];
            const rawLower = rawName.toLowerCase().trim();
            let match = hits.find((f: any) =>
              String(f.title || "").toLowerCase().includes(rawLower)
            );
            if (!match && hits.length > 0) {
              const tokens = rawLower.split(/\s+/).filter((w) => w.length > 2);
              match =
                hits.find((f: any) => {
                  const t = String(f.title || "").toLowerCase();
                  return tokens.length > 0 && tokens.every((tok) => t.includes(tok));
                }) ?? hits[0];
            }
            if (match?.title) {
              confirmedFincaTitle = match.title;
              fincaTitle = match.title;
            } else {
              confirmedFincaTitle = rawName;
              fincaTitle = rawName;
            }
          } catch {
            confirmedFincaTitle = rawName;
            fincaTitle = rawName;
          }
        }
        console.log("[single-finca-guard] ficha bloqueada, nombre para IA:", fincaTitle);
      }

      // CRM: nombre descriptivo tipo lead cuando ya hay finca + número de personas (no durante PASO 4+ ni si ya es cliente).
      if (
        knownReservationData.hasCapacity &&
        knownReservationData.capacity != null &&
        !clientDeliveredPersonalData &&
        !contractPromptInHistory
      ) {
        const resolvedFincaForLead = [
          fincaTitle,
          confirmedFincaTitle,
          confirmedFincaInHistoryTitle,
          selectedCatalogPropertyTitle,
        ].find(
          (t) =>
            t &&
            String(t).trim().length > 0 &&
            String(t).trim() !== "finca seleccionada"
        );
        if (resolvedFincaForLead) {
          const catalogLocHint =
            catalogLocation ||
            (catalogIntent.intent === "search_catalog"
              ? catalogIntent.location
              : undefined);
          await ctx.runMutation(internal.ycloud.syncLeadDisplayFromBotContext, {
            contactId,
            whatsappDisplayName: args.name,
            fincaTitle: String(resolvedFincaForLead).trim(),
            capacity: knownReservationData.capacity!,
            locationHint: catalogLocHint,
          });
        }
      }

      const previousCatalogPropertyIds = Array.isArray((conv as any).lastSentCatalogPropertyIds)
        ? ((conv as any).lastSentCatalogPropertyIds as unknown[])
        : [];
      // Solo confiar en IDs persistidos + mensajes `product` del sistema. Un texto de la IA
      // que diga "ya te compartí" NO implica que el catálogo interactivo se envió (evita bucles).
      const previousCatalogShown =
        previousCatalogPropertyIds.length > 0 &&
        recentForCatalogIntent.some(
          (m: any) =>
            m.sender === "assistant" &&
            (m.type === "product" || m.type === "catalog" || /^cat[aá]logo\s+enviado:/i.test(String(m.content ?? ""))),
        );
      const effectiveWhatsappCatalogShown =
        whatsappCatalogSentForSearch ||
        (previousCatalogShown && catalogIntent.intent !== "search_catalog");
      const effectiveCatalogLocation =
        catalogLocation ||
        (typeof (conv as any).lastCatalogSearch?.location === "string"
          ? (conv as any).lastCatalogSearch.location
          : "");
      const effectiveCatalogFincasCount =
        catalogFincasCount || previousCatalogPropertyIds.length || undefined;

      // Guard crítico: si el cliente ya eligió una finca concreta y aún no confirma mascotas,
      // NO cotizar todavía. Primero preguntar mascotas para validar si la finca aplica.
      // No usar skipSingleFincaCardResend solo: puede quedar true por mensajes previos mal detectados.
      const hasConcreteFincaSelection = !!(
        shouldBlockCatalogFincaConfirmed ||
        selectedCatalogPropertyTitle ||
        fincaTitle ||
        confirmedFincaTitle ||
        confirmedFincaInHistoryTitle
      );
      if (hasConcreteFincaSelection && !knownReservationData.hasPetsAnswer) {
        const promptOverrideForPetsOnSelection = await ctx.runQuery(api.internalPages.getById, {
          pageId: PROMPT_INTERNAL_PAGE_ID,
        });
        const promptOverridePetsOnSelectionText =
          promptOverrideForPetsOnSelection &&
          typeof promptOverrideForPetsOnSelection === "object" &&
          "prompt" in promptOverrideForPetsOnSelection &&
          typeof (promptOverrideForPetsOnSelection as { prompt?: unknown }).prompt === "string"
            ? (promptOverrideForPetsOnSelection as { prompt: string }).prompt.trim()
            : "";
        const effectivePromptForPetsOnSelection =
          promptOverridePetsOnSelectionText.length > 0
            ? promptOverridePetsOnSelectionText
            : DEFAULT_CONSULTANT_SYSTEM_PROMPT;
        const petsBeforeQuoteMsg =
          extractQuickReplyBlock(effectivePromptForPetsOnSelection, "mascotas finca seleccionada") ||
          "Perfecto 👌 Antes de confirmar la cotización, ¿van a llevar mascotas? 🐾\n\n" +
            "Si la respuesta es sí, dime cuántas para validar que esta finca aplique y calcular los cargos correspondientes.";
        await ctx.runMutation(internal.messages.insertAssistantMessage, {
          conversationId,
          content: petsBeforeQuoteMsg,
          createdAt: Date.now(),
        });
        await ctx.runAction(internal.ycloud.sendWhatsAppMessage, {
          to: args.phone,
          text: petsBeforeQuoteMsg,
          wamid: args.wamid,
        });
        await ctx.runMutation(internal.conversations.updateLastMessageAt, {
          conversationId,
        });
        return;
      }

      // La IA siempre genera la respuesta; lo que cambia es el contexto que recibe.
      let replyText = await ctx.runAction(
        internal.ycloud.generateReplyWithRagAndFincas,
        {
          conversationId,
          userMessage: currentMessageText,
          singleFincaCatalogSent: singleFincaSent,
          fincaTitle: fincaTitle || confirmedFincaInHistoryTitle,
          searchQueryOverride: searchOverride,
          whatsappCatalogSentForSearch: effectiveWhatsappCatalogShown,
          dynamicLocations,
          catalogLocation: effectiveCatalogLocation,
          catalogFincasCount: effectiveCatalogFincasCount,
          catalogFoundFincasButFailed,
          hasKnownWeekend: hasKnownDates,
          hasKnownCapacity: knownReservationData.hasCapacity,
          hasKnownGroup: knownReservationData.hasGroup,
          hasKnownPetsAnswer: knownReservationData.hasPetsAnswer,
          hasKnownLocation: knownReservationData.hasLocation,
          knownDataSummary: knownDataSummary || undefined,
          fincaAlreadyConfirmed:
            shouldBlockCatalogFincaConfirmed ||
            !!selectedCatalogPropertyTitle ||
            skipSingleFincaCardResend,
          confirmedFincaName:
            fincaTitle ||
            confirmedFincaInHistoryTitle ||
            selectedCatalogPropertyTitle ||
            (skipSingleFincaCardResend ? ((catalogIntent as any).fincaName as string | undefined) : undefined),
          clientDeliveredPersonalData,
          contractDataBlob: clientDeliveredPersonalData ? contractDataBlob : undefined,
          imageUrl: args.type === "image" && args.mediaUrl ? args.mediaUrl : undefined,
          isReactivated: isReactivated ?? false,
        }
      );

      if (
        replyText &&
        !effectiveWhatsappCatalogShown &&
        !singleFincaSent &&
        /\b(ya\s+te\s+compart[ií]|compart[ií]\s+(?:el\s+)?(?:cat[aá]logo|algunas\s+opciones)|ya\s+envi[eé]\s+(?:el\s+)?cat[aá]logo|revisa\s+(?:las\s+)?fichas|deber[ií]as\s+ver\s+(?:enseguida\s+)?(?:las\s+)?tarjetas)/i.test(
          replyText
        )
      ) {
        console.warn(
          "[catalog-hallucination-guard] Eliminadas afirmaciones de catálogo/tarjetas sin envío real en este turno.",
        );
        replyText = replyText
          .replace(
            /\s*(?:ya\s+te\s+compart[ií]|compart[ií]\s+(?:el\s+)?(?:cat[aá]logo|algunas\s+opciones)|ya\s+envi[eé]\s+(?:el\s+)?cat[aá]logo|revisa\s+(?:las\s+)?fichas|deber[ií]as\s+ver\s+(?:enseguida\s+)?(?:las\s+)?tarjetas)[^.!?\n]*(?:[.!?]|$)/gi,
            " ",
          )
          .replace(/\s{2,}/g, " ")
          .trim();
        if (!replyText) {
          replyText =
            "Gracias por el dato. Sigo con tu solicitud según las fechas y el destino que indicaste; si necesitas ver opciones en catálogo, escribe *catálogo* y lo gestiono.";
        }
      }

      // No repetir "¿en qué ciudad/municipio?" si el destino ya consta en el hilo (ej. Melgar + seguimiento solo fechas/grupo).
      if (
        replyText &&
        knownReservationData.hasLocation &&
        /\b(?:en qu[eé]\s+(?:ciudad|municipio)|ciudad o municipio|municipio te gustar[ií]a|destino exacto)\b/i.test(
          replyText,
        )
      ) {
        const rawLoc = knownReservationData.locationLabel?.trim() || "";
        const destPretty =
          rawLoc.length > 0
            ? rawLoc.replace(/(^|\s)\p{L}/gu, (ch) => ch.toUpperCase())
            : "el destino que ya me indicaste";
        replyText = replyText
          .split(/\n+/)
          .filter(
            (line) =>
              !/\b(?:en qu[eé]\s+(?:ciudad|municipio)|ciudad o municipio|municipio te gustar[ií]a|destino exacto)\b/i.test(
                line,
              ),
          )
          .join("\n\n")
          .trim();
        if (replyText.length < 24) {
          replyText = `Perfecto — sigo con ${destPretty} y lo demás que me compartiste. ¿Cuántas personas serían en total? 👥`;
        }
      }

      let escalateFromAssistantStatusTag = false;

      // Guard anti-loop: si el cliente ya entregó datos y la IA intenta reenviar la plantilla del PASO 4,
      // forzamos el mensaje de cierre del PASO 5. Evita loops "Para elaborar tu contrato..." repetidos.
      if (replyText && clientDeliveredPersonalData) {
        const looksLikePaso4Template =
          /para\s+elaborar\s+tu\s+contrato\s+de\s+arrendamiento/i.test(replyText) &&
          /✅\s*nombre\s+completo/i.test(replyText) &&
          /documento\s+de\s+identidad/i.test(replyText);
        if (looksLikePaso4Template) {
          console.warn(
            "[paso5-guard] La IA intentó repetir la plantilla del PASO 4 — reemplazando por cierre del PASO 5."
          );
          const fincaName =
            fincaTitle ||
            confirmedFincaInHistoryTitle ||
            selectedCatalogPropertyTitle ||
            "la finca seleccionada";
          // Primera línea: intentar saludar por el nombre detectado en los datos.
          const nameMatch =
            contractDataBlob.match(
              /\b([A-ZÁÉÍÓÚÑa-záéíóúñ]{3,}(?:\s+[A-ZÁÉÍÓÚÑa-záéíóúñ]{3,}){1,3})\b/
            );
          const firstName = nameMatch ? nameMatch[1].split(/\s+/)[0] : "";
          const greeting = firstName
            ? `¡Perfecto, ${firstName}!`
            : "¡Perfecto!";
          replyText = `${greeting} Confirmo que recibí todos tus datos para la reserva en ${fincaName}. ✨

👨‍💻 Proceso de reserva:

1. Documentación: Te enviamos el contrato y nuestro respaldo legal para tu revisión 📄.
2. Reserva: Realizas el abono del 50% del valor total para separar la fecha 💰.
3. Confirmación: Validamos tu pago y recibes el soporte oficial junto a la ubicación de la finca ✅.

❗Nuestro RNT es 163658, disponible para consulta y verificación.

En FincasYa.com tu alquiler siempre es seguro, respaldado y con total tranquilidad. ®`;
        }

        await ctx.runMutation(internal.conversations.escalate, {
          conversationId,
          operationalState: "requires_advisor",
          assignedUserId: botEscalateAssignedUserId(),
        });
      }

      // Guardrail de cierre: no anunciar contrato si el usuario no esta en flujo real de reserva.
      if (replyText) {
        const replyMentionsContractAdvance =
          /\b(en\s+breve|pronto).*(contrato)|compartir(?:emos)?\s+el\s+contrato|enviar(?:emos)?\s+el\s+contrato|formalizar\s+la\s+reserva|elaborar\s+tu\s+contrato\b/i.test(
            replyText
          );
        const userExplicitContractIntent =
          /\b(contrato|reservar|reserva|procede|proceder|adelante|confirmo|continuar)\b/i.test(
            currentMessageText
          );
        const assistantAskedToAdvanceReservation = recentForCatalogIntent.some((m: any) => {
          if (m.sender !== "assistant") return false;
          const t = String(m.content ?? "").toLowerCase();
          return (
            /te gustaria avanzar con la reserva|te gustaría avanzar con la reserva|deseas continuar|avancemos con la reserva|confirmar la reserva|deseas que proceda|proceda con la reserva|asegurar tus fechas|quieres reservarla|quiero reservarla/.test(
              t
            )
          );
        });
        // Cierre de reserva: el asistente pidió confirmación explícita o avanzó a datos; "sí" debe permitir el contrato.
        const assistantAskedReservationOrDataStep = recentForCatalogIntent.some((m: any) => {
          if (m.sender !== "assistant") return false;
          const t = String(m.content ?? "").toLowerCase();
          return (
            /confirmas?\s+(la\s+)?reserva|¿\s*confirmas|la\s+confirmamos|avanzamos\s+con|excelente\s+elecci[oó]n|formalizar(la)?\s+reserva|necesito\s+(tus\s+)?datos|nombre\s+completo|documento\s+de\s+identidad|c[eé]dula|¿\s*procedemos|listo.*reserv/.test(
              t
            )
          );
        });
        const userIsAffirmingAfterReservationPrompt =
          isAffirmativeOnly(currentMessageText) && assistantAskedToAdvanceReservation;
        const userIsAffirmingAfterCloseStep =
          isAffirmativeOnly(currentMessageText) && assistantAskedReservationOrDataStep;
        const canTalkAboutContractNow =
          userExplicitContractIntent ||
          currentLooksLikeContractData ||
          assistantAskedToAdvanceReservation ||
          userIsAffirmingAfterReservationPrompt ||
          userIsAffirmingAfterCloseStep;

        if (replyMentionsContractAdvance && !canTalkAboutContractNow) {
          console.warn(
            "[contract-guard] bloqueada respuesta de contrato fuera de flujo",
            {
              userMessage: currentMessageText.slice(0, 200),
              replyPreview: replyText.slice(0, 200),
            }
          );
          replyText =
            "Con mucho gusto te ayudo. Para avanzar correctamente, compárteme por favor ciudad o finca, fechas de entrada y salida, y número de personas. 🏡📅";
        }

        const beforeStep1Strip = replyText;
        const isMidConversation = recentForCatalogIntent.some(
          (m: any) => m.sender === "user" || m.sender === "assistant",
        );
        replyText = stripConsultantMidFlowStep1Opening(
          replyText,
          knownReservationData,
          isMidConversation,
        );
        if (replyText !== beforeStep1Strip) {
          console.warn(
            "[prompt-strip] Eliminado saludo literal del paso 1 pegado a mitad de embudo (ya hay datos de reserva).",
          );
        }

        const beforeBoilerStrip = replyText;
        replyText = stripPreCatalogFunnelBoilerplate(replyText);
        if (replyText !== beforeBoilerStrip) {
          console.warn("[prompt-strip] Eliminados párrafos de embudo pre-catálogo (16–17).");
        }

        const beforeGeoPickerStrip = replyText;
        replyText = stripGeographicPickerWhenLocationKnown(replyText, knownReservationData);
        if (replyText !== beforeGeoPickerStrip) {
          console.warn(
            "[prompt-strip] Eliminado listado de municipios / «¿en dónde empezar?» — destino ya está en el hilo.",
          );
        }

        const beforeNarrow = replyText;
        replyText = narrowEmbudoReplyToSingleQuestion(replyText);
        if (replyText !== beforeNarrow) {
          console.warn("[prompt-strip] Recortado a pregunta única de embudo (personas / evento).");
        }

        const beforeCapEmoji = replyText;
        replyText = ensureCapacityQuestionEmojiPrefix(replyText);
        if (replyText !== beforeCapEmoji) {
          console.warn("[prompt-strip] Añadido prefijo 🏡 a pregunta de cupo.");
        }

        const beforeQuoteRepair = replyText;
        replyText = repairExcelenteEleccionPlaceholders(
          replyText,
          knownReservationData,
          fincaTitle ||
            confirmedFincaTitle ||
            confirmedFincaInHistoryTitle ||
            selectedCatalogPropertyTitle,
        );
        if (replyText !== beforeQuoteRepair) {
          console.warn("[prompt-strip] Cotización: sustituido encabezado con placeholders por datos del hilo.");
        }

        // Si el cliente ya dio datos clave (fechas/personas/grupo/mascota) y la IA pregunta
        // "¿Deseas que solicite...?", saltamos esa confirmación y avanzamos directo a contrato/pago.
        const asksPermissionToRequestContractData =
          /deseas\s+que\s+solicite\s+ahora\s+los\s+datos\s+para\s+el\s+contrato/i.test(
            replyText
          );
        const hasReservationSummarySignals =
          /\b(confirmo|s[aá]bado|domingo|lunes|martes|mi[eé]rcoles|jueves|viernes|personas?|grupo|mascota|noches?)\b/i.test(
            currentMessageText
          );
        // MODO PLANTILLAS: guardrails de sobreescritura desactivados.
        // La IA responde directamente usando consultantPrompt.ts.
        // Solo se aplica stripDateQuestions si la IA pide fechas que el cliente ya dio.
        const _weekendRegex = /\b(sabado|sábado|domingo|fin\s+de\s+semana|este\s+fin|proximo\s+fin|pr[oó]ximo\s+fin)\b/i;
        const hasWeekendInHistory = recentForCatalogIntent.some((m: any) =>
          m.sender === "user" && _weekendRegex.test(String(m.content ?? ""))
        );
        const asksExactDateAgain =
          /\b(fechas?\s+exactas?|fecha\s+exacta|d[ií]a\/mes\/a[nñ]o|dia\/mes\/a[nñ]o|fecha.*entrada.*salida|qu[eé]\s+fechas)\b/i.test(
            replyText
          );
        // La IA suele copiar el literal del prompt ("fecha de ingreso y ... fecha de salida") sin coincidir
        // con asksExactDateAgain; si ya parseamos fechas del historial, igual debemos quitar esa pregunta.
        const asksStayDatesLikePrompt =
          /\b(fecha\s+de\s+ingreso|fecha\s+de\s+salida|cu[aá]l\s+ser[ií]a\s+la\s+fecha|para\s+filtrar\s+disponibilidad\s+real)\b/i.test(
            replyText
          );
        if (
          knownReservationData.hasDates &&
          (asksExactDateAgain || asksStayDatesLikePrompt)
        ) {
          const cleanedDates = stripDateQuestions(replyText);
          replyText =
            cleanedDates.length >= 25
              ? cleanedDates
              : buildMissingReservationDetailsPrompt(knownReservationData);
        } else if (asksExactDateAgain && hasWeekendInHistory) {
          replyText = stripDateQuestions(replyText);
        }
        const asksGroupAgain =
          /\b(tipo\s+de\s+grupo|orientarte\s+mejor\s+con\s+el\s+filtro|plan\s+es\s+m[aá]s\s+familiar|familiar,\s*de\s+amigos|familiar,\s*amigos,\s*empresarial|pareja\s+u\s+otro)\b/i.test(
            replyText
          );
        if (asksGroupAgain && knownReservationData.hasGroup) {
          const cleanedGroup = stripGroupQuestions(replyText);
          if (cleanedGroup.length >= 20) {
            replyText = cleanedGroup;
          } else {
            // El strip deja solo "Gracias. ?" — mejor avanzar al siguiente paso del embudo.
            replyText = buildEventVsDescansoFunnelPrompt(knownReservationData);
          }
        }

        // Evita repetir "¿Cuál finca te llamó la atención?" si el asistente
        // ya lo preguntó en su último turno o si acabamos de enviar la ficha
        // individual (ya eligió la finca).
        const WHICH_FINCA_Q = /¿?\s*cu[aá]l\s+finca\s+te\s+llam[oó]\s+la\s+atenci[oó]n\s*[?]?[^\n.!]*[🏡✨✅]*\s*/gi;
        const lastAssistantMsg = [...recentForCatalogIntent].reverse().find(
          (m: any) => m.sender === "assistant"
        );
        const assistantJustAskedWhichFinca =
          !!lastAssistantMsg &&
          /cu[aá]l\s+finca\s+te\s+llam[oó]\s+la\s+atenci[oó]n/i.test(
            String(lastAssistantMsg.content ?? "")
          );
        const hasProductCardInHistory = recentForCatalogIntent.some(
          (m: any) => m.sender === "assistant" && m.type === "product"
        );
        const hasKnownSelectedFinca =
          !!(
            fincaTitle ||
            confirmedFincaInHistoryTitle ||
            selectedCatalogPropertyTitle
          );
        const alreadySentSingleFinca = !!(
          singleFincaSent ||
          isSpecificFinca ||
          hasProductCardInHistory ||
          hasKnownSelectedFinca
        );
        if (
          (assistantJustAskedWhichFinca || alreadySentSingleFinca) &&
          WHICH_FINCA_Q.test(replyText)
        ) {
          const cleaned = replyText
            .replace(WHICH_FINCA_Q, "")
            .replace(/\s{2,}/g, " ")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
          if (cleaned.length >= 20) {
            replyText = cleaned;
          } else if (hasKnownSelectedFinca) {
            replyText = buildMissingReservationDetailsPrompt(
              knownReservationData,
              fincaTitle || confirmedFincaInHistoryTitle || selectedCatalogPropertyTitle
            );
          } else if (singleFincaSent && fincaTitle) {
            replyText = buildMissingReservationDetailsPrompt(knownReservationData, fincaTitle);
          } else if (fincaTitle) {
            // Catálogo múltiple ya mostrado antes; finca elegida por nombre: primero cotizar.
            replyText = buildMissingReservationDetailsPrompt(knownReservationData, fincaTitle);
          } else {
            replyText = buildMissingReservationDetailsPrompt(knownReservationData);
          }
        }
      }

      if (replyText) {
        const st = stripAssistantStatusTags(replyText);
        replyText = st.clean;
        escalateFromAssistantStatusTag = st.requiresAdvisor;
        if (!replyText.trim() && escalateFromAssistantStatusTag) {
          replyText =
            "En un momento un asesor humano continúa contigo por este chat para ayudarte. 🤝";
        }
      }

      if (replyText) {
        if (
          (await shouldAbortIfNotLatestUser("before_send_reply")) ||
          (await shouldAbortIfAssistantAlreadyReplied("before_send_reply"))
        ) {
          return;
        }
        const pacingTarget =
          replyText.indexOf("[CONTRACT_PDF:") >= 0
            ? replyText.split("[CONTRACT_PDF:")[0]
            : replyText;
        await new Promise((resolve) =>
          setTimeout(resolve, humanReplyPacingMs(pacingTarget))
        );
        if (
          (await shouldAbortIfNotLatestUser("after_pacing_before_send")) ||
          (await shouldAbortIfAssistantAlreadyReplied("after_pacing_before_send"))
        ) {
          return;
        }
        let sentAssistantText: string | null = null;
        try {
          const tag = "[CONTRACT_PDF:";
          const idx = replyText.indexOf(tag);
          const jsonStart = idx >= 0 ? replyText.indexOf("{", idx) : -1;
          let jsonEnd = -1;
          if (jsonStart >= 0) {
            let depth = 0;
            for (let i = jsonStart; i < replyText.length; i++) {
              const c = replyText[i];
              if (c === "{") depth++;
              else if (c === "}") {
                depth--;
                if (depth === 0) {
                  jsonEnd = i + 1;
                  break;
                }
              }
            }
          }
          const jsonStr =
            jsonEnd > 0 ? replyText.slice(jsonStart, jsonEnd) : null;
          if (jsonStr) {
            try {
              const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
              // Extraer datos para el sistema (aunque no enviemos PDF automático, se escalará a humano)
              const ciudad = String(parsed.ciudad ?? "");
              const direccion = String(parsed.direccion ?? "");
              const entradaHora = String(parsed.entradaHora ?? "");
              const salidaHora = String(parsed.salidaHora ?? "");
              
              const cleanReplyText = replyText.split(tag)[0].trim();

              const PAYMENT_PROCESS_TEXT = `👨‍💻 Proceso de reserva:

1. Documentación: Te enviamos el contrato y nuestro respaldo legal para tu revisión 📄.
2. Reserva: Realizas el abono del 50% del valor total para separar la fecha 💰.
3. Confirmación: Validamos tu pago y recibes el soporte oficial junto a la ubicación de la finca ✅.

❗Nuestro RNT es 163658, disponible para consulta y verificación.

En FincasYa.com tu alquiler siempre es seguro, respaldado y con total tranquilidad. ®`;

              // Si el texto limpio ya contiene el mensaje de proceso de pago, enviarlo tal cual.
              // Si no lo contiene (la IA lo olvidó), agregar el mensaje de proceso como segundo mensaje.
              const alreadyHasPaymentInfo = cleanReplyText.includes("RNT") || cleanReplyText.includes("50%") || cleanReplyText.includes("Proceso de reserva");

              const textToSend = cleanReplyText
                ? (alreadyHasPaymentInfo
                    ? cleanReplyText
                    : `${cleanReplyText}\n\n${PAYMENT_PROCESS_TEXT}`)
                : `¡Listo! He recibido todos tus datos para la reserva. ✨\n\n${PAYMENT_PROCESS_TEXT}`;

              // Enviar el mensaje visible del asistente (sin el bloque técnico)
              await ctx.runAction(internal.ycloud.sendWhatsAppMessage, {
                to: args.phone,
                text: textToSend,
                wamid: args.wamid,
              });
              sentAssistantText = textToSend;

              // Escalar a humano (la IA ya hizo su trabajo de recolectar datos) — pendiente pago
              await ctx.runMutation(internal.conversations.escalate, {
                conversationId,
                operationalState: "pending_payment",
                assignedUserId: botEscalateAssignedUserId(),
              });

              /* 
              // DESACTIVADO: Envío automático de PDF por solicitud de QA. 
              // Se deja el código como referencia por si se requiere reactivar.
              await ctx.runAction(
                internal.contractPdf.sendContractPdfAndPaymentMethods,
                {
                  to: args.phone,
                  wamid: args.wamid,
                  contractData: {
                    finca: String(parsed.finca ?? ""),
                    ubicacion: String(parsed.ubicacion ?? ""),
                    nombre: String(parsed.nombre ?? ""),
                    cedula: String(parsed.cedula ?? ""),
                    celular: String(parsed.celular ?? ""),
                    correo: String(parsed.correo ?? ""),
                    ciudad,
                    direccion,
                    entrada: String(parsed.entrada ?? ""),
                    salida: String(parsed.salida ?? ""),
                    noches: Number(parsed.noches) || 0,
                    precioTotal: Number(parsed.precioTotal) || 0,
                  },
                  paymentMessageText:
                    paymentMessageText ||
                    "MÉTODOS DE PAGO: Abono 50% para confirmar. Saldo 50% al recibir la finca. Nequi, PSE, transferencia o datos bancarios. ✨",
                }
              );
              */
            } catch (parseErr) {
              console.error("CONTRACT_PDF parse/send error:", parseErr);
              await ctx.runAction(internal.ycloud.sendWhatsAppMessage, {
                to: args.phone,
                text: replyText,
                wamid: args.wamid,
              });
              sentAssistantText = replyText;
            }
          } else {
            await ctx.runAction(internal.ycloud.sendWhatsAppMessage, {
              to: args.phone,
              text: replyText,
              wamid: args.wamid,
            });
            sentAssistantText = replyText;
            // Escalamos a humano SOLO cuando la IA ya tiene TODOS los datos del cliente
            // y está confirmando el cierre final del contrato. Antes bastaba con que el
            // texto mencionara "Proceso de reserva" / "RNT" / "50% del valor" (escalaba
            // al pedir datos o al explicar métodos de pago). Ahora exigimos:
            //  1) Señal clara de cierre de contrato (envío de documento / validación de pago).
            //  2) Historial con datos completos del cliente (nombre + cédula + teléfono + correo o dirección).
            const closingSignals = [
              /te\s+envi(?:amos|o)\s+el\s+contrato/i,
              /enviar(?:emos|é)\s+el\s+contrato/i,
              /env[ií]o\s+el\s+contrato/i,
              /contrato\s+(?:listo|adjunto|de\s+arrendamiento\s+(?:listo|adjunto|firmado))/i,
              /valid(?:amos|aremos)\s+tu\s+pago/i,
              /soporte\s+oficial\s+de\s+pago/i,
              /confirmaci[oó]n\s+de\s+pago/i,
            ].some((re) => re.test(replyText));
            // ¿El cliente ya dio la info personal necesaria?
            const historyText = [
              ...recentForCatalogIntent.map((m: any) => String(m.content ?? "")),
              currentMessageText,
            ].join("\n");
            const hasName = /\b([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)\s+[A-ZÁÉÍÓÚÑa-záéíóúñ]+/.test(historyText);
            const hasIdNumber = /\b\d{7,12}\b/.test(historyText);
            const hasPhone = /\b3\d{9}\b/.test(historyText);
            const hasEmail = /@\S+\.\S+/.test(historyText);
            const hasAddress = /(calle|carrera|cra\.?|cl\.?|avenida|av\.?|mz|manzana|barrio)\s*[\w\d]/i.test(historyText);
            const personalDataScore =
              (hasName ? 1 : 0) +
              (hasIdNumber ? 1 : 0) +
              (hasPhone ? 1 : 0) +
              ((hasEmail || hasAddress) ? 1 : 0);
            const hasFullClientData = personalDataScore >= 3;
            if (closingSignals && hasFullClientData) {
              console.log("[escalate] Cierre de contrato detectado con datos completos → humano");
              await ctx.runMutation(internal.conversations.escalate, {
                conversationId,
                operationalState: "ready_to_book",
                assignedUserId: botEscalateAssignedUserId(),
              });
            } else if (closingSignals && !hasFullClientData) {
              console.log("[escalate] Se detectó cierre pero faltan datos del cliente — NO escalar aún");
            }
          }
        } catch (e) {
          console.error("YCloud send error:", e);
        }
        if (sentAssistantText) {
          await ctx.runMutation(internal.messages.insertAssistantMessage, {
            conversationId,
            content: sentAssistantText,
            createdAt: Date.now(),
          });
          // Si el modelo incluyó [STATUS:requiere_asesor] o prometió handoff a humano → modo humano.
          if (
            escalateFromAssistantStatusTag ||
            assistantPromisesHumanHandoff(sentAssistantText)
          ) {
            const convAfterSend = await ctx.runQuery(api.conversations.getById, {
              conversationId,
            });
            if (convAfterSend?.status === "ai") {
              console.log(
                escalateFromAssistantStatusTag
                  ? "[escalate] Tag [STATUS:requiere_asesor] en respuesta → escalando"
                  : "[escalate] Respuesta del asistente promete handoff a humano → escalando",
              );
              await ctx.runMutation(internal.conversations.escalate, {
                conversationId,
                operationalState: "requires_advisor",
                assignedUserId: botEscalateAssignedUserId(),
              });
            }
          }
        }
      }
    }

    await ctx.runMutation(internal.conversations.updateLastMessageAt, {
      conversationId,
    });
  },
});

/**
 * Generar respuesta usando RAG (base de conocimiento) y datos de fincas.
 * Si singleFincaCatalogSent es true, la respuesta debe ser corta y no pedir fechas (ya se envió la ficha).
 */
export const generateReplyWithRagAndFincas = internalAction({
  args: {
    conversationId: v.id("conversations"),
    userMessage: v.string(),
    singleFincaCatalogSent: v.optional(v.boolean()),
    fincaTitle: v.optional(v.string()),
    /** Si el usuario pidió ver una finca por nombre, buscar por ese nombre para que el contexto tenga la finca correcta. */
    searchQueryOverride: v.optional(v.string()),
    /**
     * True si ya se envió el mensaje interactivo de catálogo WhatsApp (product_list / product).
     * No repetir lista de fincas ni precios en texto.
     */
    whatsappCatalogSentForSearch: v.optional(v.boolean()),
    /** Lista de ubicaciones separadas por coma para el prompt. */
    dynamicLocations: v.optional(v.string()),
    /** Ciudad/municipio del catálogo enviado. */
    catalogLocation: v.optional(v.string()),
    /** Número de fincas enviadas en el catálogo. */
    catalogFincasCount: v.optional(v.number()),
    /** True si se encontraron fincas pero no se pudo enviar el catálogo (sin productRetailerIds). En este caso el AI puede listar las fincas en texto. */
    catalogFoundFincasButFailed: v.optional(v.boolean()),
    /** True si el usuario ya mencionó "sábado y domingo" / "fin de semana" en la conversación — no volver a pedir fechas. */
    hasKnownWeekend: v.optional(v.boolean()),
    /** True si el usuario ya dio número de personas. */
    hasKnownCapacity: v.optional(v.boolean()),
    /** True si el usuario ya dijo tipo de grupo/plan. */
    hasKnownGroup: v.optional(v.boolean()),
    /** True si el usuario ya respondió si viaja con mascotas o no. */
    hasKnownPetsAnswer: v.optional(v.boolean()),
    /** True si el hilo ya menciona un municipio/destino de la lista (ej. Melgar en un mensaje anterior). */
    hasKnownLocation: v.optional(v.boolean()),
    /** Resumen de datos ya conocidos del cliente (fechas, personas, grupo, mascotas) para omitirlos en el prompt. */
    knownDataSummary: v.optional(v.string()),
    /** True si el cliente ya eligió y confirmó una finca específica → la IA debe avanzar al flujo de reserva, no al catálogo. */
    fincaAlreadyConfirmed: v.optional(v.boolean()),
    /** Nombre de la finca ya confirmada, para que la IA pueda referenciarla correctamente. */
    confirmedFincaName: v.optional(v.string()),
    /** True si el cliente ya entregó sus datos personales (nombre, cédula, etc.) — está en PASO 5, no PASO 4. */
    clientDeliveredPersonalData: v.optional(v.boolean()),
    /** Concat de los mensajes recientes del cliente con los datos personales, para que la IA pueda citarlos. */
    contractDataBlob: v.optional(v.string()),
    /** URL de la imagen enviada por el usuario (para análisis visual). */
    imageUrl: v.optional(v.string()),
    /** True si el cliente regresó después de una conversación previa (dentro de la ventana de reactivación). No saludar desde cero. */
    isReactivated: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<string> => {
    const promptOverride = await ctx.runQuery(api.internalPages.getById, {
      pageId: PROMPT_INTERNAL_PAGE_ID,
    });
    const promptOverrideText =
      promptOverride &&
      typeof promptOverride === "object" &&
      "prompt" in promptOverride &&
      typeof (promptOverride as { prompt?: unknown }).prompt === "string"
        ? (promptOverride as { prompt: string }).prompt.trim()
        : "";
    const effectiveBasePrompt =
      promptOverrideText.length > 0
        ? promptOverrideText
        : DEFAULT_CONSULTANT_SYSTEM_PROMPT;

    const ragResult = await rag.search(ctx, {
      namespace: "fincas",
      query: args.searchQueryOverride ?? args.userMessage,
      limit: 5,
    });

    const searchQuery = (args.searchQueryOverride ?? args.userMessage).trim();
    const fincasList = await ctx.runQuery(api.fincas.search, {
      query: searchQuery,
      limit: 12,
    });

    const catalogAlreadyShown = args.whatsappCatalogSentForSearch === true;

    const recentMessages = await ctx.runQuery(api.messages.listRecent, {
      conversationId: args.conversationId,
      limit: 14,
    });

    let fincasContext: string;
    const catalogFailed = args.catalogFoundFincasButFailed === true;
    if (args.clientDeliveredPersonalData) {
      // El cliente YA entregó los datos para el contrato (PASO 5).
      // PROHIBIDO repetir la plantilla del PASO 4. La IA debe emitir cierre + [CONTRACT_PDF:{...}].
      const fincaName = args.confirmedFincaName || "la finca seleccionada";
      const dataNote = args.contractDataBlob
        ? `\n\nDatos recibidos del cliente (textual, úsalos para el resumen y extraerlos al [CONTRACT_PDF:{...}]):\n---\n${args.contractDataBlob}\n---`
        : "";
      fincasContext = `🚨 PASO 5 — CLIENTE YA ENTREGÓ SUS DATOS PERSONALES.
Finca confirmada: *${fincaName}*. El cliente ya dio: ${args.knownDataSummary || "fechas, personas, mascotas"}. Los datos personales (nombre, cédula, teléfono, dirección, correo si aplica) ya aparecen en los mensajes recientes del cliente.

⛔ PROHIBIDO: Volver a enviar "Para elaborar tu contrato de arrendamiento y formalizar la reserva, necesitamos los datos...". Esa plantilla YA FUE ENVIADA y el cliente YA RESPONDIÓ. Reenviarla es un ERROR GRAVE.

✅ OBLIGATORIO: Responde AHORA con la ESTRUCTURA del PASO 5 en UN SOLO mensaje:
  PARTE 1 — Confirmación breve: "¡Perfecto [Nombre]! Confirmo que recibí todos tus datos para la reserva en ${fincaName}. ✨"
  PARTE 2 — Texto exacto del proceso de reserva (👨‍💻 Proceso de reserva: ... RNT 163658 ... ®).
  PARTE 3 — Bloque técnico al final con los datos extraídos: [CONTRACT_PDF:{"nombreCompleto":"...","cedula":"...","telefono":"...","direccion":"...","correo":"...","ciudad":"...","personas":N,"mascotas":N,"entradaHora":"15:00","salidaHora":"13:00","finca":"${fincaName}"}]

Si falta algún dato puntual (p.ej. correo o ciudad de residencia), PIDE SOLO ese dato faltante en 1-2 líneas — NO re-envíes la lista completa del PASO 4.${dataNote}`;
    } else if (args.fincaAlreadyConfirmed && args.confirmedFincaName) {
      // El cliente ya eligió una finca específica — la IA debe avanzar al PASO 3 (cotización) o PASO 4 (datos personales).
      // NO mencionar catálogo, NO pedir que elija finca, NO enviar opciones.
      const fincaCtxData = fincasList.find((f: any) =>
        f.title?.toLowerCase().includes(args.confirmedFincaName!.toLowerCase().trim())
      );
      // Construir ficha detallada de la finca confirmada (precio base + temporadas + reglas) para que la IA
      // pueda cotizar correctamente con depósito mascotas, personal de servicio y restricciones.
      const fincaDetail = fincaCtxData
        ? "\n\n## 📋 DATOS DE LA FINCA CONFIRMADA\n" + formatFincasForPrompt([fincaCtxData as any])
        : "";
      fincasContext = `⚠️ FINCA YA SELECCIONADA Y CONFIRMADA: El cliente eligió *${args.confirmedFincaName}*. El cliente ya dio: ${args.knownDataSummary || "fechas, personas, mascotas"}. NO menciones el catálogo ni otras fincas. Sigue el PASO 3: entrega el DESGLOSE COMPLETO de la cotización (alojamiento + depósito de mascotas si aplica + personal de servicio si la finca lo exige) usando el precio exacto de la ficha, menciona las REGLAS propias de la finca que apliquen al grupo del cliente (mascotas, sonido, solo familiar, etc.) y pide la aprobación. Una vez el cliente aprueba, pasa al PASO 4 (datos personales). NUNCA vuelvas al catálogo.${fincaDetail}`;
    } else if (catalogAlreadyShown && args.catalogLocation) {
      // Construir lista de datos pendientes excluyendo los que el cliente YA dio
      const pendingBullets: string[] = ["● 🏡 ¿Cuál de estas fincas te llamó la atención?"];
      if (!args.hasKnownWeekend) pendingBullets.push("● 📅 Fechas exactas de tu estadía (día de entrada y salida)");
      if (!args.hasKnownCapacity) pendingBullets.push("● 👥 Número total de personas");
      if (!args.hasKnownGroup) pendingBullets.push("● 🏡 Tipo de grupo: familiar, amigos o empresarial");
      const knownNote = args.knownDataSummary
        ? ` El cliente ya proporcionó: ${args.knownDataSummary}. NO vuelvas a pedir estos datos.`
        : "";
      fincasContext = `(El sistema YA ENVIÓ EXITOSAMENTE el catálogo interactivo de WhatsApp con ${args.catalogFincasCount || "varias"} fincas disponibles en ${args.catalogLocation}. El cliente ya puede ver nombres, fotos y precios directamente en su pantalla.${knownNote} Responde siguiendo EXACTAMENTE el formato del PASO 2: menciona brevemente que compartiste el catálogo en ${args.catalogLocation}, y luego pide SOLO los datos faltantes: ${pendingBullets.join(" ")} NO repitas lista de fincas en texto. Termina con "Quedo atento a tu respuesta. 😊")`;
    } else if (catalogAlreadyShown) {
      const knownNote2 = args.knownDataSummary
        ? ` El cliente ya proporcionó: ${args.knownDataSummary}. NO vuelvas a pedir estos datos.`
        : "";
      const pendingBullets: string[] = ["● 🏡 ¿Cuál finca le llamó la atención?"];
      if (!args.hasKnownWeekend) pendingBullets.push("● 📅 Fechas exactas de estadía");
      if (!args.hasKnownCapacity) pendingBullets.push("● 👥 Número total de personas");
      if (!args.hasKnownGroup) pendingBullets.push("● 🏡 Tipo de grupo");
      fincasContext = `(Ya se envió el catálogo de WhatsApp con las fincas; el cliente ve nombres, fotos y precios ahí.${knownNote2} Sigue el PASO 2: pide SOLO los datos faltantes: ${pendingBullets.join(" ")}. NO repitas lista de fincas en texto.)`;
    } else if (catalogFailed && fincasList.length > 0) {
      // El catálogo interactivo de WhatsApp NO pudo enviarse (las fincas no están registradas en el catálogo de Meta).
      // En este caso excepcional, la IA DEBE describir las fincas disponibles en texto.
      fincasContext = `⚠️ MODO FALLBACK (catálogo interactivo NO disponible para esta ciudad): El sistema intentó enviar el catálogo de WhatsApp pero las fincas no están registradas en el catálogo de Meta. DEBES mencionar en texto las fincas disponibles con sus precios (excepción a la regla de no listar). Fincas encontradas:\n${formatFincasForPrompt(fincasList)}`;
    } else {
      const threadKnown =
        args.knownDataSummary && args.knownDataSummary.trim().length > 0
          ? `**Resumen de lo que el cliente ya dijo:** ${args.knownDataSummary}\n${
              args.hasKnownLocation === true
                ? "**NO** vuelvas a preguntar en qué ciudad o municipio — el destino ya consta arriba o en el historial. **PROHIBIDO** el bloque «Te puedo mostrar opciones en: Anapoima, Girardot…» ni «¿En dónde te gustaría empezar?»: el cliente ya eligió zona. Sigue con el siguiente dato del embudo (tipo de plan si faltara, o una sola línea evento vs descanso, o deja el catálogo).\n\n"
                : ""
            }`
          : args.hasKnownLocation === true
            ? "**El cliente ya indicó un municipio/destino en el hilo.** NO preguntes de nuevo por ciudad ni listes zonas. **PROHIBIDO** «Te puedo mostrar opciones en…» / «¿En dónde te gustaría empezar?».\n\n"
            : "";
      fincasContext = threadKnown + formatFincasForPrompt(fincasList);
    }

    // Enriquecer con reglas de temporada y precios por finca (siempre, no solo cuando hay fechas en el mensaje actual)
    if (fincasList.length > 0 && !catalogAlreadyShown) {
      // Buscar fechas en el mensaje actual Y en los mensajes recientes de la conversación
      const fullConversationText = [
        ...recentMessages.map((m: any) => m.content),
        args.userMessage,
      ].join(" ");

      const monthNames: Record<string, number> = { enero:0,febrero:1,marzo:2,abril:3,mayo:4,junio:5,julio:6,agosto:7,septiembre:8,octubre:9,noviembre:10,diciembre:11 };
      // Regex más robusta para fechas: "20 al 25 de abril", "del 20 al 25", "20 hasta el 25 de mayo"
      const dateRangeMatch = fullConversationText.match(/(?:del\s+|desde el\s+|desde\s+)?(\d{1,2})\s*(?:al|hasta el|hasta|a)\s*(\d{1,2})/i);
      const monthMatch = fullConversationText.match(/\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b/i);
      
      let parsedDates: { start: string, end: string } | null = null;
      if (dateRangeMatch) {
        const d1 = parseInt(dateRangeMatch[1], 10);
        const d2 = parseInt(dateRangeMatch[2], 10);
        const now = new Date();
        const monthIndex = monthMatch ? monthNames[monthMatch[1].toLowerCase()] ?? now.getMonth() : now.getMonth();
        const year = now.getFullYear();
        
        const monthNum = String(monthIndex + 1).padStart(2, '0');
        
        // Formato YYYY-MM-DD manual para evitar desfases de zona horaria
        parsedDates = {
          start: `${year}-${monthNum}-${String(d1).padStart(2, '0')}`,
          end: `${year}-${monthNum}-${String(d2).padStart(2, '0')}`
        };
      }

      const pricingBlocks: string[] = [];
      const availabilityBlocks: string[] = [];

      for (const finca of fincasList.slice(0, 8)) {
        // 1. Precios y Temporadas (Usando la lógica oficial)
        try {
          if (parsedDates) {
            const pricingRes = await ctx.runQuery(api.fincas.calculateStayPrice, {
              propertyId: finca._id as any,
              fechaEntrada: parsedDates.start,
              fechaSalida: parsedDates.end,
            });

            if (pricingRes && pricingRes.total > 0) {
              const breakdown = pricingRes.nights.map((n: any) => 
                `    - ${n.date} (${n.ruleName}): $${n.price.toLocaleString("es-CO")}`
              ).join("\n");

              pricingBlocks.push(`📋 DESGLOSE DE PRECIOS PARA ${finca.title} (${parsedDates.start} al ${parsedDates.end}):
    Total: $${pricingRes.total.toLocaleString("es-CO")} (${pricingRes.nightsCount} noches)
    Desglose:
${breakdown}
  ⚠️ INSTRUCCIÓN: Informa al cliente este TOTAL EXACTO de $${pricingRes.total.toLocaleString("es-CO")} y menciona brevemente por qué varía el precio (ej. noches de fin de semana o temporada).`);
            }
          }

          // Mostrar reglas generales de todos modos si no hay fechas o como contexto extra
          const rules = await ctx.runQuery(api.fincas.getPropertyPricingRules, {
            propertyId: finca._id as any,
          });
          if (rules.length > 0 && (!parsedDates || pricingBlocks.length === 0)) {
            const reglaLines = rules.map((r: any) => {
              const rango = r.fechaDesde && r.fechaHasta ? `${r.fechaDesde} al ${r.fechaHasta}` : "general";
              return `  - ${r.nombre} (${rango}): $${(r.valorUnico || 0).toLocaleString("es-CO")}/noche`;
            }).join("\n");
            pricingBlocks.push(`📋 Tarifas generales de ${finca.title}:\n${reglaLines}`);
          }
        } catch (e) {
          console.log("[pricing] Error calculating price for", finca.title, e);
        }

        // 2. Disponibilidad (Calendario)
        try {
          const availability = await ctx.runQuery(api.fincas.getPropertyAvailability, {
            propertyId: finca._id as any,
            monthsAhead: 3,
          });
          if (availability.length > 0) {
            const busyLines = availability.map((b: any) => {
              const d1 = new Date(b.fechaEntrada).toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit" });
              const d2 = new Date(b.fechaSalida).toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit" });
              return `  - [${d1} al ${d2}] (${b.reason})`;
            }).join("\n");
            availabilityBlocks.push(`🗓️ CALENDARIO DE OCUPACIÓN (${finca.title}):\n${busyLines}`);
          } else {
            availabilityBlocks.push(`🗓️ CALENDARIO DE OCUPACIÓN (${finca.title}): Totalmente disponible por ahora.`);
          }
        } catch (e) {
          console.log("[availability] Error fetching availability for", finca.title, e);
        }
      }

      if (pricingBlocks.length > 0) {
        fincasContext += `\n\n## 📅 REGLAS DE TEMPORADA Y PRECIOS POR FINCA\n${pricingBlocks.join("\n\n")}\n\nUSA siempre el PRECIO APLICABLE marcado con ⚠️ si existe. Si no, usa el precio Base de la finca. NUNCA inventes precios.`;
      } else {
        fincasContext += `\n\n⚠️ **INSTRUCCIÓN DE PRECIOS:** SIEMPRE usa el precio Base que aparece en cada finca. NUNCA inventes un precio diferente al que está en los datos.`;
      }

      if (availabilityBlocks.length > 0) {
        fincasContext += `\n\n## 🏘️ DISPONIBILIDAD (FECHAS RESERVADAS/OCUPADAS)\n${availabilityBlocks.join("\n\n")}\n\n**IMPORTANTE:** Si el cliente solicita fechas que se solapan con las ocupadas arribas, infórmale que la finca NO está disponible para esos días de forma amable. **PROHIBIDO** dar detalles de quién hizo la reserva.`;
      }
    }

    const currentDate = new Date().toLocaleDateString("es-CO", {
      timeZone: "America/Bogota",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    // ── INYECTAR PLANTILLAS ─────────────────────────────────────────
    // Plantillas = contexto de negocio (hechos, tono aproximado). La IA parafrasea
    // salvo bloques que el prompt del consultor marca como texto legal fijo (PASO 4/5, CONTRACT_PDF).
    let templatesSection = "";
    try {
      const dbTemplates = await ctx.runQuery(api.quickReplyTemplates.listActive, {});
      const dbBlocks: string[] = [];
      for (const t of dbTemplates as any[]) {
        if (t.mediaType === "audio") continue; // plantillas de audio no se copian como texto
        const content = String(t.content || "").trim();
        if (!content) continue;
        dbBlocks.push(
          `### intentKey: ${t.intentKey}\n### title: ${t.title}\n### slashCommand: /${t.slashCommand}\n--- REFERENCIA (contexto; parafrasear con tono humano, conservar montos y datos legales literales) ---\n${content}\n--- FIN REFERENCIA ---`
        );
      }

      let waTemplates: RoutableWhatsappTemplate[] = [];
      try {
        waTemplates = await fetchRoutableTemplates();
      } catch {
        waTemplates = [];
      }
      const waBlocks: string[] = [];
      for (const t of waTemplates) {
        const body = String(t.body || "").trim();
        if (!body) continue;
        waBlocks.push(
          `### intentKey: ${t.name}\n### title: ${t.hint}\n### origen: WhatsApp oficial (${t.language})\n--- REFERENCIA (contexto; parafrasear con tono humano, conservar montos y datos legales literales) ---\n${body}\n--- FIN REFERENCIA ---`
        );
      }

      const allBlocks = [...dbBlocks, ...waBlocks];
      if (allBlocks.length > 0) {
        templatesSection = allBlocks.join("\n\n");
      }
    } catch (e) {
      console.error("[prompt-templates] error cargando plantillas:", e);
    }

    const systemPrompt = buildSystemPrompt(
      ragResult.text,
      fincasContext,
      effectiveBasePrompt,
      {
        singleFincaCatalogSent: args.singleFincaCatalogSent ?? false,
        fincaTitle: args.fincaTitle ?? "",
        whatsappCatalogSentForSearch: catalogAlreadyShown,
        catalogFoundFincasButFailed: catalogFailed,
        currentDate,
        dynamicLocations: args.dynamicLocations,
        hasKnownLocation: args.hasKnownLocation === true,
        hasImage: !!args.imageUrl,
        templatesSection,
        isReactivated: args.isReactivated ?? false,
      }
    );
    // ── TTL de historial: solo incluir mensajes de las últimas 12 horas ──
    // Si han pasado más de 12h desde el último mensaje, el agente arranca
    // sin contexto previo (como una conversación nueva).
    const HISTORY_TTL_MS = 12 * 60 * 60 * 1000; // 12 horas
    const historyCutoff = Date.now() - HISTORY_TTL_MS;
    const freshMessages = recentMessages.filter((m: any) => m.createdAt >= historyCutoff);
    console.log("[history-ttl] mensajes en contexto:", freshMessages.length, "/", recentMessages.length);
    const messages: CoreMessage[] = [];

    for (let idx = 0; idx < freshMessages.length; idx++) {
      const m = freshMessages[idx] as any;
      const isUser = m.sender === "user";
      const isLastUserMsg = isUser && idx === freshMessages.length - 1;

      // Only attach image to the LAST user message (current message) to save costs
      if (isLastUserMsg && args.imageUrl) {
        messages.push({
          role: "user",
          content: [
            { type: "text", text: m.content || "El usuario envió esta imagen." },
            { type: "image", image: new URL(args.imageUrl) },
          ],
        });
      } else if (isUser) {
        messages.push({ role: "user", content: m.content as string });
      } else {
        messages.push({ role: "assistant", content: m.content as string });
      }
    }

    const { text } = await generateText({
      model: openai.chat(CONVEX_OPENAI_CHAT_MODEL),
      temperature: 1,
      system: systemPrompt,
      messages,
    });

    return text;
  },
});

function formatFincasForPrompt(
  list: Array<{
    _id: string;
    title: string;
    description?: string;
    location?: string;
    capacity?: number;
    type?: string;
    category?: string;
    priceBase?: number;
    priceBaja?: number;
    priceMedia?: number;
    priceAlta?: number;
    priceEspeciales?: number;
    image?: string;
    allowsPets?: boolean;
    allowsEventsContent?: boolean;
    familyOnly?: boolean;
    serviceStaffMandatory?: boolean;
    serviceStaffPrice?: number;
    isDirect?: boolean;
    isDirectBooking?: boolean;
  }>
): string {
  if (!list?.length) return "";
  const money = (n?: number) =>
    n && n > 0 ? `$${n.toLocaleString("es-CO")}` : "N/A";
  return list
    .map((p) => {
      const propertyType =
        p.isDirect === true || p.isDirectBooking === true
          ? "🟢 Finca Propia (disponibilidad directa)"
          : p.isDirect === false
          ? "🔵 Finca de Propietario (disponibilidad a confirmar con propietario)"
          : "";
      const typeLine = propertyType ? ` | Tipo: ${propertyType}` : "";
      const base = `- ${p.title} (ID: ${p._id}): ${p.description ?? ""} | Ubicación: ${p.location ?? "N/A"} | Capacidad: ${p.capacity ?? "N/A"} personas | Precio base/noche: ${money(p.priceBase)}${typeLine}`;
      const seasons: string[] = [];
      if (p.priceBaja && p.priceBaja > 0) seasons.push(`baja ${money(p.priceBaja)}`);
      if (p.priceMedia && p.priceMedia > 0) seasons.push(`media ${money(p.priceMedia)}`);
      if (p.priceAlta && p.priceAlta > 0) seasons.push(`alta ${money(p.priceAlta)}`);
      if (p.priceEspeciales && p.priceEspeciales > 0)
        seasons.push(`especial ${money(p.priceEspeciales)}`);
      const seasonLine = seasons.length
        ? ` | Precios por temporada: ${seasons.join(", ")}`
        : "";
      const rules: string[] = [];
      if (p.allowsPets === true)
        rules.push("✅ Permite mascotas (1-2: depósito $100k c/u, desde la 3ra: +$30k c/u)");
      if (p.allowsPets === false) rules.push("❌ NO permite mascotas");
      if (p.allowsEventsContent === true) rules.push("✅ Permite sonido/eventos");
      if (p.allowsEventsContent === false) rules.push("❌ NO permite bafles ni sonido profesional");
      if (p.familyOnly === true) rules.push("⚠️ Solo descanso familiar (no grupos de amigos/eventos)");
      if (p.serviceStaffMandatory === true)
        rules.push(
          `⚠️ Personal de servicio OBLIGATORIO${p.serviceStaffPrice ? ` (${money(p.serviceStaffPrice)}/día)` : ""}`
        );
      else if (p.serviceStaffPrice && p.serviceStaffPrice > 0)
        rules.push(`Personal de servicio opcional: ${money(p.serviceStaffPrice)}/día`);
      const rulesLine = rules.length ? `\n    · Reglas: ${rules.join(" | ")}` : "";
      return `${base}${seasonLine}${rulesLine}`;
    })
    .join("\n");
}

function buildSystemPrompt(
  ragContext: string,
  fincasContext: string,
  basePromptInput?: string,
  opts?: {
    singleFincaCatalogSent?: boolean;
    fincaTitle?: string;
    whatsappCatalogSentForSearch?: boolean;
    catalogFoundFincasButFailed?: boolean;
    currentDate?: string;
    dynamicLocations?: string;
    /** El historial/resumen ya incluye destino (municipio) — no volver a preguntar ciudad. */
    hasKnownLocation?: boolean;
    hasImage?: boolean;
    templatesSection?: string;
    isReactivated?: boolean;
  }
): string {
  let basePrompt = basePromptInput || CONSULTANT_SYSTEM_PROMPT;
  
  // Reemplazo dinámico o limpieza del listado de ciudades
  if (opts?.dynamicLocations) {
    basePrompt = basePrompt.replace(/{DYNAMIC_LOCATIONS_LIST}/g, opts.dynamicLocations);
  } else {
    // Si no se provee la lista (porque ya hay ubicación), reemplazar con algo genérico o vacío para que no use el placeholder literal
    basePrompt = basePrompt.replace(/{DYNAMIC_LOCATIONS_LIST}/g, "nuestros destinos disponibles");
  }

  const singleFincaHint =
    opts?.singleFincaCatalogSent && opts?.fincaTitle
      ? `
---
**AHORA MISMO:** El usuario te pidió ver una finca específica y el sistema YA LE ENVIÓ la ficha individual por catálogo de WhatsApp. Responde UNA sola frase corta confirmando y avanzando al siguiente paso. **NO** vuelvas a pedir fechas ni personas: ya las tienes del historial. Ejemplo: "Ahí te envié la ficha de ${opts.fincaTitle}. ¿La confirmamos? 🏡✅" o "Listo, revisa la ficha de ${opts.fincaTitle}. ¿Avanzamos con la reserva? 🏡"
`
      : "";

  const multiCatalogHint = opts?.whatsappCatalogSentForSearch
    ? `
---
## 🚫 PROHIBICIÓN ABSOLUTA: NO LISTAR FINCAS EN TEXTO
**AHORA MISMO:** El sistema YA ENVIÓ el **catálogo interactivo de WhatsApp** con TODAS las fincas disponibles (tarjetas con fotos, precios y detalles). El cliente ya las puede ver en su pantalla.

**ESTÁ TERMINANTEMENTE PROHIBIDO:**
- Escribir listas numeradas (1. 2. 3.) con nombres de fincas
- Escribir listas con viñetas (*Finca X*: descripción)
- Mencionar nombres de fincas específicas con descripciones
- Decir "Aquí tienes algunas opciones:" seguido de una lista
- Copiar o resumir el contenido del catálogo en texto

**LO ÚNICO QUE DEBES HACER:** Responder con 1-2 líneas MÁXIMO confirmando que enviaste el catálogo e invitando a elegir.
**EJEMPLO CORRECTO:** "¡Claro que sí! Te compartí el catálogo con las opciones de fincas disponibles en [Ciudad] para tus fechas. Dime cuál de estas fincas prefieres reservar. 🏡✨"
**EJEMPLO INCORRECTO (NUNCA HAGAS ESTO):** "Aquí tienes algunas opciones: 1. *Finca X*: Capacidad para... 2. *Finca Y*: Ideal para..."
`
    : "";

  const catalogNotYetSentHint =
    !opts?.whatsappCatalogSentForSearch && !opts?.catalogFoundFincasButFailed
      ? `
---
## 🚨 CATÁLOGO INTERACTIVO: ESTADO REAL (NO INVENTAR)
En este turno el sistema **puede aún no haber enviado** el catálogo de WhatsApp (tarjetas). Tu contexto arriba solo cuenta como "catálogo enviado" si dice explícitamente que **YA se envió el catálogo interactivo**.

**PROHIBIDO:** Frases como "ya te compartí el catálogo", "ya envié las opciones", "revisa las fichas que te mandé", "listo ya están las fincas en tu pantalla" si eso **no** es cierto aún.
**OBLIGATORIO:** Para la **primera** vez que el cliente pide ver fincas/precios/opciones, responde en 1–2 líneas y deja que el **sistema** dispare el catálogo; tú **no** simules que ya se envió. No pidas **mascotas**, **presupuesto** ni **"¿ya eres cliente?"** solo para poder mostrar el catálogo la primera vez — eso va **después** de que elija una finca o al cotizar/cerrar.
`
      : "";

  const variasFincasTextoRule = opts?.catalogFoundFincasButFailed
    ? "**MODO FALLBACK ACTIVO:** El catálogo interactivo de WhatsApp NO está disponible para esta ciudad (fincas no registradas en Meta). EXCEPCIÓN: DEBES listar en texto las fincas disponibles con nombre, capacidad y precio base. Usa viñetas simples. Después pregunta cuál le interesa."
    : "**REGLA ABSOLUTA: NUNCA listes nombres de fincas en texto, con o sin catálogo enviado. El catálogo interactivo de WhatsApp muestra todas las propiedades con fotos, precios y detalles. Si no fue enviado aún, el sistema lo enviará por separado. Tu respuesta de texto debe ser SOLO confirmación breve + pregunta concreta.**";

  const dynamicLocationsText = opts?.dynamicLocations 
    ? `\n**UBICACIONES DISPONIBLES EN TIEMPO REAL:** ${opts.dynamicLocations}`
    : "";

  const knownLocationBlock =
    opts?.hasKnownLocation === true
      ? `
**⛔ DESTINO YA CONOCIDO (sistema):** El hilo ya incluye un municipio/destino válido. **NO** preguntes "¿en qué ciudad o municipio?" ni por el "destino exacto".
`
      : "";

  const priorityInstructions = `
---
## ⚠️ INSTRUCCIONES DE PRIORIDAD MÁXIMA (OVERRIDE)
${knownLocationBlock}
1. **PASO 1 (Ubicación):** Si el resumen en CONTEXTO DE FINCAS o el historial **ya incluye destino** (p. ej. "destino: melgar"), **PROHIBIDO** repetir la pregunta de ciudad/municipio — avanza con lo que falta (personas, fechas si aún faltan, o deja que el sistema envíe el catálogo). Solo si **no** hay ubicación en el hilo y todavía NO se ha enviado catálogo, pregunta únicamente por ciudad/municipio (una pregunta corta). Si el CONTEXTO DE FINCAS indica que ya se envió un catálogo, NO vuelvas a pedir ciudad, fechas ni personas: pregunta cuál finca le gustó. PROHIBIDO listar ciudades disponibles.
2. **CATÁLOGO ENVIADO = NO LISTAR EN TEXTO:** Si el CONTEXTO DE FINCAS dice que "YA ENVIÓ EXITOSAMENTE el catálogo", tu mensaje debe ser SOLO 1-2 líneas confirmando el envío. NUNCA listes fincas en texto.
3. **DESTINOS CERCANOS:** Si el cliente pide una ciudad sin fincas, sugiere destinos cercanos usando la lista UBICACIONES DISPONIBLES (mencionando solo 3-5 opciones relevantes geográficamente).
4. **PRECIOS DE TEMPORADA:** Si en el CONTEXTO DE FINCAS aparecen REGLAS DE TEMPORADA para una finca, DEBES usar el valorUnico de la temporada que aplique a las fechas del cliente. Si no aplica ninguna temporada, usa el precio Base.
`;

  const visionHint = opts?.hasImage
    ? `
---
## 📷 ANÁLISIS DE IMAGEN
El usuario te ha enviado una imagen. DEBES analizarla visualmente:
- Si parece una finca/propiedad, compara sus características (piscina, jardín, estilo, ubicación, paisaje) con las fincas listadas en tu CONTEXTO DE FINCAS para intentar identificarla.
- Si logras identificar la finca, respóndele con entusiasmo mencionando el nombre de la finca y ofreciendo enviar la ficha o más información.
- Si no logras identificarla con certeza, describe lo que ves en la imagen y pregunta si es alguna de tus fincas disponibles o si busca algo similar.
- Si la imagen no es una finca (ej: comprobante de pago, documento, selfie), responde acorde al contexto de la conversación.
`
    : "";

  const reactivatedHint = opts?.isReactivated
    ? `
---
## 🔄 CLIENTE QUE REGRESA (RETOMAR CONVERSACIÓN)
Este cliente ya tuvo una conversación previa con FincasYa.com y regresó después de un tiempo.

**REGLAS OBLIGATORIAS:**
- ❌ PROHIBIDO usar el saludo de bienvenida inicial ("¡Hola! Es un gusto saludarte. Te escribe Hernán...").
- ❌ PROHIBIDO pedir de nuevo todos los datos de cero si ya aparecen en el historial.
- ✅ Retoma la conversación de forma cálida y natural, como si continuaras donde se quedó.
- ✅ Si el historial tiene datos previos (finca, fechas, personas), úsalos directamente.
- ✅ Si no hay historial reciente, usa un mensaje breve de seguimiento. Ejemplo: "¡Hola de nuevo! ¿Te puedo ayudar con algo para tu próxima escapada? 🏡"
- ✅ Si el cliente retoma preguntando por una finca o fechas específicas, responde directamente sin preámbulos largos.
`
    : "";

  const voiceHint = `
---
## 🎙️ MENSAJES DE VOZ (Transcripción)
Si el mensaje del usuario empieza con "[Voz]", significa que fue transcrito automáticamente desde un audio de WhatsApp.
- Sé natural y amigable.
- Si la transcripción parece tener errores fonéticos (ej: nombres de fincas mal escritos), intenta inferir lo que el cliente quiso decir basándote en el catálogo.
`;

  const officialNameHint = opts?.fincaTitle
    ? `\n**REGLA DE NOMBRE:** Has identificado que el usuario se refiere a la finca "${opts.fincaTitle}". USA SIEMPRE este nombre exacto en tu respuesta, ignorando errores ortográficos o de transcripción que el usuario pueda tener en su mensaje original.`
    : "";

  const templatesBlock = opts?.templatesSection
    ? `

---
## 📚 BIBLIOTECA DE PLANTILLAS (CONTEXTO + INTENCIÓN)

Las entradas siguientes son **material de referencia** aprobado por FincasYa: mismos hechos, precios, pasos y restricciones que debe conocer el cliente. **NO** estás obligado a copiar el párrafo entero.

**CÓMO USARLAS:**
1. Identifica la **intención** del cliente (mascotas, check-in, pago, llegada, propietario, etc.) y elige **una sola** entrada cuyo \`intentKey\` / \`title\` encaje mejor.
2. Redacta una respuesta **nueva**, corta, humana y comercial (2–4 frases salvo PASO 4/5 del flujo principal), que **transmita la misma información** que la referencia.
3. **Conserva literalmente** montos ($100.000, $30.000, $70.000, $90.000, 50%, RNT 163658, medios de pago listados, mínimos de noches, etc.), nombres de proceso y condiciones contractuales. No inventes cifras ni políticas que no estén en la referencia o en el resto del prompt.
4. Puedes variar saludos, conectores y orden de ideas; evita sonar a “copiar y pegar” del bloque.
5. Si ninguna entrada encaja, ignora la biblioteca y sigue el PROMPT DEL CONSULTOR + RAG + contexto de fincas.

**Excepción (texto fijo del flujo):** Los bloques **PASO 4** (solicitud de datos para contrato), **PASO 5** (proceso de reserva + RNT) y **[CONTRACT_PDF:...]** del prompt principal siguen siendo **VERBATIM** cuando correspondan a esa etapa — no los sustituyas por un parafraseo.

${opts.templatesSection}

---
`
    : "";

  return `${basePrompt}${dynamicLocationsText}${priorityInstructions}${reactivatedHint}${singleFincaHint}${multiCatalogHint}${catalogNotYetSentHint}${visionHint}${voiceHint}${officialNameHint}${templatesBlock}

---
## REGLA DE LISTAS DE FINCAS
${variasFincasTextoRule}

---
## CONTEXTO RAG (Base de Conocimiento)
${ragContext}

## CONTEXTO DE FINCAS (Resultados de búsqueda)
${fincasContext}

## FECHA ACTUAL: ${opts?.currentDate ?? "No especificada"}
---
## CONTEXTO ACTUAL (Usa SOLO esta información para datos concretos)
`;
}

/**
 * Cuando el negocio envía un mensaje (humano desde YCloud), marcar la conversación como "human"
 * para que la IA no siga respondiendo hasta que se vuelva a activar "ai".
 */
export const markOutboundAsHuman = internalMutation({
  args: { phone: v.string() },
  handler: async (ctx, args) => {
    const contact = await ctx.db
      .query("contacts")
      .withIndex("by_phone", (q) => q.eq("phone", args.phone))
      .unique();
    if (!contact) return;
    const conv = await ctx.db
      .query("conversations")
      .withIndex("by_contact", (q) => q.eq("contactId", contact._id))
      .order("desc")
      .first();
    if (conv && (conv.status === "ai" || conv.status === "human")) {
      await ctx.db.patch(conv._id, { status: "human", attended: false });
    }
  },
});

/**
 * Enviar mensaje por WhatsApp vía YCloud.
 * Requiere en Convex: YCLOUD_API_KEY, YCLOUD_WABA_NUMBER (número E164 del negocio).
 */
export const sendWhatsAppMessage = internalAction({
  args: {
    to: v.string(),
    text: v.string(),
    wamid: v.optional(v.string()),
    sendDirectly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const apiKey = process.env.YCLOUD_API_KEY;
    const wabaNumber = process.env.YCLOUD_WABA_NUMBER;
    if (!apiKey || !wabaNumber) {
      throw new Error(
        "YCLOUD_API_KEY y YCLOUD_WABA_NUMBER deben estar configurados en Convex (npx convex env set ...)"
      );
    }
    const endpoint = args.sendDirectly
      ? "https://api.ycloud.com/v2/whatsapp/messages/sendDirectly"
      : "https://api.ycloud.com/v2/whatsapp/messages";
    const body: {
      from: string;
      to: string;
      type: string;
      text: { body: string };
      context?: { message_id: string };
    } = {
      from: wabaNumber,
      to: args.to,
      type: "text",
      text: { body: args.text.replace(/\[CONTRACT_PDF:.*?\]/g, "").trim() },
    };
    if (args.wamid) body.context = { message_id: args.wamid };
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify(body),
    });
    const textRes = await res.text();
    if (!res.ok) {
      throw new Error(`YCloud API error: ${res.status} - ${textRes}`);
    }
    return JSON.parse(textRes);
  },
});

const YCLOUD_TEMPLATES_LIST = "https://api.ycloud.com/v2/whatsapp/templates";
const YCLOUD_SEND_DIRECTLY =
  "https://api.ycloud.com/v2/whatsapp/messages/sendDirectly";

/**
 * Plantillas que no debe elegir el bot automáticamente.
 * bienvenida* ya no van aquí: deben poder elegirse desde YCloud cuando encajen.
 */
const TEMPLATE_ROUTING_DENYLIST = new Set(["chat_center"]);

/**
 * Plantillas quick-reply guardadas en Convex (tabla quickReplyTemplates).
 * Por defecto ACTIVADO: saludos y aperturas deben ir con texto exacto de BD, no improvisado por la IA.
 * Desactivar solo si hace falta depurar: YCLOUD_QUICK_REPLY_ROUTING=off
 */
function isQuickReplyDbRoutingEnabled(): boolean {
  const envVal = process.env.YCLOUD_QUICK_REPLY_ROUTING?.trim().toLowerCase();
  if (!envVal) return true;
  return !(
    envVal === "0" ||
    envVal === "false" ||
    envVal === "off" ||
    envVal === "no"
  );
}

function quickReplyRoutingDisabled(): boolean {
  return !isQuickReplyDbRoutingEnabled();
}

/**
 * Enrutamiento a plantillas oficiales de WhatsApp vía YCloud (APPROVED, sin variables).
 * Por defecto DESACTIVADO. Activar con: YCLOUD_TEMPLATE_ROUTING=on (o true, 1, yes)
 */
function isAutomaticTemplateRoutingEnabled(): boolean {
  const envVal = process.env.YCLOUD_TEMPLATE_ROUTING?.trim().toLowerCase();
  if (!envVal) return false;
  return (
    envVal === "1" ||
    envVal === "true" ||
    envVal === "on" ||
    envVal === "yes"
  );
}

function templateRoutingDisabled(): boolean {
  return !isAutomaticTemplateRoutingEnabled();
}

type YCloudTemplateListItem = {
  name: string;
  language: string;
  status: string;
  wabaId?: string;
  components?: Array<{
    type?: string;
    text?: string;
    buttons?: unknown[];
  }>;
};

function isTemplateApproved(status: string | undefined): boolean {
  return String(status ?? "").toUpperCase() === "APPROVED";
}

export type RoutableWhatsappTemplate = {
  name: string;
  language: string;
  /** Pistas para el clasificador sin enviar el BODY completo al prompt. */
  hint: string;
  body?: string;
};

function bodyHasVariables(
  components: YCloudTemplateListItem["components"]
): boolean {
  if (!components?.length) return false;
  for (const c of components) {
    if (
      c.type === "BODY" &&
      typeof c.text === "string" &&
      c.text.includes("{{")
    ) {
      return true;
    }
  }
  return false;
}

/** Tema legible a partir del nombre interno (snake_case). */
function buildIntentHintFromName(name: string): string {
  return name.replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

function itemsToRoutable(
  items: YCloudTemplateListItem[],
  onlyWabaId?: string
): RoutableWhatsappTemplate[] {
  const extraDeny = new Set(
    (process.env.YCLOUD_TEMPLATE_ROUTING_DENYLIST ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );

  const out: RoutableWhatsappTemplate[] = [];
  const seen = new Set<string>();

  for (const t of items) {
    if (
      onlyWabaId &&
      (!t.wabaId || String(t.wabaId) !== onlyWabaId)
    )
      continue;
    if (!isTemplateApproved(t.status)) continue;
    if (bodyHasVariables(t.components)) continue;
    if (TEMPLATE_ROUTING_DENYLIST.has(t.name) || extraDeny.has(t.name))
      continue;

    const lang = (t.language || "es").trim();
    const key = `${t.name}:${lang}`;
    if (seen.has(key)) continue;

    seen.add(key);
    const bodyText = t.components?.find((c) => c.type === "BODY")?.text || "";
    out.push({
      name: t.name,
      language: lang,
      hint: buildIntentHintFromName(t.name),
      body: bodyText,
    });
  }

  return out;
}

async function fetchYCloudTemplateItems(
  apiKey: string,
  withWabaFilter: boolean,
  wabaId?: string
): Promise<YCloudTemplateListItem[]> {
  const params = new URLSearchParams({ limit: "100" });
  if (withWabaFilter && wabaId) params.set("filter.wabaId", wabaId);
  const res = await fetch(`${YCLOUD_TEMPLATES_LIST}?${params.toString()}`, {
    headers: { "X-API-Key": apiKey },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    console.error("fetchYCloudTemplateItems error:", res.status, txt);
    return [];
  }
  const data = (await res.json()) as { items?: YCloudTemplateListItem[] };
  return data.items ?? [];
}

/**
 * Lista plantillas APPROVED sin variables en el BODY (envío sin parámetros).
 * Si el filtro por WABA devuelve vacío, reintenta sin query y filtra por item.wabaId.
 */
async function fetchRoutableTemplates(): Promise<RoutableWhatsappTemplate[]> {
  const apiKey = process.env.YCLOUD_API_KEY;
  if (!apiKey) return [];

  const wabaId = process.env.YCLOUD_WABA_ID?.trim();

  let items = await fetchYCloudTemplateItems(apiKey, true, wabaId);
  if (items.length === 0 && wabaId) {
    console.warn(
      "[template-routing] listado vacío con filter.wabaId; reintentando sin filtro y filtrando por wabaId en items"
    );
    items = await fetchYCloudTemplateItems(apiKey, false, undefined);
  }

  return itemsToRoutable(items, wabaId || undefined);
}

/**
 * Coincidencia por palabras clave (no depende de la IA). Orden: más específico primero.
 */
function pickTemplateByKeywords(
  userMessage: string,
  routable: RoutableWhatsappTemplate[]
): { name: string; language: string } | null {
  const msg = userMessage.toLowerCase().normalize("NFD");
  const ascii = msg.replace(/\p{M}/gu, "");

  const byName = (n: string) => routable.find((t) => t.name === n);
  const pick = (templateName: string) => {
    const t = byName(templateName);
    return t ? { name: t.name, language: t.language } : null;
  };

  const rules: Array<{ re: RegExp; template: string }> = [
    {
      re: /personal\s+obligatorio|servicio\s+obligatorio|requieren\s+personal|personal\s+de\s+servicio.*oblig/i,
      template: "personal_de_servicio_obligatorio",
    },
    {
      re: /personal\s+de\s+(apoyo|servicio)|emplead[ao]\s+de\s+servicio|contratar\s+personal|muchacha\s+de/i,
      template: "personal_de_servicio_en_caso_de_que_la_propiedad_tenga",
    },
    {
      re: /mascota|perro|perros|gato|gatos|animal|llev(ar|o)\s+(mi\s+)?(perro|gato)/i,
      template: "pregunta_por_mascotas",
    },
    {
      re: /check\s*-?\s*in|check\s*-?\s*out|hora\s+de\s+(entrada|salida)|a\s+que\s+hora\s+(entro|llego|salgo)/i,
      template: "preguntas_check_in_y_check_out",
    },
    {
      re: /cobro\s+por\s+persona|precio\s+por\s+persona|valor\s+por\s+persona|cobran\s+por\s+persona|pagan\s+por\s+persona/i,
      template: "pregunta_sobre_el_cobro_por_persona",
    },
    {
      re: /navidad|fin\s+de\s+a[nñ]o|noche\s+vieja|reyes|a[nñ]o\s+nuevo|fechas\s+especiales|festividades/i,
      template: "tarifas_y_disponibilidad_en_fechas_especiales",
    },
    {
      re: /puente\s+festivo|puentes\s+festivos|fin\s+de\s+semana\s+largo/i,
      template: "fin_de_semana_con_puente",
    },
    {
      re: /contrato(\s+de\s+arrendamiento)?|datos\s+para\s+(el\s+)?contrato|firm(ar|o)\s+(el\s+)?contrato|cedula.*contrato/i,
      template: "contrato_de_arrendamiento",
    },
    {
      re: /como\s+(reservo|pago|hago\s+la\s+reserva)|proceso\s+de\s+(reserva|pago)|formas\s+de\s+pago|abono\s+del\s*50|medios\s+de\s+pago/i,
      template: "proceso_de_reserva",
    },
    {
      re: /dj\b|sonido\s+profesional|grupo\s+musical|iluminaci[oó]n.*(evento|fiesta)|evento\s+en\s+la\s+finca/i,
      template: "detalles_en_caso_de_evento_o_celebracion_especial",
    },
    {
      re: /fiesta|evento\s+familiar|evento\s+empresarial|celebraci[oó]n/i,
      template: "en_caso_de_fiesta",
    },
    {
      re: /sin\s+disponibilidad|no\s+hay\s+disponibilidad|no\s+tienen\s+nada\s+en|agotad[oa]\s+en/i,
      template: "sector_no_disponible",
    },
    {
      re: /entrega\s+(formal\s+)?del\s+inmueble|saldo\s+(pendiente|restante)|recibir\s+la\s+finca/i,
      template: "cobro_y_entrega_formal_del_inmueble",
    },
    {
      re: /descuento|rebaja|mejor\s+precio(\s+por\s+noche)?/i,
      template: "descuentos_en_propiedades",
    },
    {
      re: /video\s+(de\s+)?(la\s+)?finca|conocer\s+(la\s+)?propiedad|m[aá]s\s+(fotos|info|informaci[oó]n).*\bfinca/i,
      template: "conocer_alguna_propiedad",
    },
    {
      re: /rese[nñ]a|google\s+maps|calificar\s+en\s+google|dejar\s+una\s+rese/i,
      template: "fidelizacion_y_comentario_de_google",
    },
    {
      re: /eleg[ií]\s+(una\s+)?finca|seleccion(e|é)\s+(una\s+)?(del\s+)?cat[aá]logo|una\s+de\s+las\s+fincas\s+del\s+cat/i,
      template: "al_momento_de_seleccionar_una_de_las_fincas_del_catalogo",
    },
  ];

  for (const { re, template } of rules) {
    if (re.test(ascii) || re.test(msg)) {
      const p = pick(template);
      if (p) {
        console.log("[template-routing] match por palabras clave:", template);
        return p;
      }
    }
  }

  const trim = ascii.trim();
  const shortMsg = trim.length < 160;
  const looksLikeGreeting =
    /^(hola|holaa|hey|buenos|buenas|buen\s+d[ií]a|qu[eé]\s+tal|saludos|hi)\b/i.test(
      trim
    ) ||
    /^(info|informaci[oó]n|quiero\s+(una\s+)?finca|busco\s+(una\s+)?finca|necesito\s+finca|me\s+ayudas|ayuda)\b/i.test(
      trim
    );
  if (shortMsg && looksLikeGreeting) {
    const preferred =
      process.env.YCLOUD_WELCOME_TEMPLATE_NAME?.trim() || "bienvenida_hernan";
    const order = [preferred, "bienvenida_hernan", "bienvenida"];
    const seenNames = new Set<string>();
    for (const n of order) {
      if (seenNames.has(n)) continue;
      seenNames.add(n);
      const p = pick(n);
      if (p) {
        console.log("[template-routing] saludo o consulta genérica →", n);
        return p;
      }
    }
  }

  return null;
}

/**
 * Envía un mensaje de plantilla HSM (sin componentes variables).
 */
export const sendWhatsAppTemplateMessage = internalAction({
  args: {
    to: v.string(),
    templateName: v.string(),
    language: v.string(),
    wamid: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    const apiKey = process.env.YCLOUD_API_KEY;
    const wabaNumber = process.env.YCLOUD_WABA_NUMBER;
    if (!apiKey || !wabaNumber) {
      throw new Error(
        "YCLOUD_API_KEY y YCLOUD_WABA_NUMBER deben estar configurados en Convex"
      );
    }
    const baseBody: Record<string, unknown> = {
      from: wabaNumber,
      to: args.to,
      type: "template",
      template: {
        name: args.templateName,
        language: { code: args.language },
      },
    };

    const post = (body: Record<string, unknown>) =>
      fetch(YCLOUD_SEND_DIRECTLY, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": apiKey,
        },
        body: JSON.stringify(body),
      });

    // Muchas integraciones fallan si se mezcla plantilla con context (reply); probamos sin context primero.
    let res = await post(baseBody);
    let textRes = await res.text();
    if (!res.ok && args.wamid) {
      const withCtx = {
        ...baseBody,
        context: { message_id: args.wamid },
      };
      res = await post(withCtx);
      textRes = await res.text();
    }
    if (!res.ok) {
      throw new Error(`YCloud template error: ${res.status} - ${textRes}`);
    }
    return JSON.parse(textRes) as Record<string, unknown>;
  },
});

/**
 * Elige una plantilla YCloud aprobada que encaje con la consulta, o NONE para seguir con RAG.
 */
export const selectWhatsappTemplateWithAI = internalAction({
  args: {
    userMessage: v.string(),
    conversationSnippet: v.string(),
    templatesJson: v.string(),
  },
  handler: async (_ctx, args): Promise<{ name: string; language: string } | null> => {
    const { text: modelText } = await generateText({
      model: openai.chat(CONVEX_OPENAI_CHAT_MODEL),
      temperature: 1,
      system: `Eres un enrutador para WhatsApp.
Decides si el mensaje encaja con UNA plantilla de la lista (preguntas frecuentes con respuesta fija).
Cada ítem tiene "hint": palabras clave del tema (no es el texto de la plantilla).

Responde SOLO JSON válido, sin markdown:

{"choice":"NONE"}

o

{"choice":"TEMPLATE","name":"<nombre_exacto>","language":"<idioma_exacto>"}

Reglas:
- TEMPLATE: cualquier mensaje que encaje con una plantilla de la lista (nombre + hint), incluidas **bienvenida** para saludos genéricos.
- TEMPLATE: preguntas de política/FAQ (mascotas, check-in, cobro por persona, contrato, proceso de pago, etc.).
- NONE: SI EL USUARIO RESPONDE DANDO FECHAS (ej. "del 27 al 30 de marzo", "el próximo fin de semana") o CANTIDAD DE PERSONAS (ej. "para 2 personas", "somos 5 adultos"). El RAG debe encargarse de esto, NO envíes plantillas en respuestas de cotización o recolección de datos de reserva.
- NONE: mensaje con ubicación + fechas + personas para buscar catálogo, elige una finca por nombre concreto, envía datos personales para contrato, o ninguna plantilla encaja.
- Si encajan dos plantillas por igual → NONE.
- "name" y "language" deben ser idénticos a un elemento de la lista.`,
      prompt: `Plantillas disponibles (JSON, cada una: name, language, hint):
${args.templatesJson}

Historial breve:
${args.conversationSnippet || "(vacío)"}

Mensaje actual:
${args.userMessage}`,
    });

    try {
      const raw = modelText
        .trim()
        .replace(/^```json\s*|^```\s*|\s*```$/g, "")
        .trim();
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (parsed.choice !== "TEMPLATE") return null;
      const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
      const language =
        typeof parsed.language === "string" ? parsed.language.trim() : "";
      if (!name || !language) return null;
      return { name, language };
    } catch (err) {
      console.error(
        "selectWhatsappTemplateWithAI parse error:",
        err,
        modelText
      );
      return null;
    }
  },
});

/**
 * Clasifica la intención del mensaje para resolver plantillas rápidas guardadas en BD.
 */
export const selectQuickReplyIntentWithAI = internalAction({
  args: {
    userMessage: v.string(),
    conversationSnippet: v.string(),
    intentsJson: v.string(),
    isReactivated: v.optional(v.boolean()),
  },
  handler: async (_ctx, args): Promise<{ intentKey: string } | null> => {
    const returningClientNote = args.isReactivated
      ? `\n- IMPORTANTE: Este cliente ya tuvo una conversación previa con FincasYa. Si el mensaje parece un saludo o retoma la conversación, NO uses plantillas de bienvenida inicial. Usa en cambio la plantilla de "continuación" (si existe) o responde NONE para que el agente retome con mensaje de seguimiento.`
      : "";
    const { text: modelText } = await generateText({
      model: openai.chat(CONVEX_OPENAI_CHAT_MODEL),
      temperature: 1,
      system: `Eres un clasificador que selecciona plantillas de WhatsApp SOLO para respuestas operacionales y de política fija (mascotas, check-in, proceso de pago, contrato, propietario, fuera de horario, etc.).
Responde SOLO JSON válido:
{"intentKey":"<intent_key_exacto>"} o {"intentKey":"NONE"}.

Reglas críticas:
- NONE para saludos, solicitudes de info general, cotizaciones o recopilación de datos — el agente responde de forma conversacional y natural, NO con plantillas.
- NONE si el cliente pide ver fincas, preguntar disponibilidad, o dar datos de fechas/personas/destino.
- NONE si el historial ya tiene contexto de reserva activa (finca, fechas, personas).
- Solo elige una plantilla si la pregunta del cliente es específicamente sobre políticas fijas: mascotas, check-in/out, formas de pago, proceso de reserva, horario de atención, personal de servicio.
- Si hay ambigüedad, responde NONE.
- NUNCA uses plantillas de "cotiza", "indicaciones" ni "continuación" — esas son guías para el agente, no para enviar verbatim.${returningClientNote}`,
      prompt: `Intenciones disponibles:
${args.intentsJson}

Historial breve:
${args.conversationSnippet || "(vacío)"}

Mensaje actual:
${args.userMessage}`,
    });
    try {
      const raw = modelText
        .trim()
        .replace(/^```json\s*|^```\s*|\s*```$/g, "")
        .trim();
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const intentKey =
        typeof parsed.intentKey === "string" ? parsed.intentKey.trim() : "NONE";
      if (!intentKey || intentKey.toUpperCase() === "NONE") return null;
      return { intentKey };
    } catch (err) {
      console.error("selectQuickReplyIntentWithAI parse error:", err, modelText);
      return null;
    }
  },
});

export const sendWhatsAppAudioByUrl = internalAction({
  args: {
    to: v.string(),
    mediaUrl: v.string(),
    wamid: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    const apiKey = process.env.YCLOUD_API_KEY;
    const wabaNumber = process.env.YCLOUD_WABA_NUMBER;
    if (!apiKey || !wabaNumber) {
      throw new Error("YCLOUD_API_KEY y YCLOUD_WABA_NUMBER deben estar configurados en Convex");
    }
    const body: Record<string, unknown> = {
      from: wabaNumber,
      to: args.to,
      type: "audio",
      audio: { link: args.mediaUrl },
    };
    if (args.wamid) body.context = { message_id: args.wamid };
    const res = await fetch(YCLOUD_SEND_DIRECTLY, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify(body),
    });
    const textRes = await res.text();
    if (!res.ok) {
      throw new Error(`YCloud audio error: ${res.status} - ${textRes}`);
    }
    return JSON.parse(textRes) as Record<string, unknown>;
  },
});

export const maybeSendQuickReplyTemplateByIntent = internalAction({
  args: {
    phone: v.string(),
    wamid: v.optional(v.string()),
    conversationId: v.id("conversations"),
    userMessage: v.string(),
    isReactivated: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<{ sent: boolean; templateId?: string }> => {
    if (quickReplyRoutingDisabled()) {
      return { sent: false };
    }
    const templates = await ctx.runQuery(api.quickReplyTemplates.listActive, {});
    if (!templates.length) return { sent: false };

    const sendTemplate = async (template: any): Promise<{ sent: boolean; templateId?: string }> => {
      if (template.mediaType === "audio") {
        if (!template.mediaUrl) return { sent: false };
        await ctx.runAction(internal.ycloud.sendWhatsAppAudioByUrl, {
          to: args.phone,
          mediaUrl: template.mediaUrl,
          wamid: args.wamid,
        });
        await ctx.runMutation(internal.messages.insertAssistantMessageWithMedia, {
          conversationId: args.conversationId,
          content: template.content ?? "",
          type: "audio",
          mediaUrl: template.mediaUrl,
          metadata: { quickTemplateId: template._id, intentKey: template.intentKey },
          createdAt: Date.now(),
        });
        return { sent: true, templateId: template._id };
      }

      const textToSend = String(template.content || "").trim();
      if (!textToSend) return { sent: false };
      await ctx.runAction(internal.ycloud.sendWhatsAppMessage, {
        to: args.phone,
        text: textToSend,
        wamid: args.wamid,
      });
      await ctx.runMutation(internal.messages.insertAssistantMessage, {
        conversationId: args.conversationId,
        content: textToSend,
        createdAt: Date.now(),
      });
      return { sent: true, templateId: template._id };
    };

    const recent = await ctx.runQuery(api.messages.listRecent, {
      conversationId: args.conversationId,
      limit: 8,
    });
    const snippet = recent
      .map(
        (m: any) =>
          `${m.sender === "user" ? "Cliente" : "Asistente"}: ${String(m.content || "").slice(0, 220)}`
      )
      .join("\n");

    const intentMap = new Map<string, any>();
    for (const t of templates) {
      if (!intentMap.has(t.intentKey)) intentMap.set(t.intentKey, t);
    }
    const intentsPayload = JSON.stringify(
      Array.from(intentMap.values()).map((t) => ({
        intentKey: t.intentKey,
        title: t.title,
        slashCommand: t.slashCommand,
        content: String(t.content || "").slice(0, 900),
        mediaType: t.mediaType,
      }))
    );

    let selectedIntent: string | null = null;
    try {
      const selected = await ctx.runAction(internal.ycloud.selectQuickReplyIntentWithAI, {
        userMessage: args.userMessage,
        conversationSnippet: snippet,
        intentsJson: intentsPayload,
        isReactivated: args.isReactivated ?? false,
      });
      selectedIntent = selected?.intentKey ?? null;
    } catch (error) {
      console.error("selectQuickReplyIntentWithAI error:", error);
      return { sent: false };
    }

    const normalizeText = (value: string) =>
      value
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .replace(/[^\w\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    const OPENING_QUALIFICATION_TEXT =
      "Hola, gracias por comunicarte con FincasYa.com 🏡, con gusto te ayudamos a encontrar la finca ideal para tu estadía. ✨\n\n" +
      "Para poder recomendarte la mejor opción, te haremos unas preguntas rápidas. Esto nos ayuda porque algunas fincas tienen restricciones sobre cantidad de personas, tipo de evento, sonido, decoración o ingreso de invitados adicionales. ✅\n\n" +
      "¿Para cuántas personas necesitas la finca? 👥";

    const isTemplateWelcomeLike = (template: any) => {
      const meta = normalizeText(
        `${String(template.intentKey || "")} ${String(template.title || "")}`
      );
      const content = normalizeText(String(template.content || ""));
      const hasWelcomeMeta = /\b(bienvenid|saludo|inicio|welcome|apertura|informacion\s+inicial)\b/.test(
        meta
      );
      const hasOperationalSignals = /\b(salida|llegada|35\s+min|equipo|destino|recorrido|sin\s+contratiempos)\b/.test(
        content
      );
      return hasWelcomeMeta && !hasOperationalSignals;
    };

    // Selecciona la plantilla más apropiada para un saludo/apertura.
    // Orden de preferencia:
    //   1) intentKey/title que CLARAMENTE indica saludo/bienvenida (comunicarte, hernan-style NO cuenta como "saludo" genérico).
    //   2) contenido con indicios de bienvenida genérica: "comunicarte", "atencion" + "horario".
    //   3) plantillas con múltiples campos (fechas + personas + grupo + evento).
    //   4) la más larga.
    // NOTA: evitamos seleccionar plantillas de "cotizacion" específica que empiecen con "Hola, gracias por escribir..." cuando existe una más genérica "gracias por comunicarte".
    const pickRichOpeningTemplate = () => {
      const byPriority = [...templates].sort(
        (a: any, b: any) => (a.order ?? 9999) - (b.order ?? 9999)
      );

      const textTemplates = byPriority.filter(
        (t: any) =>
          t.mediaType === "text" && String(t.content || "").trim().length >= 60
      );
      if (!textTemplates.length) return null;

      const hasWelcomeMetaOnly = (t: any) => {
        const ik = normalizeText(String(t.intentKey || ""));
        const title = normalizeText(String(t.title || ""));
        const blob = `${ik} ${title}`;
        return /\b(bienvenid|saludo|inicio|welcome|apertura|atencion|informacion\s+inicial|comunicarte)\b/.test(
          blob
        );
      };

      const welcomeOnly = textTemplates.find(hasWelcomeMetaOnly);
      if (welcomeOnly) return welcomeOnly;

      const genericWelcomeByContent = textTemplates.find((t: any) => {
        const c = String(t.content || "").toLowerCase();
        return (
          (c.includes("comunicarte") || c.includes("gracias por comunicarte")) &&
          (c.includes("horario") || c.includes("brevedad"))
        );
      });
      if (genericWelcomeByContent) return genericWelcomeByContent;

      const rich = textTemplates.find((t: any) => {
        const content = String(t.content || "");
        const fieldHits = [
          /\bfecha|fechas|ingreso|salida\b/i,
          /\bpersona|personas|cupo|huesped\b/i,
          /\bgrupo|familiar|amigos|empresarial\b/i,
          /\bevento|celebracion|cumpleanos|boda\b/i,
        ].filter((re) => re.test(content)).length;
        return fieldHits >= 3;
      });
      if (rich) return rich;

      let best: any = null;
      let bestLen = 0;
      for (const t of textTemplates) {
        const c = String(t.content || "").trim();
        if (c.length > bestLen) {
          bestLen = c.length;
          best = t;
        }
      }
      return best;
    };

    if (!selectedIntent) {
      const normalizedUser = normalizeText(args.userMessage || "");
      const isOpeningGreeting =
        /^(hola|hol|holaa|holi|holis|hols|hi|hello|hey|buenos|buenas|buen dia|buen día|que tal|qué tal|saludos|informacion|información|info|me ayudas)\b/i.test(
          normalizedUser
        ) && normalizedUser.length <= 90;
      const hasAssistantHistory = recent.some((m: any) => m.sender === "assistant");

      // isReactivated=true: el cliente ya habló antes → NO enviar bienvenida desde cero aunque no haya historial visible.
      if (isOpeningGreeting && !hasAssistantHistory && !args.isReactivated) {
        console.log("[quick-template] apertura detectada, enviando onboarding comercial");
        await ctx.runAction(internal.ycloud.sendWhatsAppMessage, {
          to: args.phone,
          text: OPENING_QUALIFICATION_TEXT,
          wamid: args.wamid,
        });
        await ctx.runMutation(internal.messages.insertAssistantMessage, {
          conversationId: args.conversationId,
          content: OPENING_QUALIFICATION_TEXT,
          createdAt: Date.now(),
        });
        return { sent: true };
      }
      return { sent: false };
    }
    const selectedTemplate = templates.find((t: any) => t.intentKey === selectedIntent);
    if (!selectedTemplate) return { sent: false };

    // Para saludo inicial, siempre usar el texto fijo de apertura.
    // Esto evita variaciones por plantillas DB y garantiza un único saludo oficial.
    const normalizedUser = normalizeText(args.userMessage || "");
    const isOpeningGreeting =
      /^(hola|hol|holaa|holi|holis|hols|hi|hello|hey|buenos|buenas|buen dia|buen día|que tal|qué tal|saludos|informacion|información|info|me ayudas)\b/i.test(
        normalizedUser
      ) && normalizedUser.length <= 90;
    const hasAssistantHistory = recent.some((m: any) => m.sender === "assistant");
    // isReactivated=true: evitar bienvenida completa cuando cliente ya habló antes.
    if (isOpeningGreeting && !hasAssistantHistory && !args.isReactivated) {
      console.log("[quick-template] saludo inicial detectado, enviando saludo fijo oficial");
      await ctx.runAction(internal.ycloud.sendWhatsAppMessage, {
        to: args.phone,
        text: OPENING_QUALIFICATION_TEXT,
        wamid: args.wamid,
      });
      await ctx.runMutation(internal.messages.insertAssistantMessage, {
        conversationId: args.conversationId,
        content: OPENING_QUALIFICATION_TEXT,
        createdAt: Date.now(),
      });
      return { sent: true };
    }
    return await sendTemplate(selectedTemplate);
  },
});

/**
 * Si aplica, envía una plantilla YCloud y guarda el mensaje en la conversación (sin pasar por RAG).
 * Usa api.messages.listRecent (query público); internal.messages.listRecent no existe en este proyecto.
 */
export const maybeSendWhatsappTemplateReply = internalAction({
  args: {
    phone: v.string(),
    wamid: v.optional(v.string()),
    conversationId: v.id("conversations"),
    userMessage: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ sent: boolean; templateName?: string }> => {
    if (templateRoutingDisabled()) {
      console.log("[template-routing] desactivado por YCLOUD_TEMPLATE_ROUTING");
      return { sent: false };
    }

    if (isAffirmativeOnly(args.userMessage) || isNegativeOnly(args.userMessage)) {
      console.log(
        "[template-routing] solo afirmación/negación (sí/no); no enviar plantilla"
      );
      return { sent: false };
    }

    let routable: RoutableWhatsappTemplate[] = [];
    try {
      routable = await fetchRoutableTemplates();
    } catch (e) {
      console.error("fetchRoutableTemplates error:", e);
      return { sent: false };
    }
    if (routable.length === 0) {
      console.warn(
        "[template-routing] 0 plantillas enrutables (revisa YCLOUD_API_KEY, YCLOUD_WABA_ID, APPROVED y sin {{}} en BODY)"
      );
      return { sent: false };
    }

    const recent = await ctx.runQuery(api.messages.listRecent, {
      conversationId: args.conversationId,
      limit: 8,
    });
    const snippet = recent
      .map(
        (m: any) =>
          `${m.sender === "user" ? "Cliente" : "Asistente"}: ${m.content.slice(0, 280)}`
      )
      .join("\n");

    const templatesJson = JSON.stringify(routable);
    let picked: { name: string; language: string } | null =
      pickTemplateByKeywords(args.userMessage, routable);

    if (!picked) {
      try {
        picked = await ctx.runAction(internal.ycloud.selectWhatsappTemplateWithAI, {
          userMessage: args.userMessage,
          conversationSnippet: snippet,
          templatesJson,
        });
      } catch (e) {
        console.error("selectWhatsappTemplateWithAI error:", e);
      }
    }

    if (!picked) {
      console.log(
        "[template-routing] sin match (keywords + IA NONE o error). Plantillas enrutables:",
        routable.length
      );
      return { sent: false };
    }

    const valid = routable.some(
      (t) => t.name === picked.name && t.language === picked.language
    );
    if (!valid) {
      console.warn(
        "[template-routing] nombre/idioma inválido respecto a la lista:",
        picked
      );
      return { sent: false };
    }

    console.log("[template-routing] enviando plantilla:", picked.name, picked.language);
    try {
      await ctx.runAction(internal.ycloud.sendWhatsAppTemplateMessage, {
        to: args.phone,
        templateName: picked.name,
        language: picked.language,
        wamid: args.wamid,
      });
    } catch (e) {
      console.error("sendWhatsAppTemplateMessage error:", e);
      return { sent: false };
    }

    const pickedTemplate = routable.find(
      (t) => t.name === picked.name && t.language === picked.language
    );

    await ctx.runMutation(internal.messages.insertAssistantMessage, {
      conversationId: args.conversationId,
      content: pickedTemplate?.body || `[Plantilla WhatsApp: ${picked.name}]`,
      createdAt: Date.now(),
    });

    return { sent: true, templateName: picked.name };
  },
});

/** Ubicaciones que usan catálogo por palabra clave (ej. Tolima) se resuelven desde whatsappCatalogs.locationKeyword en la BD. */

/** Intención y datos extraídos por la IA para decidir envío de catálogo. */
export type CatalogIntent =
  | { intent: "none" }
  | { intent: "single_finca"; fincaName: string }
  | { intent: "more_options" }
  | {
      intent: "search_catalog";
      location: string;
      hasWeekend?: boolean;
      dateD1?: number;
      dateD2?: number;
      dateMonth?: number;
      minCapacity?: number;
      sortByPrice?: boolean;
      hasPets?: boolean;
    };

const ALL_LOCATIONS_CATALOG_LABEL = "varios destinos";
const MONTH_NAMES: Record<string, number> = {
  enero: 0,
  febrero: 1,
  marzo: 2,
  abril: 3,
  mayo: 4,
  junio: 5,
  julio: 6,
  agosto: 7,
  septiembre: 8,
  setiembre: 8,
  octubre: 9,
  noviembre: 10,
  diciembre: 11,
};
const MONTH_NAME_PATTERN =
  "\\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\\b";

function normalizeAsciiText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isInvalidCatalogLocation(location: string): boolean {
  const normalized = normalizeAsciiText(location);
  if (!normalized) return true;
  if (Object.prototype.hasOwnProperty.call(MONTH_NAMES, normalized)) return true;
  if (
    /^(dias?|personas?|fincas?|reservar?|reserva|noches?|una?|unos?|unas?|los|las|el|la|mascotas?|perros?|gatos?|familiar|familia|amigos|empresarial|empresa|mismo|misma)$/.test(
      normalized
    )
  ) {
    return true;
  }
  if (/^(no\s+se|no\s+sé|cualquiera|cualquier|varios?|varias?|sin\s+preferencia)$/.test(normalized)) {
    return true;
  }
  // "mayo amigos", "melgar sabado y domingo": no son municipios válidos para la API de búsqueda.
  if (
    /\s/.test(normalized) &&
    /\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|sabado|domingo|fin\s+de\s+semana)\b/i.test(
      normalized,
    )
  ) {
    return true;
  }
  return false;
}

function isAllLocationsCatalogLocation(location: string): boolean {
  return normalizeAsciiText(location) === normalizeAsciiText(ALL_LOCATIONS_CATALOG_LABEL);
}

function chooseCatalogYearAndMonth(day: number, explicitMonth?: number): {
  year: number;
  month: number;
} {
  const now = new Date();
  let year = now.getFullYear();
  let month = explicitMonth ?? now.getMonth();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  let candidate = new Date(year, month, day);
  candidate.setHours(0, 0, 0, 0);

  if (candidate.getTime() < today.getTime()) {
    if (explicitMonth != null) {
      year += 1;
    } else {
      month += 1;
      if (month > 11) {
        month = 0;
        year += 1;
      }
    }
  }

  return { year, month };
}

/**
 * Rango para búsqueda de catálogo / disponibilidad.
 * El usuario dice "del D1 al D2": D1 = primer día de estadía, D2 = **día de check-out** (se va ese día en la mañana).
 * Ej. 21 al 23 mayo → 2 noches (21–22), no 3.
 */
function buildCatalogDateRangeFromDays(
  d1: number,
  d2: number,
  explicitMonth?: number
): { fechaEntrada: number; fechaSalida: number } | null {
  if (d1 < 1 || d1 > 31 || d2 < 1 || d2 > 31) return null;
  const { year, month } = chooseCatalogYearAndMonth(d1, explicitMonth);
  const salidaMonth = d2 < d1 ? month + 1 : month;
  return {
    fechaEntrada: bogotaCalendarDateNoonMs(year, month, d1),
    fechaSalida: bogotaCalendarDateNoonMs(year, salidaMonth, d2),
  };
}

/** YYYY-MM-DD en calendario local (mismo criterio que `new Date(y,m,d)` del catálogo). */
function formatLocalYMD(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function extractDateRangeFromText(userMessage: string): {
  fechaEntrada: number;
  fechaSalida: number;
  label: string;
} | null {
  const msg = userMessage
    .trim()
    .toLowerCase()
    // Typo frecuente en chat: "16 al 18 de may" → mayo (para que el grupo opcional del mes matchee)
    .replace(/\bde\s+may\b(?![a-z])/gi, "de mayo");
  // Cuando el texto es el historial fusionado del cliente, puede contener varias
  // menciones de fechas (ej. "16 al 17 mayo" y luego "16 al 18 de mayo"). Tomamos
  // la ÚLTIMA coincidencia: las fechas más recientes del cliente reemplazan a las
  // anteriores y son las que se deben usar para el catálogo y la guarda de puentes.
  const matches = Array.from(
    msg.matchAll(
      new RegExp(
        `(?:del\\s+)?(\\d{1,2})\\s*(?:al|hasta\\s+el|hasta|a)\\s*(\\d{1,2})(?:\\s+(?:de\\s+)?${MONTH_NAME_PATTERN})?`,
        "gi"
      )
    )
  );
  if (matches.length === 0) return null;
  const dateMatch = matches[matches.length - 1];

  const d1 = parseInt(dateMatch[1], 10);
  const d2 = parseInt(dateMatch[2], 10);
  const explicitMonthName = dateMatch[3]?.toLowerCase();
  const explicitMonth =
    explicitMonthName != null ? MONTH_NAMES[explicitMonthName] : undefined;
  const range = buildCatalogDateRangeFromDays(d1, d2, explicitMonth);
  if (!range) return null;
  return {
    ...range,
    label: explicitMonthName
      ? `${d1} al ${d2} de ${explicitMonthName}`
      : `${d1} al ${d2}`,
  };
}

function extractCapacityFromText(userMessage: string): number | undefined {
  const explicit =
    userMessage.match(/(\d+)\s*(?:o\s+mas?\s+)?personas/i) ||
    userMessage.match(/para\s+(\d+)\b/i) ||
    userMessage.match(/somos\s+(\d+)\b/i) ||
    userMessage.match(/\b(\d+)\s+(?:hu[eé]spedes?|adultos?|invitados?)\b/i);
  if (explicit) return parseInt(explicit[1], 10);
  // Mensajes muy cortos del cliente como "10" o "para 10 perso..." cuando el asistente acaba de
  // preguntar por cantidad: aceptar un número bare 2..40 si aparece en una línea por sí mismo.
  const bareLine = userMessage
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^\d{1,2}$/.test(line));
  if (bareLine) {
    const n = parseInt(bareLine, 10);
    if (n >= 2 && n <= 40) return n;
  }
  return undefined;
}

function detectPetsFromText(userMessage: string): boolean | undefined {
  const lower = userMessage.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  if (/\b(sin\s+mascotas?|no\s+(llevamos|llevo|viajan|van)\s+mascotas?)\b/i.test(lower)) {
    return undefined;
  }
  return /\b(mascota|mascotas|perro|perros|gato|gatos|animal|llev[oa]\s+(mi\s+)?(perro|gato|mascota)|si\s+una|sí\s+una)\b/i.test(
    lower
  )
    ? true
    : undefined;
}

/**
 * La IA detecta la intención del usuario: ver una finca, buscar opciones (ubicación + fechas), o pedir más opciones.
 * Devuelve un objeto estructurado para que el backend ejecute la acción correcta sin depender solo de regex.
 */
export const detectCatalogIntentWithAI = internalAction({
  args: {
    userMessage: v.string(),
    conversationSnippet: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<CatalogIntent> => {
    const now = new Date();
    const month = now.getMonth();
    const year = now.getFullYear();
    const snippet = (args.conversationSnippet ?? "").trim();

    let text: string;
    try {
      const out = await generateText({
      model: openai.chat(CONVEX_OPENAI_CHAT_MODEL),
      temperature: 1,
      system: `Eres un clasificador. Del mensaje del usuario extrae la intención y datos. Responde SOLO con un JSON válido, sin markdown, sin explicación.

Reglas:
- intent: "single_finca" si pide VER o RESERVAR una finca específica por nombre (ej. "quiero ver villa green", "me gustaría reservar la finca X", "quinto la finca X", "esta es la finca que elegí"). **CRÍTICO:** Aunque el mensaje incluya fechas, personas u otros datos de reserva, si menciona un nombre de finca específico, DEBES marcarlo como "single_finca". También si es una confirmación para una finca mencionada justo antes. En fincaName pon solo el nombre de la finca en minúsculas.
- intent: "more_options" si pide otras opciones, más opciones, no le gustan, envía más, otras fincas, dame otras, "enviame las fincas", "muéstrame las fincas", "cuáles fincas".
- intent: "search_catalog" SOLO SI en el mensaje ACTUAL o en mensajes recientes del **Cliente** en el contexto aparecen **fechas explícitas de estadía** (día de entrada y día de salida, ej. "del 21 al 23 de mayo", "5 al 7 de abril", "20 al 22") **Y** menciona un municipio/ciudad (Melgar, Villeta, etc.) **Y** NO menciona una finca concreta por nombre. Si menciona una finca específica, prioriza "single_finca". Si solo da ciudad + personas + grupo/mascotas/"fin de semana" **sin** números de día de entrada y salida, devuelve "none" (el catálogo no se envía hasta tener esas fechas).
- Si el mensaje ACTUAL es solo confirmación (sí, si, ok, dale, por favor, procede, claro, listo): CASOS: (1) Si el Asistente preguntó por ver fincas en una ciudad pero el cliente **aún no ha escrito** fechas con día y día en sus mensajes → "none". (2) Si el Asistente preguntó "¿Te gustaría avanzar con la reserva?" o "¿Deseas continuar?" → "none". (3) Si el Asistente solicitó datos del contrato → "none". (4) Si el cliente ya escribió fechas explícitas en el contexto y confirma ver opciones en esa ciudad → "search_catalog" con location inferida **solo si** esas fechas aparecen en el contexto del Cliente.
- Si pregunta por métodos de pago, datos bancarios, Nequi, PSE, transferencia, firma de contrato o PDF del contrato, devuelve SIEMPRE intent "none" (no catálogo).
- intent: "none" si no aplica ninguna de las anteriores.
- hasWeekend: true si menciona "fin de semana", "sábado y domingo", "sábado", "domingo" sin fechas específicas.
- dateD1/dateD2 si menciona un rango de días específico (ej. "5 al 7 de mayo" → dateD1:5, dateD2:7).
- dateMonth: número de mes 1-12 SOLO si el usuario menciona el mes explícitamente (ej. mayo → 5). No lo inventes si no aparece.
- hasPets: true si menciona mascotas, perros, gatos, animales o cualquier animal de compañía.
- minCapacity: número de personas si lo menciona (ej. "10 personas", "máximo 10", "para 8").
- Nunca uses nombres de meses (enero, febrero, marzo, abril, mayo, etc.) como location. Si el usuario solo da fechas/personas y no municipio, devuelve "none".

Contexto reciente (líneas Cliente/Asistente). Si está vacío, ignóralo:
${snippet || "(vacío)"}

Ejemplos de salida:
{"intent":"single_finca","fincaName":"villa green"}
{"intent":"more_options"}
{"intent":"none"}
{"intent":"search_catalog","location":"melgar","dateD1":21,"dateD2":23,"dateMonth":5,"minCapacity":10,"hasPets":true}
{"intent":"search_catalog","location":"restrepo","dateD1":20,"dateD2":21,"dateMonth":5,"minCapacity":10}

Ejemplos con confirmación:
Contexto: "Cliente: melgar del 10 al 12 de junio 8 personas | Asistente: ¿Te muestro opciones? | Cliente: Si por favor" → {"intent":"search_catalog","location":"melgar","dateD1":10,"dateD2":12,"dateMonth":6,"minCapacity":8}
Contexto: "Asistente: Perfecto, ¿te gustaría que te muestre las fincas en Villeta? | Cliente: Si por favor" → {"intent":"none"}
Contexto: "Asistente: ¿Te gustaría avanzar con la reserva? | Cliente: Si" → {"intent":"none"}
Contexto: "Asistente: Para elaborar el contrato necesito tus datos... | Cliente: Sí claro" → {"intent":"none"}

Mes actual: ${month + 1}, año: ${year}.`,
      prompt: args.userMessage,
    });
      text = out.text;
    } catch (e) {
      console.error("detectCatalogIntentWithAI: fallo del modelo o respuesta inválida:", e);
      return { intent: "none" };
    }

    try {
      const raw = text.trim();
      const parsed = tryParseCatalogIntentJson(raw);
      if (!parsed) throw new Error("catalog intent JSON no parseable");
      const intent = parsed.intent as string | undefined;
      if (intent === "single_finca" && typeof parsed.fincaName === "string" && parsed.fincaName.trim()) {
        return { intent: "single_finca", fincaName: (parsed.fincaName).trim() };
      }
      if (intent === "more_options") return { intent: "more_options" };
      if (intent === "search_catalog" && typeof parsed.location === "string" && parsed.location.trim()) {
        const loc = normalizeCatalogLocation(
          (parsed.location).replace(/[^\wáéíóúñ\s]/gi, "").trim()
        );
        if (loc.length >= 2) {
          return {
            intent: "search_catalog",
            location: loc,
            hasWeekend: parsed.hasWeekend === true,
            dateD1: typeof parsed.dateD1 === "number" ? parsed.dateD1 : undefined,
            dateD2: typeof parsed.dateD2 === "number" ? parsed.dateD2 : undefined,
            dateMonth: typeof parsed.dateMonth === "number" ? parsed.dateMonth : undefined,
            minCapacity: typeof parsed.minCapacity === "number" ? parsed.minCapacity : undefined,
            sortByPrice: parsed.sortByPrice === true,
            hasPets: parsed.hasPets === true,
          };
        }
      }
    } catch {
      // Si falla el parse, devolver none y el flujo usará regex como respaldo
    }
    return { intent: "none" };
  },
});

/**
 * Parsea si el usuario pide ver una finca concreta por nombre (ej. "quiero ver la finca de villa green").
 * Devuelve el término de búsqueda o null.
 */
function parseSingleFincaRequest(userMessage: string): string | null {
  const msg = userMessage.trim();
  if (msg.length < 4) return null;
  const lower = msg.toLowerCase();
  // Frases genéricas por destino: deben seguir flujo de catálogo múltiple.
  if (
    /\bver\s+las\s+fincas\b/i.test(lower) ||
    /\bmostrar\s+las\s+fincas\b/i.test(lower) ||
    /\bfincas\s+de\s+[a-záéíóúñ]/i.test(lower) ||
    /\bquiero\s+ver\s+fincas\b/i.test(lower)
  ) {
    return null;
  }
  const patterns = [
    /(?:quiero\s+)?(?:ver|mostrar)\s+(?:la\s+)?(?:finca\s+)?(?:de\s+)?([a-záéíóúñ0-9\s#]+)/i,
    /(?:la\s+)?finca\s+(?:de\s+)?([a-záéíóúñ0-9\s#]+)/i,
  ];
  for (const re of patterns) {
    const m = msg.match(re);
    if (m) {
      const term = m[1].trim();
      if (term.length < 2 || /^(la|el|de|una?)$/i.test(term)) continue;
      if (/\bfincas?\b/i.test(term) || /\bopciones?\b/i.test(term)) continue;
      return term;
    }
  }
  return null;
}

/**
 * Parsea ubicación y fechas del mensaje del usuario (ej. "para restrepo del 20 al 21 para 10 personas").
 * Devuelve null si no se puede extraer al menos ubicación y dos días.
 */
function parseLocationAndDates(userMessage: string): {
  location: string;
  fechaEntrada: number;
  fechaSalida: number;
  minCapacity?: number;
  sortByPrice?: boolean;
  hasPets?: boolean;
} | null {
  const msg = userMessage.trim().toLowerCase();
  const STOP_WORDS_LD = /^(una?|unas?|unos?|la|el|las|los|esa?|ese|eso|esta?|esto|mi|tu|su|que|como|donde|aqui|alli|alla|dos|tres|mas|maximo|minimo|amigos|familia|reunion|evento)$/i;
  const dateRange = extractDateRangeFromText(msg);
  // Intentar múltiples patrones de ubicación, priorizando más específicos
  const locCandidatesLD = [
    msg.match(/para\s+([a-záéíóúñ]{4,})(?:\s+del\s|\s+para\s|\s+\d|,|$)/i),
    msg.match(/(?:en|de)\s+([a-záéíóúñ]{4,})(?:\s+del\s|\s+para\s|\s+\d|,|$)/i),
    msg.match(/(?:en|de)\s+([a-záéíóúñ\s]+?)(?:\s+del\s|\s+para\s|\s+\d|\s+una|\s+la|,|$)/i),
    msg.match(/(?:para)\s+([a-záéíóúñ\s]+?)(?:\s+del\s|\s+para\s|\s+\d|$)/i),
  ];
  let location = "";
  for (const m of locCandidatesLD) {
    if (!m) continue;
    const candidate = m[1].trim().replace(/\s+/g, " ");
    if (candidate.length < 3) continue;
    if (STOP_WORDS_LD.test(candidate)) continue;
    if (isInvalidCatalogLocation(candidate)) continue;
    if (/\b(dias?|personas?|fincas?|reservar?|noches?)\b/i.test(candidate)) continue;
    location = candidate;
    break;
  }
  if (!location || !dateRange) return null;
  const minCapacity = extractCapacityFromText(msg);
  const sortByPrice = /\b(buen\s+precio|económico|económicas|barato|barata)\b/i.test(msg);
  const hasPets = detectPetsFromText(msg);
  return {
    location,
    fechaEntrada: dateRange.fechaEntrada,
    fechaSalida: dateRange.fechaSalida,
    minCapacity,
    sortByPrice,
    hasPets,
  };
}

/** Próximo fin de semana: sábado 00:00 a lunes 00:00 (2 noches). */
function getNextWeekendDates(): { fechaEntrada: number; fechaSalida: number } {
  const now = new Date();
  const day = now.getDay(); // 0 = domingo, 6 = sábado
  let daysUntilSaturday = (6 - day + 7) % 7;
  if (daysUntilSaturday === 0 && now.getHours() >= 12) daysUntilSaturday = 7;
  const sat = new Date(now);
  sat.setDate(sat.getDate() + daysUntilSaturday);
  sat.setHours(0, 0, 0, 0);
  const mon = new Date(sat);
  mon.setDate(mon.getDate() + 2);
  return { fechaEntrada: sat.getTime(), fechaSalida: mon.getTime() };
}

/**
 * Parsea búsqueda con "fin de semana"/"sábado y domingo", "X personas", "en [ubicación]", "buen precio".
 * Ej: "Estoy buscando en Melgar una Finca para 12 personas ... fin de semana ... buen precio"
 * Ej: "quiero reservar en villavicencio para 10 personas el sábado y domingo"
 */
function parseSearchFilters(userMessage: string): {
  location: string;
  fechaEntrada: number;
  fechaSalida: number;
  minCapacity?: number;
  sortByPrice?: boolean;
  hasPets?: boolean;
} | null {
  const msg = userMessage.trim().replace(/\s+/g, " ");
  const lower = msg.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  const hasWeekendRef = /\b(fin\s+de\s+semana|este\s+fin|proximo\s+fin|el\s+fin\s+de\s+semana|sabado\s+y\s+domingo|sabado|domingo)\b/i.test(lower);
  if (!hasWeekendRef) return null;
  const weekend = getNextWeekendDates();
  // Ubicación: "en X" o "buscando en X"; X puede llevar emojis (ej. ✨MELGAR). Limpiamos después.
  // Intentar múltiples patrones de ubicación, priorizando "para [city]" que es más fiable
  const locCandidates = [
    lower.match(/para\s+([a-z\u00e1\u00e9\u00ed\u00f3\u00fa\u00f1]{4,})(?:\s+para\s|\s+del\s|\s+\d|,|\s+este|\s+el\s|$)/i),
    lower.match(/en\s+([a-z\u00e1\u00e9\u00ed\u00f3\u00fa\u00f1]{4,})(?:\s+para\s|\s+del\s|\s+\d|,|\s+este|\s+el\s|$)/i),
    lower.match(/(?:buscando\s+)?en\s+(.+?)(?:\s+una|\s+finca|,|\s+para\s+\d|$)/s),
    lower.match(/(?:para|en)\s+(.+?)(?:\s+una|\s+finca|,|\s+grupo|$)/s),
  ];
  const STOP_WORDS = /^(una?|unas?|unos?|la|el|las|los|esa?|ese|eso|esta?|esto|mi|tu|su|que|como|donde|aqui|alli|alla|dos|tres|mas|maximo|minimo|amigos|familia|reunion|evento)$/i;
  let location = "";
  for (const m of locCandidates) {
    if (!m) continue;
    const candidate = m[1].replace(/[^\w\u00e1\u00e9\u00ed\u00f3\u00fa\u00f1\s]/gi, "").trim().replace(/\s+/g, " ");
    if (candidate.length < 3) continue;
    if (STOP_WORDS.test(candidate)) continue;
    if (isInvalidCatalogLocation(candidate)) continue;
    if (/\b(dias?|personas?|fincas?|reservar?|noches?|sabado|domingo|fin)\b/i.test(candidate)) continue;
    location = candidate;
    break;
  }
  if (!location) return null;
  const minCapacity = extractCapacityFromText(lower);
  const sortByPrice = /\b(buen\s+precio|economico|economicas|barato|barata)\b/i.test(lower);
  const hasPets = detectPetsFromText(lower);
  return {
    location,
    fechaEntrada: weekend.fechaEntrada,
    fechaSalida: weekend.fechaSalida,
    minCapacity,
    sortByPrice,
    hasPets,
  };
}

/**
 * Cuando el cliente no sabe el destino, permite usar fechas + cupo para buscar
 * disponibilidad en varios municipios en vez de inventar una ubicación.
 */
function parseSearchFiltersWithoutLocation(userMessage: string): {
  location: string;
  fechaEntrada: number;
  fechaSalida: number;
  minCapacity?: number;
  sortByPrice?: boolean;
  hasPets?: boolean;
} | null {
  const lower = userMessage.trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  const dateRange = extractDateRangeFromText(userMessage);
  const hasWeekendRef = /\b(fin\s+de\s+semana|este\s+fin|proximo\s+fin|el\s+fin\s+de\s+semana|sabado\s+y\s+domingo|sabado|domingo)\b/i.test(
    lower
  );
  const minCapacity = extractCapacityFromText(lower);
  if (!minCapacity) return null;

  let fechaEntrada: number;
  let fechaSalida: number;
  if (dateRange) {
    fechaEntrada = dateRange.fechaEntrada;
    fechaSalida = dateRange.fechaSalida;
  } else if (hasWeekendRef) {
    const weekend = getNextWeekendDates();
    fechaEntrada = weekend.fechaEntrada;
    fechaSalida = weekend.fechaSalida;
  } else {
    return null;
  }

  const sortByPrice = /\b(buen\s+precio|economico|economicas|barato|barata)\b/i.test(lower);
  const hasPets = detectPetsFromText(userMessage);
  return {
    location: ALL_LOCATIONS_CATALOG_LABEL,
    fechaEntrada,
    fechaSalida,
    minCapacity,
    sortByPrice,
    hasPets,
  };
}

function detectOtrasOpciones(userMessage: string): boolean {
  const lower = userMessage.trim().toLowerCase();
  return (
    /\b(otras\s+opciones|más\s+opciones|no\s+me\s+gustan|envía\s+más|otras\s+fincas|dame\s+otras|quiero\s+ver\s+otras)\b/i.test(lower) ||
    /^otras$|^más$|^más\s+opciones$/i.test(lower)
  );
}

/** Corrige errores típicos de escritura en ubicaciones (búsqueda / catálogo). */
function normalizeCatalogLocation(location: string): string {
  const t = location.trim().toLowerCase().replace(/\s+/g, " ");
  if (t === "mergal" || t === "mergal tolima") return "melgar";
  return location.trim().replace(/\s+/g, " ");
}


/** Pregunta por catálogo / opciones (sí debe poder usar contexto fusionado de mensajes anteriores). */
function asksFincasOrCatalogInMessage(userMessage: string): boolean {
  const lower = userMessage.trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  if (
    /\b(qu[eé]\s+fincas|qu[eé]\s+opciones|fincas\s+tienes|tienen\s+fincas|hay\s+fincas|ver\s+(las\s+)?opciones|m[aá]s\s+opciones|el\s+cat[aá]logo|un\s+cat[aá]logo|mostrar(me)?\s+(las\s+)?opciones|envi[aá](me)?\s+(las\s+)?fincas|fincas\s+disponibles|mu[eé]stra(me)?\s+(las\s+)?fincas|ver\s+(las\s+)?fincas|quiero\s+ver\s+(las\s+)?opciones|todas\s+las\s+(opciones|fincas)\s+disponibles)\b/i.test(
      lower
    )
  ) {
    return true;
  }
  // "dime qué precios / qué fincas hay / fincas disponibles" (no coincide el regex largo de arriba)
  if (/\b(cu[aá]l(es)?|qu[eé])\s+.{0,8}\b(precios?|tarifas?|opciones?|fincas?)\b/i.test(lower)) {
    return true;
  }
  if (
    /\b(dime|indicame|cu[eé]ntame|mu[eé]strame|puedes\s+(decir|dar)|quiero\s+saber)\b/i.test(lower) &&
    /\b(fincas?|precios?|opciones?|cat[aá]logo|disponib)\b/i.test(lower)
  ) {
    return true;
  }
  if (/\b(precios?|tarifas?)\b/i.test(lower) && /\b(fincas?|disponib|opciones?)\b/i.test(lower)) {
    return true;
  }
  if (/\b(fincas?|opciones?)\b/i.test(lower) && /\b(disponib|precios?)\b/i.test(lower)) {
    return true;
  }
  if (/^cat[aá]logo\s*[!?.¡¿]*$/i.test(lower.trim())) return true;
  return false;
}

/**
 * Mensaje de seguimiento solo con fechas/cupo (sin ubicación en este turno), p.ej. "fin de semana y 12 personas".
 * No usar para fusionar historial si parece pago/contrato (lo filtra el caller).
 */
function messageLooksLikeDateCapacityFollowup(userMessage: string): boolean {
  const lower = userMessage.trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  const hasWeekend = /\b(fin\s+de\s+semana|este\s+fin|pr[oó]ximo\s+fin|el\s+fin\s+de\s+semana|sabado\s+y\s+domingo|sabado|domingo)\b/i.test(
    lower
  );
  const hasPersonas = /\b\d+\s*(?:o\s+mas?\s+)?personas\b/i.test(lower);
  return hasWeekend && hasPersonas;
}

/** Respuesta corta típica tras la pregunta evento vs descanso (catálogo debe fusionar el hilo). */
function messageLooksLikeDescansoEventShortReply(userMessage: string): boolean {
  const t = normalizeAsciiText(userMessage).trim();
  if (t.length > 96) return false;
  return /\b(solo\s+)?descans(ar|o)?\b|\bsin\s+evento\b|\bno\s+(hay\s+)?evento\b|\bpara\s+descansar\b|\bcompartir\s+nomas?\b|\bsolo\s+compartir\b|\bsolo\s+familiar\b|\bno\s+evento\b/i.test(
    t,
  );
}

function messageLooksLikePetAnswer(userMessage: string): boolean {
  const lower = normalizeAsciiText(userMessage);
  if (!lower || lower.length > 80) return false;
  return (
    /\b(mascotas?|perros?|gatos?)\b/i.test(lower) ||
    /^(si|sí|sii|claro|correcto|una|uno|un|1|dos|2|tres|3|no|sin\s+mascotas?)\b/i.test(lower)
  );
}

/**
 * No reenviar catálogo de varias fincas: pago, bancos, contrato, etc.
 * Evita que un merge del historial reactive Melgar+finde cuando el usuario ya va por cierre.
 */
function shouldBlockCatalogMultiFincaSearch(userMessage: string): boolean {
  const lower = userMessage
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  if (!lower) return false;

  // 1) Mensajes claros de pago / contrato / firma -> bloquear búsqueda.
  const paymentOrContract =
    /\b(m[eé]todos?\s+de\s+pago|medios?\s+de\s+pago|como\s+pago|c[oó]mo\s+pagar|formas?\s+de\s+pago|aceptan\s+(tarjeta|nequi|pse)|\bpse\b|\bnequi\b|bancari|transferencia|consignaci[oó]n|datos\s+bancar|cuenta(s)?\s+bancar|n[uú]mero\s+de\s+cuenta|abono|saldo\s+(pendiente|restante)|contrato(\s+de)?\s+arrend|firm(ar|e|o)\s+(el\s+)?contrato|pdf\s+del\s+contrato)\b/.test(
      lower
    ) ||
    /\b(qu[eé]\s+metodos|cu[aá]les\s+son\s+los\s+pagos|donde\s+pago|a\s+donde\s+consigno|puedo\s+pagar)\b/.test(
      lower
    );
  if (paymentOrContract) return true;

  // 2) Respuestas de seguimiento a preguntas sobre mascotas/servicio: SOLO si el mensaje
  //    es corto y NO trae intención clara de reserva/búsqueda. Un mensaje como
  //    "quiero reservar una finca para villavicencio para 10 personas va a llevar dos perros"
  //    debe seguir disparando catálogo aunque mencione "perros".
  const followUpKeyword =
    /\b(mascotas?|perros?|personal|servicio|empleada|convivencia|requerimientos|sonido|decoracion)\b/i.test(
      lower
    );
  if (!followUpKeyword) return false;

  const bookingIntent =
    /\b(reservar|reserva|alquilar|alquilo|arrendar|cotizar|cotizaci[oó]n|opciones|fincas?|quiero\s+una\s+finca|busco|necesito)\b/i.test(
      lower
    );
  const hasDates =
    /\b(\d{1,2}\s*(al|hasta)\s*\d{1,2}|fin\s+de\s+semana|s[aá]bado|domingo|semana\s+santa|puente)\b/i.test(
      lower
    );
  const hasPersons = /\b(\d+)\s*personas|para\s+\d+/i.test(lower);
  const hasLocation = /\b(para|en)\s+[a-záéíóúñ]{3,}/i.test(lower);

  const looksLikeFollowUpOnly = lower.length < 60 && !bookingIntent && !hasDates && !hasPersons && !hasLocation;
  return looksLikeFollowUpOnly;
}

/** Datos tipo formulario de contrato (correo + varios números); no disparar búsqueda de catálogo. */
function looksLikeContractDataSubmission(userMessage: string): boolean {
  const t = userMessage.trim();
  if (!/@\S+\.\S+/.test(t)) return false;
  const digits = (t.match(/\d/g) ?? []).length;
  return digits >= 10;
}

/**
 * Si el usuario pide ver una finca concreta por nombre (ej. "quiero ver la finca de villa green"),
 * busca esa finca, obtiene su product_retailer_id en el catálogo por defecto y envía esa ficha del catálogo.
 * Devuelve { sent: true, fincaTitle } cuando envió la ficha, para que el texto de respuesta sea corto y no pida fechas.
 */
export const maybeSendSingleFincaCatalogForUserMessage = internalAction({
  args: {
    phone: v.string(),
    conversationId: v.id("conversations"),
    userMessage: v.string(),
    wamid: v.optional(v.string()),
    /** Si la IA ya detectó el nombre de la finca, usarlo en lugar de parsear del mensaje. */
    extractedFincaName: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ sent: boolean; fincaTitle?: string }> => {
    const potentialPetFilterAnswer = messageLooksLikePetAnswer(args.userMessage);
    if (
      (shouldBlockCatalogMultiFincaSearch(args.userMessage) && !potentialPetFilterAnswer) ||
      looksLikeContractDataSubmission(args.userMessage)
    ) {
      return { sent: false };
    }

    const searchTerm = args.extractedFincaName?.trim() || parseSingleFincaRequest(args.userMessage);
    if (!searchTerm) {
      console.log("[single-finca] no se encontró término de búsqueda en mensaje ni extracción IA");
      return { sent: false };
    }
    console.log("[single-finca] buscando:", searchTerm);

    const fincaToSend = await ctx.runQuery(api.fincas.findBySearchTerm, {
      term: searchTerm,
    });
    if (!fincaToSend) {
      console.log("[single-finca] sin resultados para:", searchTerm, "abortando");
      return { sent: false };
    }

    // Evitar reenvío de la misma ficha cuando el usuario solo confirma "esa misma".
    const recent = await ctx.runQuery(api.messages.listRecent, {
      conversationId: args.conversationId,
      limit: 14,
    });
    const normalize = (value: string) =>
      value
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .replace(/[^\w\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    const targetTitle = normalize(fincaToSend.title);
    const targetSlug = (fincaToSend.slug || fincaToSend.code || fincaToSend._id) as string;
    const alreadySentSameFinca = recent.some((m: any) => {
      if (m.sender !== "assistant" || m.type !== "product") return false;
      const metaProduct = m.metadata?.product;
      if (!metaProduct) return false;
      const sameSlug = String(metaProduct.slug || "").trim() === String(targetSlug).trim();
      const sameTitle = normalize(String(metaProduct.title || "")) === targetTitle;
      return sameSlug || sameTitle;
    });
    const isReservationConfirmation =
      isAffirmativeOnly(args.userMessage) ||
      /\b(esa\s+misma|la\s+misma|quiero\s+reservarla?|reservarla|confirmo|si\s+esa)\b/i.test(
        args.userMessage
      );
    if (alreadySentSameFinca && isReservationConfirmation) {
      console.log("[single-finca] misma finca ya enviada; no se reenvía ficha", {
        finca: fincaToSend.title,
      });
      return { sent: false, fincaTitle: fincaToSend.title };
    }

    const catalog = await ctx.runQuery(api.whatsappCatalogs.getDefault, {});
    if (!catalog) {
      console.log("[single-finca] sin catálogo por defecto, abortando");
      return { sent: false };
    }

    console.log("[single-finca] finca seleccionada:", fincaToSend.title);

    const productEntries = await ctx.runQuery(
      api.propertyWhatsAppCatalog.getProductRetailerIdsForProperties,
      { catalogId: catalog._id, propertyIds: [fincaToSend._id] }
    );

    let productRetailerIdToUse: string;
    if (productEntries.length > 0) {
      productRetailerIdToUse = productEntries[0].productRetailerId;
    } else {
      // Fallback: use Convex ID directly — works when the finca was synced to Meta with its Convex ID.
      console.log("[single-finca] sin product entries para", fincaToSend.title, "usando ID directo como fallback");
      productRetailerIdToUse = fincaToSend._id;
    }

    await ctx.runAction(internal.ycloud.sendWhatsAppCatalogList, {
      to: args.phone,
      productRetailerIds: [productRetailerIdToUse],
      bodyText: `Aquí está ${fincaToSend.title} 🏡`,
      catalogId: catalog.whatsappCatalogId,
      wamid: args.wamid,
    });

    // Obtener la primera imagen para los metadatos
    const firstImage = await ctx.runQuery(api.fincas.getPropertyImage, { 
      propertyId: fincaToSend._id 
    });

    await ctx.runMutation(internal.messages.insertAssistantMessageWithMedia, {
      conversationId: args.conversationId,
      content: `Catálogo enviado: ${fincaToSend.title}`,
      type: "product",
      metadata: {
        product: {
          title: fincaToSend.title,
          image: firstImage?.url || "",
          price: fincaToSend.priceBase,
          slug: fincaToSend.slug || fincaToSend.code || fincaToSend._id,
        }
      },
      createdAt: Date.now(),
    });
    return { sent: true, fincaTitle: fincaToSend.title };
  },
});

const CATALOG_LIMIT = 30;
/** Cuántas fichas de catálogo enviar por separado (mensajes interactive type product, no product_list). */
const CATALOG_SEND_BATCH = 8;

/**
 * Si el mensaje incluye ubicación + fechas concretas (día al día, con o sin mes) o pide "otras opciones"
 * reutilizando un catálogo ya enviado con fechas válidas, busca fincas y envía hasta CATALOG_SEND_BATCH fichas.
 * No infiere "próximo fin de semana" para armar el catálogo: sin fechas explícitas del usuario no se envía.
 */
export const maybeSendCatalogForUserMessage = internalAction({
  args: {
    conversationId: v.id("conversations"),
    phone: v.string(),
    userMessage: v.string(),
    wamid: v.optional(v.string()),
    /** Si la IA ya detectó intención y datos, usarlos en lugar de regex. */
    catalogIntent: v.optional(
      v.union(
        v.object({ intent: v.literal("more_options") }),
        v.object({
          intent: v.literal("search_catalog"),
          location: v.string(),
          hasWeekend: v.optional(v.boolean()),
          dateD1: v.optional(v.number()),
          dateD2: v.optional(v.number()),
          dateMonth: v.optional(v.number()),
          minCapacity: v.optional(v.number()),
          sortByPrice: v.optional(v.boolean()),
          hasPets: v.optional(v.boolean()),
        })
      )
    ),
  },
  returns: v.object({
    sent: v.boolean(),
    location: v.optional(v.string()),
    fincasCount: v.optional(v.number()),
    fincasFoundButNoCatalog: v.optional(v.boolean()),
    puenteMinNightsNoticeSent: v.optional(v.boolean()),
    petsQuestionSent: v.optional(v.boolean()),
  }),
  handler: async (ctx, args): Promise<{
    sent: boolean;
    location?: string;
    fincasCount?: number;
    fincasFoundButNoCatalog?: boolean;
    puenteMinNightsNoticeSent?: boolean;
    petsQuestionSent?: boolean;
  }> => {
    const conv = await ctx.runQuery(api.conversations.getById, {
      conversationId: args.conversationId,
    });
    if (!conv) return { sent: false };

    const potentialPetFilterAnswer = messageLooksLikePetAnswer(args.userMessage);
    if (
      (shouldBlockCatalogMultiFincaSearch(args.userMessage) && !potentialPetFilterAnswer) ||
      looksLikeContractDataSubmission(args.userMessage)
    ) {
      return { sent: false };
    }

    const recentUsersForCatalog = await ctx.runQuery(api.messages.listRecent, {
      conversationId: args.conversationId,
      limit: 40,
    });
    const mergedUserTextForCatalogGuard = [
      args.userMessage,
      ...recentUsersForCatalog
        .filter((m: any) => m.sender === "user")
        .map((m: any) => String(m.content ?? "")),
    ].join("\n");

    const catalogLocationKeywords = await ctx.runQuery(api.fincas.getAllUniqueLocations, {});

    let location: string;
    let fechaEntrada: number;
    let fechaSalida: number;
    let minCapacity: number | undefined;
    let sortByPrice: boolean | undefined;
    let hasPets: boolean | undefined;
    let excludePropertyIds: Id<"properties">[] | undefined;
    let usedInferredDates = false;
    let searchAllLocations = false;

    const intent = args.catalogIntent;
    const resolvedIntentLocation =
      intent?.intent === "search_catalog" && intent.location
        ? resolveCatalogLocationForSearch(
            intent.location,
            mergedUserTextForCatalogGuard,
            catalogLocationKeywords,
          )
        : "";
    const searchCatalogIntentUsable =
      intent?.intent === "search_catalog" &&
      !!intent.location &&
      !isInvalidCatalogLocation(resolvedIntentLocation);

    if (!searchCatalogIntentUsable && intent?.intent === "search_catalog" && intent.location) {
      console.warn(
        "[catalog-guard] intent search_catalog descartado — ubicación inválida; reintento con hilo fusionado:",
        intent.location,
        "→",
        resolvedIntentLocation,
      );
    }

    if (intent?.intent === "more_options" && conv.lastCatalogSearch) {
      const last = conv.lastCatalogSearch;
      location = last.location;
      fechaEntrada = last.fechaEntrada;
      fechaSalida = last.fechaSalida;
      minCapacity = last.minCapacity;
      sortByPrice = last.sortByPrice;
      excludePropertyIds = conv.lastSentCatalogPropertyIds ?? [];
      searchAllLocations = isAllLocationsCatalogLocation(last.location);
      // Conservar preferencia de mascotas del último catálogo si aplica
      hasPets = (last as any).hasPets === true ? true : undefined;
    } else if (searchCatalogIntentUsable && intent?.intent === "search_catalog") {
      const intentLocationResolved = resolvedIntentLocation;
      const weekend = getNextWeekendDates();
      // Si la IA manda día/mes explícitos, SIEMPRE prevalecen sobre hasWeekend (evita pisar "16 al 17 mayo"
      // con "próximo fin de semana" y romper puente / conteo de noches).
      if (intent.dateD1 != null && intent.dateD2 != null) {
        let exactRangeFromText = extractDateRangeFromText(args.userMessage);
        if (!exactRangeFromText) {
          const recentUsersForIntentDates = await ctx.runQuery(api.messages.listRecent, {
            conversationId: args.conversationId,
            limit: 30,
          });
          const mergedUsersForDates = [
            args.userMessage,
            ...recentUsersForIntentDates
              .filter((m: any) => m.sender === "user")
              .map((m: any) => String(m.content ?? "")),
          ].join("\n");
          exactRangeFromText = extractDateRangeFromText(mergedUsersForDates);
        }
        const range =
          exactRangeFromText ??
          buildCatalogDateRangeFromDays(
            intent.dateD1,
            intent.dateD2,
            intent.dateMonth != null && intent.dateMonth >= 1 && intent.dateMonth <= 12
              ? intent.dateMonth - 1
              : undefined
          );
        if (!range) return { sent: false };
        fechaEntrada = range.fechaEntrada;
        fechaSalida = range.fechaSalida;
      } else {
        // La IA suele mandar hasWeekend sin día/mes en el mensaje actual ("para 10"); el rango real
        // casi siempre está en mensajes anteriores del cliente — NO usar el "próximo fin de semana"
        // genérico si ya hay "16 al 18 de mayo" en el hilo.
        const rangeFromThread = extractDateRangeFromText(mergedUserTextForCatalogGuard);
        if (rangeFromThread) {
          fechaEntrada = rangeFromThread.fechaEntrada;
          fechaSalida = rangeFromThread.fechaSalida;
        } else if (intent.hasWeekend) {
          fechaEntrada = weekend.fechaEntrada;
          fechaSalida = weekend.fechaSalida;
        } else {
          fechaEntrada = weekend.fechaEntrada;
          fechaSalida = weekend.fechaSalida;
          usedInferredDates = true;
        }
      }
      location = intentLocationResolved;
      minCapacity = intent.minCapacity;
      sortByPrice = intent.sortByPrice;
      hasPets = intent.hasPets === true ? true : undefined;
    } else if (detectOtrasOpciones(args.userMessage) && conv.lastCatalogSearch) {
      const last = conv.lastCatalogSearch;
      location = last.location;
      fechaEntrada = last.fechaEntrada;
      fechaSalida = last.fechaSalida;
      minCapacity = last.minCapacity;
      sortByPrice = last.sortByPrice;
      excludePropertyIds = conv.lastSentCatalogPropertyIds ?? [];
      searchAllLocations = isAllLocationsCatalogLocation(last.location);
      hasPets = (last as any).hasPets === true ? true : undefined;
    } else {
      let parsed =
        parseLocationAndDates(args.userMessage) ??
        parseSearchFilters(args.userMessage);
      if (!parsed) {
        // NUNCA re-disparar catálogo con "sí" / confirmación. Solo con preguntas explícitas.
        const recentMsgs = await ctx.runQuery(api.messages.listRecent, {
          conversationId: args.conversationId,
          limit: 30,
        });
        const lastAssistant = [...recentMsgs].reverse().find((m: any) => m.sender === "assistant");
        const assistantAskedPets = !!lastAssistant && /\bmascotas?|perros?|gatos?\b/i.test(
          String(lastAssistant.content ?? "")
        );
        const assistantAskedLocation = !!lastAssistant && /\b(ciudad|municipio|destino|ubicaci[oó]n|d[oó]nde)\b/i.test(
          String(lastAssistant.content ?? "")
        );
        const assistantAskedPuenteOrDates =
          !!lastAssistant &&
          /\b(puente|d[ií]a\s+festivo|estad[ií]a\s+m[ií]nima|2\s+noches|entrada\s+y\s+salida|fechas?\s+exactas?)\b/i.test(
            String(lastAssistant.content ?? ""),
          );
        const assistantAskedEventVsDescanso =
          !!lastAssistant &&
          /¿\s*Tienes\s+contemplada\s+la\s+finca\b/i.test(String(lastAssistant.content ?? ""));
        const userHasNoLocationPreference =
          assistantAskedLocation && messageLooksLikeNoLocationPreference(args.userMessage);
        const shortFunnelFollowUp =
          normalizeAsciiText(args.userMessage).length > 0 &&
          normalizeAsciiText(args.userMessage).length <= 72;
        const allowMergedUserHistory =
          asksFincasOrCatalogInMessage(args.userMessage) ||
          messageLooksLikeDateCapacityFollowup(args.userMessage) ||
          (assistantAskedPets && messageLooksLikePetAnswer(args.userMessage)) ||
          userHasNoLocationPreference ||
          !!extractDateRangeFromText(args.userMessage) ||
          (assistantAskedPuenteOrDates && !!extractDateRangeFromText(args.userMessage)) ||
          (assistantAskedEventVsDescanso && messageLooksLikeDescansoEventShortReply(args.userMessage)) ||
          (shortFunnelFollowUp &&
            !!lastAssistant &&
            /\b(personas?|mascotas?|evento|descans\w*|compartir|contemplad[ao]|tipo\s+de\s+grupo|grupo|plan)\b/i.test(
              String(lastAssistant.content ?? ""),
            ));
        if (allowMergedUserHistory) {
          // Verificar que NO estamos en flujo de cierre (cotización/contrato), salvo que el último turno sea la pregunta evento/descanso.
          const askedClosingOrContract =
            !!lastAssistant &&
            /avancemos con la reserva|elaborar tu contrato|datos de la persona/i.test(
              String(lastAssistant.content ?? ""),
            );
          const isInClosingFlow = askedClosingOrContract && !assistantAskedEventVsDescanso;
          if (!isInClosingFlow) {
            const recent = await ctx.runQuery(api.messages.listRecent, {
              conversationId: args.conversationId,
              limit: 30,
            });
            const merged = recent
              .filter((m: any) => m.sender === "user")
              .map((m: any) => m.content)
              .join("\n");
            parsed =
              parseLocationAndDates(merged) ??
              parseSearchFilters(merged) ??
              (userHasNoLocationPreference || asksFincasOrCatalogInMessage(args.userMessage)
                ? parseSearchFiltersWithoutLocation(merged)
                : null);
          }
        }
      }
      if (!parsed) return { sent: false };
      location = parsed.location;
      searchAllLocations = isAllLocationsCatalogLocation(location);
      fechaEntrada = parsed.fechaEntrada;
      fechaSalida = parsed.fechaSalida;
      minCapacity = parsed.minCapacity;
      sortByPrice = parsed.sortByPrice;
      hasPets = (parsed as any).hasPets === true ? true : undefined;
      // parseSearchFilters() devuelve "próximo fin de semana" cuando el mensaje actual habla de "fin de semana"
      // pero el cliente ya dio fechas calendario explícitas en mensajes anteriores. Sobrescribimos con
      // el último rango ("16 al 18 de mayo") para que el catálogo y la guarda de puentes usen lo correcto.
      const explicitRangeFromThread = extractDateRangeFromText(mergedUserTextForCatalogGuard);
      if (explicitRangeFromThread) {
        fechaEntrada = explicitRangeFromThread.fechaEntrada;
        fechaSalida = explicitRangeFromThread.fechaSalida;
      }
      if (minCapacity == null) {
        const capacityFromThread = extractCapacityFromText(mergedUserTextForCatalogGuard);
        if (capacityFromThread != null) minCapacity = capacityFromThread;
      }
    }

    location = resolveCatalogLocationForSearch(
      location,
      mergedUserTextForCatalogGuard,
      catalogLocationKeywords,
    );

    // No catálogo multi-finca sin rango explícito en mensajes del usuario (evita cupos "próximo fin de semana"
    // cuando aún no hay check-in/check-out reales — riesgo de mostrar fincas no disponibles para su estadía).
    const catalogRepeatOrMoreOptions =
      intent?.intent === "more_options" ||
      (detectOtrasOpciones(args.userMessage) && conv.lastCatalogSearch);
    if (!catalogRepeatOrMoreOptions) {
      if (!extractDateRangeFromText(mergedUserTextForCatalogGuard)) {
        console.log(
          "[catalog-guard] Sin fechas explícitas de estadía (ej. del 21 al 23 de mayo) — no se envía catálogo.",
        );
        return { sent: false, location };
      }
    }

    // Política de negocio actual:
    // - No bloquear catálogo por mascotas en etapa de descubrimiento.
    // - Priorizar validación de fechas/festivos y envío de catálogo.
    // - Preguntar mascotas al avanzar con una finca concreta.

    // Si el último mensaje del asistente ya fue la notificación de puente y el usuario confirma
    // con "sí / dale / por favor / ok", interpretamos que acepta extender la estadía +1 noche
    // (ej. 16–17 → 16–18 en mayo 2026) y movemos el check-out un día adelante para que la guarda
    // de puente no vuelva a dispararse y podamos enviar el catálogo con 2 noches.
    const lastAssistantMsg = [...recentUsersForCatalog]
      .reverse()
      .find((m: any) => m.sender === "assistant");
    const lastWasPuenteNotice =
      !!lastAssistantMsg &&
      /puente\s+o\s+d[ií]a\s+festivo/i.test(String(lastAssistantMsg.content ?? "")) &&
      /estad[ií]a\s+m[ií]nima\s+es\s+de\s+\*?2\s+noches/i.test(
        String(lastAssistantMsg.content ?? ""),
      );
    const normalizedUserConfirm = String(args.userMessage)
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{M}/gu, "");
    const userConfirmsSimple =
      /^(si|ok|dale|listo|claro|vale|perfecto|confirmo|por\s*favor|si\s*por\s*favor|ok\s*por\s*favor|dale\s*por\s*favor|de\s*una|si\s*claro|si\s*dale)[\s!.¡?]*$/i.test(
        normalizedUserConfirm,
      );
    if (
      lastWasPuenteNotice &&
      userConfirmsSimple &&
      shouldBlockCatalogForPuenteOneNightSatSun(
        fechaEntrada,
        fechaSalida,
        mergedUserTextForCatalogGuard,
      )
    ) {
      console.log(
        "[catalog] Cliente confirmó extensión a puente — moviendo check-out +1 día para enviar catálogo de 2 noches.",
      );
      fechaSalida = fechaSalida + 86_400_000;
    }

    // Puente / festivo: 1 noche solo sábado→domingo no cumple mínimo 2 noches — avisar antes del catálogo.
    if (
      shouldBlockCatalogForPuenteOneNightSatSun(
        fechaEntrada,
        fechaSalida,
        mergedUserTextForCatalogGuard,
      )
    ) {
      console.log(
        "[catalog-guard] Puente o festivo: estadía de 1 noche sábado–domingo — no se envía catálogo hasta mín. 2 noches.",
      );
      const promptOverrideForPuenteNotice = await ctx.runQuery(api.internalPages.getById, {
        pageId: PROMPT_INTERNAL_PAGE_ID,
      });
      const promptOverridePuenteText =
        promptOverrideForPuenteNotice &&
        typeof promptOverrideForPuenteNotice === "object" &&
        "prompt" in promptOverrideForPuenteNotice &&
        typeof (promptOverrideForPuenteNotice as { prompt?: unknown }).prompt === "string"
          ? (promptOverrideForPuenteNotice as { prompt: string }).prompt.trim()
          : "";
      const effectivePromptForPuenteNotice =
        promptOverridePuenteText.length > 0
          ? promptOverridePuenteText
          : DEFAULT_CONSULTANT_SYSTEM_PROMPT;
      const notice =
        extractQuickReplyBlock(effectivePromptForPuenteNotice, "puente catalogo guard") ||
        extractQuickReplyBlock(effectivePromptForPuenteNotice, "puente") ||
        PUENTE_ONE_NIGHT_CATALOG_NOTICE_ES;
      await ctx.runMutation(internal.messages.insertAssistantMessage, {
        conversationId: args.conversationId,
        content: notice,
        createdAt: Date.now(),
      });
      await ctx.runAction(internal.ycloud.sendWhatsAppMessage, {
        to: args.phone,
        text: notice,
        wamid: args.wamid,
      });
      return { sent: false, location, puenteMinNightsNoticeSent: true };
    }

    location = normalizeCatalogLocation(location);

    const fincas = searchAllLocations
      ? await ctx.runQuery(api.fincas.searchAvailableByDates, {
          fechaEntrada,
          fechaSalida,
          limit: CATALOG_LIMIT,
          minCapacity,
          excludePropertyIds,
          sortByPrice,
          allowsPets: hasPets,
        })
      : await ctx.runQuery(api.fincas.searchAvailableByLocationAndDates, {
          location,
          fechaEntrada,
          fechaSalida,
          limit: CATALOG_LIMIT,
          minCapacity,
          excludePropertyIds,
          sortByPrice,
          allowsPets: hasPets,
        });
    console.log("[catalog-search] location:", location, "fincas encontradas (antes de catálogo):", fincas.length);

    if (fincas.length === 0) {
      console.log("[catalog-search] 0 fincas para", location, "fechas:", new Date(fechaEntrada).toISOString(), "-", new Date(fechaSalida).toISOString());
      return { sent: false, location };
    }

    const fincasToSend = fincas.slice(0, CATALOG_SEND_BATCH);

    let chosenCatalog = await ctx.runQuery(api.whatsappCatalogs.getByLocationKeyword, {
      location,
    });
    if (!chosenCatalog) {
      console.log("[catalog-search] sin catálogo por keyword para:", location, "— buscando default");
      chosenCatalog = await ctx.runQuery(api.whatsappCatalogs.getDefault, {});
    }
    if (!chosenCatalog) {
      console.error("[catalog-search] NO hay catálogo default ni por keyword para:", location, "— no se puede enviar catálogo");
      return { sent: false, location, fincasCount: fincas.length, fincasFoundButNoCatalog: true };
    }

    let productEntries = await ctx.runQuery(
      api.propertyWhatsAppCatalog.getProductRetailerIdsForProperties,
      {
        catalogId: chosenCatalog._id,
        propertyIds: fincasToSend.map((f: any) => f._id),
      }
    );
    if (productEntries.length === 0) {
      const defaultCatalog = await ctx.runQuery(api.whatsappCatalogs.getDefault, {});
      if (defaultCatalog && defaultCatalog._id !== chosenCatalog._id) {
        chosenCatalog = defaultCatalog;
        productEntries = await ctx.runQuery(
          api.propertyWhatsAppCatalog.getProductRetailerIdsForProperties,
          { catalogId: chosenCatalog._id, propertyIds: fincasToSend.map((f: any) => f._id) }
        );
      }
    }
    // Per-finca fallback: use catalog productRetailerId if registered, else use the Convex ID.
    // This ensures ALL found fincas appear in the catalog, not just those with catalog entries.
    const catalogEntryMap = new Map(productEntries.map((e: any) => [e.propertyId as string, e.productRetailerId]));
    const productRetailerIds = fincasToSend.map((f: any) => catalogEntryMap.get(f._id) ?? (f._id as string));
    if (catalogEntryMap.size === 0) {
      console.log("[catalog-search] sin entries en propertyWhatsAppCatalog, usando IDs de Convex como fallback:", productRetailerIds.length);
    } else if (catalogEntryMap.size < fincasToSend.length) {
      console.log("[catalog-search] fallback parcial: ", catalogEntryMap.size, "con entrada,", fincasToSend.length - catalogEntryMap.size, "con ID Convex");
    }

    const recentForCatalogContext = await ctx.runQuery(api.messages.listRecent, {
      conversationId: args.conversationId,
      limit: 30,
    });
    const mergedUserDateText = [
      args.userMessage,
      ...recentForCatalogContext
        .filter((m: any) => m.sender === "user")
        .map((m: any) => String(m.content ?? "")),
    ].join("\n");
    const explicitDateRangeInChat = !!extractDateRangeFromText(mergedUserDateText);

    let catalogShowSeasonalPrices = false;
    if (!usedInferredDates) {
      const catIntent = args.catalogIntent;
      if (catIntent?.intent === "more_options") {
        catalogShowSeasonalPrices = true;
      } else if (catIntent?.intent === "search_catalog") {
        catalogShowSeasonalPrices =
          catIntent.hasWeekend === true ||
          (catIntent.dateD1 != null && catIntent.dateD2 != null);
      } else {
        catalogShowSeasonalPrices = explicitDateRangeInChat;
      }
    }

    const bodyText = excludePropertyIds?.length
      ? "Aquí tienes más opciones con los mismos filtros:"
      : usedInferredDates
        ? `Te comparto fincas en ${location}. Referencia de disponibilidad: próximo fin de semana. Con tus fechas exactas te cotizo la temporada que te aplica.`
        : "Estas son las fincas disponibles para tus fechas:";
    const followUpProductBody = excludePropertyIds?.length
      ? "Otra opción disponible:"
      : "Aquí tienes otra opción para tus fechas:";

    const checkInStr = formatLocalYMD(fechaEntrada);
    const checkOutStr = formatLocalYMD(fechaSalida);
    type CatalogStayPrice = {
      nightly: number;
      staySubtotal: number;
      nights: number;
      rule: string;
    };
    const catalogPriceByPropertyId = new Map<string, CatalogStayPrice>();
    if (
      catalogShowSeasonalPrices &&
      checkInStr &&
      checkOutStr &&
      checkInStr < checkOutStr
    ) {
      for (const f of fincasToSend) {
        try {
          const pr = await ctx.runQuery(api.fincas.calculateStayPrice, {
            propertyId: f._id,
            fechaEntrada: checkInStr,
            fechaSalida: checkOutStr,
          });
          const nightsCount = pr?.nightsCount ?? 0;
          const subtotal = pr?.subtotal ?? 0;
          if (pr && nightsCount > 0 && subtotal > 0) {
            const nightly = Math.round(subtotal / nightsCount);
            const rule = String(pr.appliedRule || "Estándar").slice(0, 120);
            catalogPriceByPropertyId.set(f._id as string, {
              nightly,
              staySubtotal: subtotal,
              nights: nightsCount,
              rule,
            });
          }
        } catch (e) {
          console.warn("[catalog-price] omitiendo finca", f._id, e);
        }
      }
    }

    const catalogPriceSuffix = (propertyId: string, priceBase: number): string => {
      const info = catalogPriceByPropertyId.get(propertyId);
      if (info) {
        return `\n\n💰 Para tus fechas (${info.nights} noches): $${info.nightly.toLocaleString("es-CO")}/noche (${info.rule}). Total alojamiento: $${info.staySubtotal.toLocaleString("es-CO")}.`;
      }
      const pb = Number(priceBase ?? 0);
      if (!catalogShowSeasonalPrices) {
        const basePart =
          pb > 0
            ? ` Precio base referencial: $${pb.toLocaleString("es-CO")}/noche.`
            : "";
        return `\n\n📅 Para cotizar con la temporada correcta (reglas globales / Puentes / Semana Santa, etc.) envíame fecha de entrada y salida con día y mes.${basePart}`;
      }
      if (pb > 0) {
        return `\n\n💰 Tarifa base referencial: $${pb.toLocaleString("es-CO")}/noche. Cotización final según temporada al confirmar fechas.`;
      }
      return "";
    };

    // Aviso de regla de mascotas (3ra en adelante) — se envía una sola vez antes del catálogo.
    // Por política: 1ra/2da $100.000 reembolsable; 3ra+ $30.000 NO reembolsable + aseo $70.000.
    const petCountFromHistory = (() => {
      const lower = mergedUserTextForCatalogGuard
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{M}/gu, "");
      const numeric =
        lower.match(/(\d+)\s*(?:mascotas?|perros?|gatos?)/i) ||
        lower.match(/(?:mascotas?|perros?|gatos?)\s*[:\-]?\s*(\d+)/i);
      if (numeric?.[1]) {
        const n = parseInt(numeric[1], 10);
        if (Number.isFinite(n)) return n;
      }
      const wordMap: Record<string, number> = {
        un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6,
      };
      const wordMatch = lower.match(
        /\b(un|una|uno|dos|tres|cuatro|cinco|seis)\s+(?:mascotas?|perros?|gatos?)\b/i,
      );
      if (wordMatch?.[1]) return wordMap[wordMatch[1].toLowerCase()] ?? 0;
      return 0;
    })();
    const petRuleAlreadySentInHistory = recentUsersForCatalog.some((m: any) => {
      if (m.sender !== "assistant") return false;
      const t = String(m.content ?? "");
      return (
        /3ra\s+en\s+adelante/i.test(t) ||
        /\$\s*30[.,]?000.*no\s+reembolsable/i.test(t) ||
        /cargo\s+(?:[^\n]{0,30})?aseo/i.test(t)
      );
    });
    if (hasPets === true && petCountFromHistory >= 3 && !petRuleAlreadySentInHistory) {
      const petRuleNotice =
        `🐾 Por política de FincasYa, al viajar con ${petCountFromHistory} mascotas aplica:\n\n` +
        `• 1ra y 2da mascota: $100.000 c/u (depósito *reembolsable*) ✅\n` +
        `• Desde la 3ra en adelante: $30.000 c/u (*no reembolsable*) + cargo único de aseo $70.000 🧹\n\n` +
        `⚠️ Las mascotas no pueden estar en piscina ni sobre los muebles.\n\n` +
        `Ahora te comparto las fincas en ${location} que admiten mascotas para tus fechas. 🏡`;
      await ctx.runMutation(internal.messages.insertAssistantMessage, {
        conversationId: args.conversationId,
        content: petRuleNotice,
        createdAt: Date.now(),
      });
      await ctx.runAction(internal.ycloud.sendWhatsAppMessage, {
        to: args.phone,
        text: petRuleNotice,
      });
    }

    try {
      for (let i = 0; i < fincasToSend.length; i++) {
        const f = fincasToSend[i];
        const perBody =
          (i === 0 ? bodyText : followUpProductBody) +
          catalogPriceSuffix(f._id as string, f.priceBase);
        await ctx.runAction(internal.ycloud.sendWhatsAppCatalogList, {
          to: args.phone,
          productRetailerIds: [productRetailerIds[i]],
          bodyText: perBody,
          catalogId: chosenCatalog.whatsappCatalogId,
          wamid: i === 0 ? args.wamid : undefined,
        });
      }
    } catch (err) {
      console.error("[catalog-search] Error enviando catálogo interactivo, fallback a texto:", err);
      const top = fincas.slice(0, CATALOG_SEND_BATCH);
      const lines = top.map((f: any, idx: number) => {
        const info = catalogPriceByPropertyId.get(f._id as string);
        if (info) {
          return `${idx + 1}. ${f.title} — $${info.nightly.toLocaleString("es-CO")}/noche (${info.rule}), ${info.nights} noches ≈ $${info.staySubtotal.toLocaleString("es-CO")} alojamiento`;
        }
        const price = Number(f.priceBase ?? 0);
        const priceLabel =
          price > 0 ? `$${price.toLocaleString("es-CO")} / noche` : "Precio a confirmar";
        return `${idx + 1}. ${f.title} — ${priceLabel}`;
      });
      const fallbackText =
        `No pude enviarte el catálogo interactivo en este momento, pero aquí tienes opciones disponibles en ${location}:\n\n` +
        `${lines.join("\n")}\n\n` +
        `Si te gusta alguna, te amplío detalles y validamos disponibilidad de inmediato. ✅`;

      await ctx.runAction(internal.ycloud.sendWhatsAppMessage, {
        to: args.phone,
        text: fallbackText,
        wamid: args.wamid,
      });
      await ctx.runMutation(internal.messages.insertAssistantMessage, {
        conversationId: args.conversationId,
        content: fallbackText,
        createdAt: Date.now(),
      });
      return { sent: false, location, fincasCount: fincas.length, fincasFoundButNoCatalog: true };
    }

    await ctx.runMutation(internal.conversations.setLastCatalogSent, {
      conversationId: args.conversationId,
      propertyIds: fincasToSend.map((f: any) => f._id),
      location,
      fechaEntrada,
      fechaSalida,
      minCapacity,
      sortByPrice,
      hasPets,
    });

    for (const f of fincasToSend) {
      const stayPrice = catalogPriceByPropertyId.get(f._id as string);
      await ctx.runMutation(internal.messages.insertAssistantMessageWithMedia, {
        conversationId: args.conversationId,
        content: `Catálogo enviado: ${f.title}`,
        type: "product",
        metadata: {
          product: {
            title: f.title,
            image: f.image || "",
            price: stayPrice?.nightly ?? f.priceBase,
            priceBase: f.priceBase,
            slug: f.slug || f.code || f._id,
            ...(stayPrice
              ? {
                  appliedRule: stayPrice.rule,
                  staySubtotal: stayPrice.staySubtotal,
                  nights: stayPrice.nights,
                }
              : {}),
          },
        },
        createdAt: Date.now(),
      });
    }

    const catalogKwForFollowUp = await ctx.runQuery(api.fincas.getAllUniqueLocations, {});
    const knownForFollowUp = extractKnownReservationData(mergedUserDateText, {
      catalogLocationKeywords: catalogKwForFollowUp,
    });
    const postCatalogFollowUp = buildPostCatalogFollowUp(
      excludePropertyIds,
      knownForFollowUp
    );
    await ctx.runAction(internal.ycloud.sendWhatsAppMessage, {
      to: args.phone,
      text: postCatalogFollowUp,
    });
    await ctx.runMutation(internal.messages.insertAssistantMessage, {
      conversationId: args.conversationId,
      content: postCatalogFollowUp,
      createdAt: Date.now(),
    });

    return { sent: true, location, fincasCount: fincasToSend.length };
  },
});

/**
 * Enviar lista de productos del catálogo (fincas) por WhatsApp.
 * POST con type: interactive, interactive.type: product_list.
 */
export const sendWhatsAppCatalogList = internalAction({
  args: {
    to: v.string(),
    productRetailerIds: v.array(v.string()),
    bodyText: v.optional(v.string()),
    catalogId: v.optional(v.string()),
    wamid: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.productRetailerIds.length === 0) return null;
    const apiKey = process.env.YCLOUD_API_KEY;
    const wabaNumber = process.env.YCLOUD_WABA_NUMBER;
    const catalogId = args.catalogId;
    const fallbackCatalogId = "1560075992300705";
    if (!apiKey || !wabaNumber) {
      throw new Error("YCLOUD_API_KEY y YCLOUD_WABA_NUMBER deben estar configurados en Convex");
    }
    if (!catalogId) {
      throw new Error("catalogId es requerido (viene de whatsappCatalogs en la BD)");
    }
    console.log("[ycloud] Enviando catálogo:", catalogId, "con productos:", args.productRetailerIds.length);
    const bodyText = args.bodyText ?? "Estas son nuestras fincas disponibles para tus fechas:";
    const buildBody = (catalogIdToUse: string): Record<string, unknown> => {
      const body: Record<string, unknown> =
        args.productRetailerIds.length === 1
          ? {
              from: wabaNumber,
              to: args.to,
              type: "interactive",
              interactive: {
                type: "product",
                body: { text: bodyText },
                footer: { text: "FincasYa" },
                action: {
                  catalog_id: catalogIdToUse,
                  product_retailer_id: args.productRetailerIds[0],
                },
              },
            }
          : {
              from: wabaNumber,
              to: args.to,
              type: "interactive",
              interactive: {
                type: "product_list",
                header: { type: "text", text: "Fincas" },
                body: { text: bodyText },
                footer: { text: "FincasYa" },
                action: {
                  catalog_id: catalogIdToUse,
                  sections: [
                    {
                      title: "Fincas disponibles",
                      product_items: args.productRetailerIds.map((id) => ({ product_retailer_id: id })),
                    },
                  ],
                },
              },
            };
      if (args.wamid) body.context = { message_id: args.wamid };
      return body;
    };

    const sendCatalogMessage = async (catalogIdToUse: string) => {
      const res = await fetch("https://api.ycloud.com/v2/whatsapp/messages/sendDirectly", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
        body: JSON.stringify(buildBody(catalogIdToUse)),
      });
      const textRes = await res.text();
      return { ok: res.ok, status: res.status, textRes };
    };

    let response = await sendCatalogMessage(catalogId);
    const invalidCatalogError =
      !response.ok &&
      response.status === 400 &&
      (
        /invalid[_\s-]?catalog[_\s-]?id/i.test(response.textRes) ||
        response.textRes.includes('"code":"131009"') ||
        response.textRes.includes('"errorDataDetails":"Invalid catalog_id."')
      );
    if (invalidCatalogError) {
      if (catalogId !== fallbackCatalogId) {
        console.warn(
          "[ycloud] catalog_id inválido en BD:",
          catalogId,
          "reintentando con fallback:",
          fallbackCatalogId
        );
        response = await sendCatalogMessage(fallbackCatalogId);
      }
    }

    if (!response.ok) {
      throw new Error(`YCloud API error: ${response.status} - ${response.textRes}`);
    }
    return JSON.parse(response.textRes);
  },
});

/**
 * Extrae datos del cliente y de la reserva analizando el historial de mensajes.
 * Prioriza bloques [CONTRACT_PDF:...] existentes o usa la IA para inferir.
 */
export const extractContractData = action({
  args: { 
    conversationId: v.id("conversations"),
    forceFresh: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<any> => {
    const { conversationId, forceFresh } = args;
    const messages = await ctx.runQuery(api.messages.listRecent, {
      conversationId: conversationId,
      limit: 30,
    });

    // Helper para normalizar los datos extraídos
    const normalizeData = async (parsed: any, historyMessages: any[]): Promise<any> => {
      const currentYear = new Date().getFullYear();

      // MEJORA: Convertir cualquier formato común a YYYY-MM-DD
      const ensureISODate = (d: string) => {
        if (!d) return d;
        // 1. Si ya es YYYY-MM-DD
        if (/^\d{4}-\d{2}-\d{2}/.test(d)) return d;
        // 2. Si es DD/MM/YYYY o DD-MM-YYYY
        const slashMatch = d.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
        if (slashMatch) {
          return `${slashMatch[3]}-${slashMatch[2].padStart(2, "0")}-${slashMatch[1].padStart(2, "0")}`;
        }
        // 3. Si es DD/MM/YY
        const shortslashMatch = d.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})$/);
        if (shortslashMatch) {
          return `20${shortslashMatch[3]}-${shortslashMatch[2].padStart(2, "0")}-${shortslashMatch[1].padStart(2, "0")}`;
        }
        return d;
      };

      const fixYear = (d: string) => {
        const iso = ensureISODate(d);
        if (!iso) return iso;
        const match = iso.match(/^(\d{4})-(.*)/);
        if (match && Number(match[1]) < currentYear) {
          return `${currentYear}-${match[2]}`;
        }
        return iso;
      };

      // Normalizar fechas de entrada/salida inmediatamente
      parsed.checkInDate = fixYear(parsed.entrada || parsed.checkInDate || "");
      parsed.checkOutDate = fixYear(parsed.salida || parsed.checkOutDate || "");

      // Si el rango quedó en el pasado (ej. 13 abr cuando ya pasó), avanzar ambas fechas un año
      // hasta que el check-in sea hoy o futuro en Colombia (misma duración en noches).
      {
        const todayBogotaStr = new Intl.DateTimeFormat("en-CA", {
          timeZone: "America/Bogota",
        }).format(new Date());
        const addOneYearToIso = (iso: string): string => {
          const [y, m, d] = iso.split("-").map(Number);
          return `${y + 1}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        };
        let inStr = parsed.checkInDate;
        let outStr = parsed.checkOutDate;
        if (
          inStr &&
          outStr &&
          /^\d{4}-\d{2}-\d{2}$/.test(inStr) &&
          /^\d{4}-\d{2}-\d{2}$/.test(outStr)
        ) {
          let guard = 0;
          while (inStr < todayBogotaStr && guard++ < 6) {
            inStr = addOneYearToIso(inStr);
            outStr = addOneYearToIso(outStr);
          }
          parsed.checkInDate = inStr;
          parsed.checkOutDate = outStr;
        }
      }

      // Resolución de propiedad
      let resolvedPropertyId = String(parsed.propertyId || "");
      if (!resolvedPropertyId || !resolvedPropertyId.includes(":")) {
        const fincaName = String(parsed.finca || parsed.fincaName || parsed.nombreFinca || "");
        const searchTerms = [resolvedPropertyId, fincaName].filter(
          (t) => t && t.length > 2,
        );

        // MEJORA: Si no hay nombre de finca en el JSON, buscarlo en los últimos mensajes
        if (searchTerms.length === 0 && historyMessages.length > 0) {
          const recentText = historyMessages.slice(-10).map((m: any) => m.content).join("\n");
          // Buscar patrones como "Finca: Villa Barbosa", "en la Villa Barbosa", "seleccionaste Villa Barbosa"
          const fincaMatch = recentText.match(/(?:finca|propiedad|en la|seleccionaste|para|de)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i);
          if (fincaMatch) {
            searchTerms.push(fincaName === "" ? fincaMatch[1] : fincaName);
          }
        }

        for (const term of searchTerms) {
          const found = await ctx.runQuery(api.fincas.findBySearchTerm, {
            term,
          });
          if (found) {
            resolvedPropertyId = found._id;
            break;
          }
        }
      }

      // Datos de contacto existentes
      const conv: any = await ctx.runQuery(api.conversations.getById, {
        conversationId: args.conversationId,
      });
      const contact: any = conv
        ? await ctx.runQuery(api.contacts.getById, {
            contactId: conv.contactId,
          })
        : null;

      // Intentar extraer numeroPersonas de la historia si falta en el JSON
      let numeroPersonas = Number(parsed.numeroPersonas || parsed.personas || 0);
      if (numeroPersonas === 0 && historyMessages.length > 0) {
        // Buscar en los últimos mensajes (orden cronológico)
        for (const msg of [...historyMessages].reverse()) {
          const text = msg.content.toLowerCase();
          // Regex para: "Huéspedes: 10", "10 personas", "pax: 8", "para 5 personas"
          const match = text.match(/(?:huéspedes|personas|pax|cupo)(?:\s*[:\-]\s*|\s+)(\d{1,2})/i) 
                     || text.match(/(\d{1,2})\s+(?:personas|adultos|huéspedes)/i);
          if (match) {
            numeroPersonas = parseInt(match[1], 10);
            break;
          }
        }
      }

      // Intentar extraer numeroMascotas de la historia si falta en el JSON
      let petCount = Number(parsed.petCount || parsed.numeroMascotas || parsed.mascotas || 0);
      if (petCount === 0 && historyMessages.length > 0) {
        for (const msg of [...historyMessages].reverse()) {
          const text = msg.content.toLowerCase();
          // Regex para: "Mascotas: 2", "llevo 2 perros", "un gato", "sin mascotas"
          const match = text.match(/(?:mascotas|perros|gatos|animales)(?:\s*[:\-]\s*|\s+)(\d{1,2})/i)
                     || text.match(/(\d{1,2})\s+(?:mascotas|perros|gatos|animales)/i)
                     || (/\b(un|una)\s+(mascota|perro|gato|animal)\b/i.test(text) ? [null, "1"] : null);
          if (match) {
            petCount = parseInt(match[1], 10);
            break;
          }
        }
      }

      // Calcular noches si hay fechas
      let calculatedNoches = 0;
      if (parsed.checkInDate && parsed.checkOutDate) {
        try {
          const start = new Date(parsed.checkInDate + "T12:00:00");
          const end = new Date(parsed.checkOutDate + "T12:00:00");
          if (!isNaN(start.getTime()) && !isNaN(end.getTime()) && end > start) {
            calculatedNoches = Math.round(
              (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24),
            );
          }
        } catch (e) {
          console.error("Error calculating nights:", e);
        }
      } else if (parsed.noches) {
        calculatedNoches = Number(parsed.noches);
      }

      // El total de alojamiento (sin extras)
      const stayPrice = Number(parsed.stayPrice || parsed.precioEstadia || 0);

      // 3. Obtener el precio oficial de la base de datos (Temporadas)
      let databasePrice: number | null = null;
      let databaseStayPrice: number | null = null;
      let appliedRuleName: string | null = null;

      if (resolvedPropertyId && parsed.checkInDate && parsed.checkOutDate) {
        try {
          const pricingRes = await ctx.runQuery(api.fincas.calculateStayPrice, {
            propertyId: resolvedPropertyId as any,
            fechaEntrada: String(parsed.checkInDate),
            fechaSalida: String(parsed.checkOutDate),
            numeroMascotas: petCount,
          });
          
          if (pricingRes && pricingRes.subtotal !== undefined && pricingRes.nightsCount !== undefined && pricingRes.subtotal > 0) {
            databasePrice = Math.round(pricingRes.subtotal / pricingRes.nightsCount);
            databaseStayPrice = pricingRes.subtotal;
            appliedRuleName = pricingRes.appliedRule || null;
          }

        } catch (e) {
          console.error("Error fetching database seasonal price:", e);
        }
      }

      return {
        clientName: String(
          parsed.nombre || parsed.clientName || contact?.name || "",
        ),
        clientId: String(
          parsed.cedula || parsed.clientId || contact?.cedula || "",
        ),
        clientPhone: String(
          parsed.celular || parsed.clientPhone || contact?.phone || "",
        ),
        clientEmail: String(
          parsed.correo || parsed.clientEmail || contact?.email || "",
        ),
        clientCity: String(
          parsed.ciudad || parsed.clientCity || contact?.city || "",
        ),
        clientAddress: String(parsed.direccion || parsed.clientAddress || ""),
        checkInDate: parsed.checkInDate,
        checkOutDate: parsed.checkOutDate,
        checkInTime: formatTimeTo24h(
          String(parsed.entradaHora || parsed.checkInTime || ""),
        ),
        checkOutTime: formatTimeTo24h(
          String(parsed.salidaHora || parsed.checkOutTime || ""),
        ),
        nightlyPrice: (() => {
          // Si tenemos un precio de base de datos (temporada), ese manda SIEMPRE
          if (databasePrice !== null) {
            return String(databasePrice);
          }

          const rawNightly = Number(parsed.nightlyPrice || 0);
          const total = Number(parsed.totalPrice || parsed.precioTotal || 0);
          
          // REPARACIÓN AGRESIVA: Si no hay precio de DB pero tenemos noches
          if (calculatedNoches > 0) {
            let effectiveStayPrice = stayPrice;
            
            // Si el stayPrice es sospechoso (0 o igual al total teniendo mascotas), recalculamos
            if (effectiveStayPrice === 0 || (effectiveStayPrice === total && petCount > 0)) {
              const pets = Number(petCount || 0);
              let petSurcharge = 0;
              if (pets > 0 && pets <= 2) petSurcharge = pets * 100000;
              else if (pets >= 3) petSurcharge = pets * 30000;
              
              const derivedStayPrice = total - petSurcharge;
              if (derivedStayPrice > 0) {
                effectiveStayPrice = derivedStayPrice;
              }
            }

            if (effectiveStayPrice > 0) {
              const recalculated = Math.round(effectiveStayPrice / calculatedNoches);
              // Si el recalcula es un número "limpio" o el rawNightly parece erróneo, lo usamos
              if (rawNightly === 0 || rawNightly % 100 !== 0 || Math.abs(recalculated - rawNightly) > 100) {
                return String(recalculated);
              }
            }
          }
          return String(parsed.nightlyPrice || "");
        })(),
        totalPrice: databaseStayPrice !== null 
          ? String(databaseStayPrice + (Number(parsed.totalPrice || 0) - (stayPrice || databaseStayPrice))) // Intentar mantener extras si existen
          : String(parsed.totalPrice || parsed.precioTotal || ""),
        stayPrice: databaseStayPrice || (calculatedNoches > 0 && Number(parsed.totalPrice || 0) > 0 ? Number(parsed.totalPrice || 0) : stayPrice) || undefined,
        appliedSeason: appliedRuleName || undefined,
        numeroPersonas,
        petCount,
        propertyId: resolvedPropertyId,
      };


    };

    // 1. Intentar encontrar un bloque [CONTRACT_PDF:...] ya generado (SOLUCIÓN RÁPIDA)
    if (!forceFresh) {
      for (const msg of [...messages].reverse()) {
      if (
        msg.sender === "assistant" &&
        msg.content.includes("[CONTRACT_PDF:")
      ) {
        const tag = "[CONTRACT_PDF:";
        const idx = msg.content.indexOf(tag);
        const jsonStart = msg.content.indexOf("{", idx);
        let jsonEnd = -1;
        if (jsonStart >= 0) {
          let depth = 0;
          for (let i = jsonStart; i < msg.content.length; i++) {
            if (msg.content[i] === "{") depth++;
            else if (msg.content[i] === "}") {
              depth--;
              if (depth === 0) {
                jsonEnd = i + 1;
                break;
              }
            }
          }
        }
        if (jsonEnd > 0) {
          try {
            const parsed = JSON.parse(msg.content.slice(jsonStart, jsonEnd));
            const normalized = await normalizeData(parsed, messages);
            return {
              ...normalized,
              source: "finalized_block",
            };
          } catch (e) {
            console.error("Error parsing CONTRACT_PDF block:", e);
          }
        }
      }
    }
    }




    // 2. Usar IA para extraer del historial si no hay bloque final
    const history = messages
      .map((m: any) => `${m.sender.toUpperCase()}: ${m.content}`)
      .join("\n");

    const currentDate = new Date().toLocaleDateString("es-CO", {
      timeZone: "America/Bogota",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const prompt = `Analiza los siguientes mensajes de una conversación de WhatsApp y extrae los datos necesarios para un contrato de alquiler de finca.
FECHA ACTUAL: ${currentDate}. Usa este año para fechas ambiguas.

REGLAS DE PRECIO IMPORTANTES:
- nightlyPrice: PRECIO POR NOCHE del alojamiento solamente (sin depósitos ni extras).
- stayPrice: SUBTOTAL del alojamiento solamente (nightlyPrice * número de noches). Sin mascotas ni depósitos.
- totalPrice: VALOR TOTAL de la operación incluyendo mascotas, depósitos y todo lo mencionado.

Responde ÚNICAMENTE con un objeto JSON válido con estas llaves (si no conoces un dato, usa null o ""):
- clientName: nombre completo
- clientId: cédula o ID
- clientEmail: correo electrónico
- clientPhone: celular principal
- ciudad: ciudad de residencia
- direccion: dirección completa
- checkInDate: fecha de entrada (YYYY-MM-DD)
- checkOutDate: fecha de salida (YYYY-MM-DD)
- entradaHora: hora de entrada aproximada en formato 24h (HH:mm, ej. 10:00, 15:30)
- salidaHora: hora de salida aproximada en formato 24h (HH:mm, ej. 09:00, 16:00)
- nightlyPrice: precio por noche (solo números, sin extras)
- stayPrice: total solo estadía (solo números, sin extras)
- totalPrice: precio total final (solo números, incluyendo todo)
- numeroPersonas: cantidad TOTAL de personas/huéspedes (solo el número, ej. 10)
- petCount: cantidad de mascotas (solo el número, ej. 2)
- fincaName: nombre de la finca
- propertyId: ID de la finca
- noches: número de noches (opcional pero recomendado)

Mensajes:\n${history}`;


    const { text } = await generateText({
      model: openai.chat(CONVEX_OPENAI_CHAT_MODEL),
      temperature: 1,
      prompt,
    });

    try {
      const raw = text.trim().replace(/^```\w*\n?|\n?```$/g, "").trim();
      const parsed = JSON.parse(raw);
      const normalized = await normalizeData(parsed, messages);
      return {
        ...normalized,
        source: "ai_extraction",
      };
    } catch (e) {
      console.error("Error parsing AI extraction:", e);
      return { error: "No se pudieron extraer los datos automáticamente" };
    }
  },
});

function formatTimeTo24h(timeStr: string): string {
  if (!timeStr) return "";
  const t = timeStr.trim().toUpperCase();
  const match = t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!match) {
    // Si ya parece HH:mm (24h)
    if (/^\d{2}:\d{2}$/.test(t)) return t;
    return timeStr;
  }
  const [_, hours, minutes, ampm] = match;
  let h = parseInt(hours, 10);
  if (ampm === "PM" && h < 12) h += 12;
  if (ampm === AmPM.AM && h === 12) h = 0;
  return `${h.toString().padStart(2, "0")}:${minutes}`;
}

enum AmPM {
  AM = "AM",
  PM = "PM"
}

/**
 * Busca mensajes del asistente que solo tengan el marcador [Plantilla WhatsApp: ...]
 * y los actualiza con el cuerpo real de YCloud para mejorar la visibilidad en el admin.
 */
export const backfillTemplateMessages = internalAction({
  args: {},
  handler: async (ctx) => {
    const routable = await fetchRoutableTemplates();
    if (routable.length === 0) return { updated: 0 };

    const messages = await ctx.runQuery(internal.ycloud.listAllAssistantMessages);
    let updatedCount = 0;

    for (const msg of messages) {
      if (msg.content.startsWith("[Plantilla WhatsApp:")) {
        const match = msg.content.match(/\[Plantilla WhatsApp:\s*(.+?)\]/);
        if (match) {
          const templateName = match[1].trim();
          const template = routable.find((t) => t.name === templateName);
          if (template && template.body) {
            await ctx.runMutation(internal.messages.updateMessageContent, {
              messageId: msg._id,
              content: template.body,
            });
            updatedCount++;
          }
        }
      }
    }

    return { updated: updatedCount };
  },
});

export const listAllAssistantMessages = internalQuery({
  args: {},
  handler: async (ctx: any) => {
    return await ctx.db
      .query("messages")
      .filter((q: any) => q.eq(q.field("sender"), "assistant"))
      .collect();
  },
});
