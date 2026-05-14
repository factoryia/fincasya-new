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
  "personas": number | null,
  "mascotas": number | null,
  "precioPorNocheCop": number | null,
  "subtotalAlojamientoCop": number | null,
  "aseoFinalCop": number | null
}
Reglas:
- Pesos colombianos: enteros sin puntos, comas, ni símbolos. "$1.250.000" → 1250000.
- Si el resumen menciona "precio por noche" y "total noches", llena precioPorNocheCop y subtotalAlojamientoCop.
- Si solo aparece subtotal de alojamiento y las fechas, llena solo subtotalAlojamientoCop (el servidor calcula el precio/noche).
- Aseo final SOLO si se menciona aparte; si no aparece, null.
- Fechas SIEMPRE YYYY-MM-DD.
- Si el dato no aparece o es ambiguo, usa null. Nada de adivinanzas.`,
      messages: [{ role: "user", content: fullHistory }],
      temperature: 0,
      maxTokens: 900,
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
  return parsed;
}
