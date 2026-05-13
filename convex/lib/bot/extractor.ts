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
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
  ];
  return `Hoy es ${dd}/${mm}/${yyyy} (${meses[now.getMonth()]} ${yyyy}). Mes actual=${mm}, año=${yyyy}.`;
}

const MUNICIPALITIES_COL = [
  "Melgar", "Girardot", "Anapoima", "Apulo",
  "Villeta", "Nocaima", "Tocaima","viotá"
  , "Villavicencio", "Acacías", "Restrepo",
  "Carmen de Apicalá", "Nilo", "Ricaurte", "Guataquí", "Girardot",
  "Bogotá",
].join(", ");

const EXTRACTOR_SYSTEM = `Eres un extractor de datos para un bot de reservas de fincas en Colombia.
Tu única tarea: analizar el mensaje del cliente y devolver un JSON con los campos que puedas inferir.
${todayContext()}

Municipios válidos (Colombia): ${MUNICIPALITIES_COL}

Reglas estrictas:
- Fechas: SIEMPRE en formato YYYY-MM-DD.
  Si el cliente da solo días (ej "del 15 al 19"), asume mes actual ${new Date().toISOString().slice(5, 7)} y año ${new Date().getFullYear()}.
  Si el día ya pasó este mes, asume mes siguiente.
- cupo: número entero. Niños desde 2 años cuentan.
  Si el cliente da "X adultos y Y niños" / "X mayores y Y menores" / "X grandes y Y chicos",
  **suma ambos** (cupo = X + Y), siempre que los menores tengan ≥2 años o no se mencione la edad.
  Si menciona "bebés" / "menores de 2 años" explícitamente, NO los sumes.
  Ej: "8 adultos y 4 niños de 5 años" → cupo=12. "5 adultos y 1 bebé de 1 año" → cupo=5.
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
- location: nombre exacto del municipio, o "RECOMENDADAS" si el cliente expresa que no tiene
  preferencia / no conoce / quiere que recomendemos. Patrones que cuentan como RECOMENDADAS:
  "no sé", "no se", "no tengo lugar", "no tengo idea", "no tengo preferencia", "no tengo en mente",
  "donde sea", "donde recomiendes", "donde tú me digas", "lo que tú me digas", "cualquier lugar",
  "cualquier zona", "cualquiera", "da igual", "me da lo mismo", "tú decides", "sorpréndeme",
  "recomiéndame", "recomiéndeme", "que me recomiendes", "lo que sugieras", "lo que prefieras".
  Si dice cualquier variante de las anteriores → location="RECOMENDADAS".
- wantsRecomendadas: true si encaja con cualquier patrón de los anteriores.
- selectedPropertyName: nombre claro de una finca (título real). Si solo dice "esta", "esa", "quiero esta", etc., **omite** el campo (no inventes nombre).
- hasPets: true/false si menciona mascotas/perros/gatos.
- petCount: número de mascotas si lo dice.
- eventPeopleCount: número entero — solo si el cliente confirma que SÍ es un evento.
                    Total de personas en el evento (las que duermen + las que van solo por el día/pasadía).
                    Si solo dice "se quedan X personas" (sin pasadía) y el contexto es evento, igual usar X.
                    Si menciona "X duermen y Y van solo de día", suma X + Y.
                    Omite si no es evento o no menciona números relacionados al evento.
- eventLogistics: solo cuando isEvento=true.
                  "extra" si el cliente menciona sonido profesional, DJ, iluminación, banda en vivo,
                          mariachis, grupos musicales, presentación en vivo o cualquier logística más allá
                          del sonido normal de la finca.
                  "basic" si dice que solo va a usar el sonido de la finca, ambiente tranquilo, departir,
                          o que NO lleva nada extra.
                  Omite el campo si no se mencionó el tema de logística.
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
    return sanitizeExtracted(parsed);
  } catch {
    return {};
  }
}

/**
 * Limpia el output del extractor antes de mergearlo:
 * - Email debe parecer email (regex básica) — si no, descarta el campo.
 * - Cédula debe tener al menos 5 dígitos — si no, descarta.
 * - Teléfono debe tener al menos 7 dígitos — si no, descarta.
 * Esto evita que el FSM marque el contrato como "completo" con datos basura.
 */
function sanitizeExtracted(p: ExtractedEntities): ExtractedEntities {
  if (!p.contractFields) return p;
  const cf = { ...p.contractFields };
  const emailOk =
    typeof cf.contractEmail === "string" &&
    /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cf.contractEmail.trim());
  const cedulaDigits = String(cf.contractCedula ?? "").replace(/\D/g, "");
  const cedulaOk = cedulaDigits.length >= 5;
  const phoneDigits = String(cf.contractPhone ?? "").replace(/\D/g, "");
  const phoneOk = phoneDigits.length >= 7;
  if (cf.contractEmail !== undefined && !emailOk) delete cf.contractEmail;
  if (cf.contractCedula !== undefined && !cedulaOk) delete cf.contractCedula;
  if (cf.contractPhone !== undefined && !phoneOk) delete cf.contractPhone;
  // contractName y contractAddress: si vienen muy cortos, mejor descartar.
  if (cf.contractName !== undefined && String(cf.contractName).trim().length < 3) {
    delete cf.contractName;
  }
  if (cf.contractAddress !== undefined && String(cf.contractAddress).trim().length < 5) {
    delete cf.contractAddress;
  }
  return { ...p, contractFields: cf };
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
