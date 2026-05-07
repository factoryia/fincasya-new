/**
 * Bot v2 — Extractor de entidades.
 *
 * Hace UNA llamada liviana al LLM (gpt-4.1-mini) para sacar entidades del mensaje
 * del cliente.  No genera respuestas de usuario: solo extrae datos estructurados.
 *
 * Si el mensaje es un saludo puro o irrelevante, devuelve {} vacío.
 */

import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import type { BotEntities, ExtractedEntities } from "./types";

const MODEL = "gpt-4.1-mini";

/**
 * Convierte fechas con mes y año implícito.
 * Hoy se inyecta para que el LLM las infiera.
 */
function todayContext(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const meses = [
    "enero","febrero","marzo","abril","mayo","junio",
    "julio","agosto","septiembre","octubre","noviembre","diciembre",
  ];
  return `Hoy es ${dd}/${mm}/${yyyy} (${meses[now.getMonth()]} ${yyyy}). Mes actual=${mm}, año=${yyyy}.`;
}

const MUNICIPALITIES_COL = [
  "Melgar","Girardot","Arbeláez","Fusagasugá","La Mesa","Anapoima","Apulo",
  "Villeta","San Francisco","Sasaima","Nocaima","Quebradanegra","Tocaima",
  "Nimaima","Vergara","Supatá","Villavicencio","Acacías","Restrepo",
  "Carmen de Apicalá","Nilo","Ricaurte","Guataquí","Agua de Dios","Girardot",
  "Honda","Mariquita","Armero","Bogotá","Cali","Medellín",
].join(", ");

const EXTRACTOR_SYSTEM = `Eres un extractor de datos para un bot de reservas de fincas en Colombia.
Tu única tarea: analizar el mensaje del cliente y devolver un JSON con los campos que puedas inferir.
${todayContext()}

Municipios válidos (Colombia): ${MUNICIPALITIES_COL}

Reglas estrictas:
- Fechas: SIEMPRE en formato YYYY-MM-DD.
  Si el cliente da solo días (ej "del 15 al 19"), asume mes actual ${new Date().toISOString().slice(5,7)} y año ${new Date().getFullYear()}.
  Si el día ya pasó este mes, asume mes siguiente.
- cupo: número entero (niños ≥2 años cuentan). Solo lo que el cliente diga explícitamente.
- isEvento: true si el cliente confirma fiesta/evento/celebración/cumpleaños/matrimonio en la finca.
             false en TODOS los demás casos: descanso, vacaciones, paseo, "no sé aún", "todavía no lo sé",
             "por ahora no", "no tengo claro", "sin fiesta", "nada de eso", typos como "descando", etc.
             Regla práctica: si el mensaje no menciona explícitamente una celebración, usa false.
             Ejemplos → isEvento: false: "descanso", "descando", "solo descanso", "no sé aún",
               "ya te dije descanso", "vacaciones", "paseo familiar", "no hay evento", "sin fiesta".
             Ejemplos → isEvento: true: "cumpleaños", "hay fiesta", "vamos a celebrar", "matrimonio".
             "Familiar/amigos" como tipo de grupo NO implica isEvento.
- planType: "familia"|"amigos"|"empresa"|"pareja"|"otro" — solo si el cliente indica tipo de grupo.
             "empresa" si dice empresarial/corporativo/equipo de trabajo. NO rellenes planType solo porque dijo "van 10" o un número.
- location: nombre exacto del municipio, o "RECOMENDADAS" si dijo "no sé","donde recomiendes","cualquier lugar","da igual".
- wantsRecomendadas: true si dijo "no sé el municipio" o similar.
- selectedPropertyName: nombre claro de una finca (título real). Si solo dice "esta", "esa", "quiero esta", etc., **omite** el campo (no inventes nombre).
- hasPets: true/false si menciona mascotas/perros/gatos.
- petCount: número de mascotas si lo dice.
- contractFields: objeto con name, cedula, email, phone, address — solo si los menciona.
MEMORIA / TURNO ACTUAL:
- NUNCA pongas cadenas vacías. Si un campo no cambia en este mensaje, **omítelo** del JSON (no uses "").
- Si el mensaje actual solo aclara municipio, "no sé", "recomiéndame", etc., **no vuelvas a incluir** checkIn/checkOut salvo que el cliente **cambie** las fechas en este mensaje.
- Si las fechas solo aparecen en el historial y el cliente no las contradice, puedes incluirlas **solo si** faltan en "Valores ya confirmados" y las ves claras en el historial reciente.

Devuelve SOLO JSON válido. Si no puedes extraer ningún campo relevante, devuelve {}.
No añadas explicaciones ni markdown.`;

export async function extractEntities(
  messageText: string,
  currentEntities: BotEntities,
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<ExtractedEntities> {
  if (!messageText.trim()) return {};

  const contextSummary = buildContextSummary(currentEntities);

  const historyLines = conversationHistory
    .slice(-14)
    .map((m) => `${m.role === "assistant" ? "Asistente" : "Cliente"}: ${m.content}`)
    .join("\n");

  const prompt = [
    historyLines ? `Historial reciente:\n${historyLines}` : "",
    contextSummary ? `Valores ya confirmados en sesión: ${contextSummary}` : "",
    `Mensaje actual del cliente: "${messageText}"`,
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const { text } = await generateText({
      model: openai(MODEL),
      system: EXTRACTOR_SYSTEM,
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      maxTokens: 400,
    });

    const jsonStr = text.trim().replace(/^```json\s*/i, "").replace(/```$/, "");
    const parsed = JSON.parse(jsonStr) as ExtractedEntities;
    return parsed;
  } catch {
    return {};
  }
}

function buildContextSummary(e: BotEntities): string {
  const parts: string[] = [];
  if (e.location) parts.push(`municipio=${e.location}`);
  if (e.checkIn) parts.push(`entrada=${e.checkIn}`);
  if (e.checkOut) parts.push(`salida=${e.checkOut}`);
  if (e.cupo !== undefined) parts.push(`cupo=${e.cupo}`);
  if (e.planType) parts.push(`planType=${e.planType}`);
  if (e.isEvento !== undefined) parts.push(`isEvento=${e.isEvento}`);
  return parts.join(", ");
}
