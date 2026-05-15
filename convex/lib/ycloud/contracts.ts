import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";

/**
 * Extrae todo el bloque JSON balanceado más largo del texto.
 * Tolera prosa antes/después, fences markdown, comillas tipográficas, etc.
 */
function safeParseJsonBlock(raw: string): Record<string, unknown> | null {
  if (!raw) return null;

  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'");

  // Camino feliz: ya es JSON puro.
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
  } catch {
    /* sigue al fallback */
  }

  // Fallback: busca el primer { hasta el } que lo balancea.
  const start = cleaned.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let end = -1;
  let inString = false;
  let escape = false;
  for (let i = start; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (c === "\\") {
      escape = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) return null;
  const block = cleaned.slice(start, end + 1);
  try {
    const parsed = JSON.parse(block);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function todayYmdColombia(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
  }).format(new Date());
}

function parseYmd(s: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? "").trim());
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

function makeYmd(y: number, month: number, day: number): string {
  const t = new Date(y, month - 1, day);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

function addMonths(y: number, month: number, delta: number): { y: number; m: number } {
  const t = new Date(y, month - 1 + delta, 1);
  return { y: t.getFullYear(), m: t.getMonth() + 1 };
}

/** Última marca tipo WhatsApp export: `[13/05/26, 3:36 PM]` → 13 may 2026 */
function parseLastBracketCalendarFromHistory(
  history: string,
): { y: number; m: number; d: number } | null {
  const re = /\[(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/g;
  let last: RegExpExecArray | null = null;
  let x: RegExpExecArray | null;
  while ((x = re.exec(history)) !== null) last = x;
  if (!last) return null;
  const d = Number(last[1]);
  const month = Number(last[2]);
  let y = Number(last[3]);
  if (y < 100) y = y <= 69 ? 2000 + y : 1900 + y;
  if (d < 1 || d > 31 || month < 1 || month > 12) return null;
  return { y, m: month, d };
}

/** "para el 15 al 18", "del 15 al 18", "15 al 18" (días del mes). */
function parseDaySpanFromHistory(history: string): { d1: number; d2: number } | null {
  const res = [
    /(?:para el|del|desde el|el)\s*(\d{1,2})\s*(?:al|hasta|-|a)\s*(?:el\s*)?(\d{1,2})/i,
    /\b(\d{1,2})\s*(?:al|hasta|-|a)\s*(?:el\s*)?(\d{1,2})\b/i,
  ];
  for (const re of res) {
    const m = history.match(re);
    if (!m) continue;
    const d1 = Number(m[1]);
    const d2 = Number(m[2]);
    if (d1 >= 1 && d1 <= 31 && d2 >= 1 && d2 <= 31) return { d1, d2 };
  }
  return null;
}

function stayFromAnchorDays(
  anchorY: number,
  anchorM: number,
  d1: number,
  d2: number,
  today: string,
): { checkIn: string; checkOut: string } {
  let yy = anchorY;
  let mm = anchorM;
  for (let i = 0; i < 24; i++) {
    const checkIn = makeYmd(yy, mm, d1);
    let checkOut: string;
    if (d2 > d1) {
      checkOut = makeYmd(yy, mm, d2);
    } else {
      const nx = addMonths(yy, mm, 1);
      checkOut = makeYmd(nx.y, nx.m, d2);
    }
    if (checkIn >= today) return { checkIn, checkOut };
    const n = addMonths(yy, mm, 1);
    yy = n.y;
    mm = n.m;
  }
  const checkIn = makeYmd(anchorY, anchorM, d1);
  const checkOut =
    d2 > d1
      ? makeYmd(anchorY, anchorM, d2)
      : (() => {
          const nx = addMonths(anchorY, anchorM, 1);
          return makeYmd(nx.y, nx.m, d2);
        })();
  return { checkIn, checkOut };
}

function parseSpanishDayMonthRange(
  history: string,
): { d1: number; d2: number; month: number } | null {
  const MONTH_WORD_TO_NUM: Record<string, number> = {
    enero: 1,
    febrero: 2,
    marzo: 3,
    abril: 4,
    mayo: 5,
    junio: 6,
    julio: 7,
    agosto: 8,
    septiembre: 9,
    setiembre: 9,
    octubre: 10,
    noviembre: 11,
    diciembre: 12,
  };
  const norm = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  const keys = Object.keys(MONTH_WORD_TO_NUM).join("|");
  const reDelLoose = new RegExp(
    `\\bdel\\s+(\\d{1,2})\\s*(?:al|hasta|-|a)\\s*(?:el\\s*)?(\\d{1,2})\\s+de\\s*(${keys})`,
    "i",
  );
  const reDel = new RegExp(
    `(?:del|el|para el)\\s*(\\d{1,2})\\s*(?:al|hasta|-|a)\\s*(?:el\\s*)?(\\d{1,2})\\s+de\\s*(${keys})`,
    "i",
  );
  let m = history.match(reDelLoose) || history.match(reDel);
  if (m) {
    const month = MONTH_WORD_TO_NUM[norm(m[3])];
    if (!month) return null;
    const d1 = Number(m[1]);
    const d2 = Number(m[2]);
    if (d1 >= 1 && d1 <= 31 && d2 >= 1 && d2 <= 31) return { d1, d2, month };
  }
  const reTwo = new RegExp(
    `(\\d{1,2})\\s+de\\s*(${keys})\\s+(?:al|hasta|-|a)\\s*(?:el\\s*)?(\\d{1,2})\\s+de\\s*(${keys})`,
    "i",
  );
  m = history.match(reTwo);
  if (m) {
    const m1 = norm(m[2]);
    const m2 = norm(m[4]);
    const month1 = MONTH_WORD_TO_NUM[m1];
    const month2 = MONTH_WORD_TO_NUM[m2];
    if (!month1 || !month2) return null;
    const d1 = Number(m[1]);
    const d2 = Number(m[3]);
    if (d1 < 1 || d1 > 31 || d2 < 1 || d2 > 31) return null;
    return { d1, d2, month: month1 };
  }
  return null;
}

/**
 * Corrige fechas del LLM cuando inventa años viejos o ignora "15 al 18" + contexto `[dd/mm/yy`.
 */
function refineContractStayDatesFromHistory(
  history: string,
  parsed: Record<string, unknown>,
): void {
  const today = todayYmdColombia();
  const todayParts = parseYmd(today);
  if (!todayParts) return;

  const esRange = parseSpanishDayMonthRange(history);
  if (esRange) {
    const prevIn =
      typeof parsed.checkInDate === "string" ? parsed.checkInDate.trim() : "";
    const prevOut =
      typeof parsed.checkOutDate === "string" ? parsed.checkOutDate.trim() : "";
    const stale =
      !prevIn ||
      !prevOut ||
      prevIn < today ||
      prevOut < today ||
      prevOut <= prevIn;
    if (stale) {
      const bracket = parseLastBracketCalendarFromHistory(history);
      const anchorY = bracket?.y ?? todayParts.y;
      const { checkIn, checkOut } = stayFromAnchorDays(
        anchorY,
        esRange.month,
        esRange.d1,
        esRange.d2,
        today,
      );
      parsed.checkInDate = checkIn;
      parsed.checkOutDate = checkOut;
    }
    return;
  }

  const span = parseDaySpanFromHistory(history);
  const bracket = parseLastBracketCalendarFromHistory(history);

  const anchorY = bracket?.y ?? todayParts.y;
  const anchorM = bracket?.m ?? todayParts.m;

  if (span) {
    const prevIn =
      typeof parsed.checkInDate === "string" ? parsed.checkInDate.trim() : "";
    const prevOut =
      typeof parsed.checkOutDate === "string" ? parsed.checkOutDate.trim() : "";
    const stale =
      !prevIn ||
      !prevOut ||
      prevIn < today ||
      prevOut < today ||
      prevOut <= prevIn;
    if (stale) {
      const { checkIn, checkOut } = stayFromAnchorDays(
        anchorY,
        anchorM,
        span.d1,
        span.d2,
        today,
      );
      parsed.checkInDate = checkIn;
      parsed.checkOutDate = checkOut;
    }
    return;
  }

  const prevIn =
    typeof parsed.checkInDate === "string" ? parsed.checkInDate.trim() : "";
  if (!prevIn || prevIn >= today) return;
  const pIn = parseYmd(prevIn);
  const pOut = parseYmd(
    typeof parsed.checkOutDate === "string" ? parsed.checkOutDate.trim() : "",
  );
  if (!pIn || !pOut || !bracket) return;

  parsed.checkInDate = makeYmd(bracket.y, bracket.m, pIn.d);
  if (pOut.d > pIn.d) {
    parsed.checkOutDate = makeYmd(bracket.y, bracket.m, pOut.d);
  } else {
    const nx = addMonths(bracket.y, bracket.m, 1);
    parsed.checkOutDate = makeYmd(nx.y, nx.m, pOut.d);
  }
}

export async function extractContractDataFromHistory(fullHistory: string) {
  if (!fullHistory || !fullHistory.trim()) return {};

  let text = "";
  try {
    const result = await generateText({
      model: openai("gpt-4.1-mini"),
      system: `Extrae datos del cliente para un contrato de arrendamiento de finca.
Devuelve ÚNICAMENTE un objeto JSON válido (sin prosa, sin markdown, sin \`\`\`).
Esquema (incluye TODAS las claves; usa null cuando no encuentres dato; nunca inventes):
{
  "nombre": string | null,
  "cedula": string | null,
  "ciudad_expedicion": string | null,
  "email": string | null,
  "telefono": string | null,
  "direccion": string | null,
  "finca": string | null,
  "checkInDate": "YYYY-MM-DD" | null,
  "checkOutDate": "YYYY-MM-DD" | null,
  "tipoGrupo": string | null,
  "propositoEstancia": string | null,
  "nochesMencionadas": number | null,
  "personas": number | null,
  "mascotas": number | null,
  "precioPorNocheCop": number | null,
  "subtotalAlojamientoCop": number | null,
  "aseoFinalCop": number | null
}
Reglas:
- Pesos colombianos: enteros sin puntos, comas, ni símbolos. "$1.250.000" → 1250000.
- Si el asesor dice frases como "total por 2 noches ... es $4.800.000" o "por N noches ... $X", pon subtotalAlojamientoCop=X y nochesMencionadas=N (N entero ≥1).
- Si el resumen menciona "precio por noche" y "total noches", llena precioPorNocheCop y subtotalAlojamientoCop.
- Si solo aparece subtotal de alojamiento y las fechas, llena solo subtotalAlojamientoCop (el servidor calcula el precio/noche).
- Si hay subtotalAlojamientoCop y nochesMencionadas pero NO hay precioPorNocheCop, déjalo null (el servidor puede derivar precio/noche).
- Aseo final SOLO si se menciona aparte; si no aparece, null.
- Fechas SIEMPRE YYYY-MM-DD.
- Contexto temporal: el historial puede traer marcas como [13/05/26, ...] = 13 de mayo de 2026 (dd/mm/aa o dd/mm/aaaa). Úsalas como ancla del mes/año cuando el cliente diga solo días ("para el 15 al 18", "del 15 al 18") sin mes: misma ancla de mes y año que la última marca [dd/mm/...] del historial; si no hay marca, usa el mes y año de HOY en Bogotá.
- Nunca asumas años pasados (p. ej. 2023) si el chat es reciente; prioriza el año de las marcas [dd/mm/aa] o el año actual en Colombia.
- tipoGrupo: una de FAMILIAR | EVENTO | AMIGOS | EMPRESA (mayúsculas) si el cliente habla de plan familiar, fiesta/evento, amigos, empresa; null si no se deduce.
- propositoEstancia: breve texto (ej. "descanso familiar en Melgar") si lo mencionan; null si no.
- Si el dato no aparece o es ambiguo, usa null. Nada de adivinanzas fuera de las reglas anteriores.`,
      messages: [{ role: "user", content: fullHistory }],
      temperature: 0,
      maxTokens: 1100,
    });
    text = result.text ?? "";
  } catch (err) {
    console.warn(
      "[extractContractDataFromHistory] LLM call failed:",
      err instanceof Error ? err.message : String(err),
    );
    return {};
  }

  const parsed = safeParseJsonBlock(text);
  if (!parsed) {
    console.warn(
      "[extractContractDataFromHistory] could not parse JSON. Raw output (first 400 chars):",
      text.slice(0, 400),
    );
    return {};
  }

  // Normaliza nulls a undefined para que los chequeos `!= null` posteriores omitan campos vacíos.
  for (const k of Object.keys(parsed)) {
    if (parsed[k] === null) delete parsed[k];
  }
  refineContractStayDatesFromHistory(fullHistory, parsed);
  return parsed;
}
