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
- location: nombre del municipio colombiano, CORREGIDO Y NORMALIZADO. El cliente
  escribe rápido y con errores — DEBES interpretar y devolver el nombre real
  del municipio, no el texto literal. Ejemplos de corrección de typos:
    "melar", "mlgar", "melgr", "melgaar" → "Melgar"
    "viavicencio", "villaviciencio", "vilavicencio", "villavi" → "Villavicencio"
    "jirardot", "girardó", "girardot" → "Girardot"
    "anapoma", "anapoyma" → "Anapoima"
    "carmen apicala", "apicala", "carmen de apical" → "Carmen de Apicalá"
    "restrpo", "restrepo" → "Restrepo"
  Reconoce el municipio aunque venga con preposición ("en melar", "para melgar",
  "voy a melgar"), en minúsculas, sin tildes o con typos de 1-2 letras.
  Devuelve "RECOMENDADAS" si el cliente expresa que NO tiene preferencia /
  no conoce / quiere que recomendemos / quiere ver varias zonas. Patrones:
  "no sé", "no se", "no tengo lugar", "no tengo idea", "no tengo preferencia", "no tengo en mente",
  "donde sea", "donde recomiendes", "donde tú me digas", "lo que tú me digas", "cualquier lugar",
  "cualquier zona", "cualquiera", "da igual", "me da lo mismo", "tú decides", "sorpréndeme",
  "recomiéndame", "recomiéndeme", "que me recomiendes", "lo que sugieras", "lo que prefieras",
  **"alrededores"**, **"los alrededores"**, **"por los alrededores"**, **"cerca a Bogotá"**,
  **"cerca de Bogotá"**, **"alrededor de Bogotá"**, **"varias zonas"**, **"diferentes zonas"**,
  **"opciones de diferentes lugares"**, **"varios sitios"**.
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
- confirmsCurrentStep: "yes" | "no" | null — clasifica si el cliente está CONFIRMANDO o
  NEGANDO la última pregunta/propuesta del bot (proceder con reglas de mascotas,
  proceder con contrato, etc.). Tolera typos y combinaciones libres:
    "yes" si dice cualquier variante afirmativa, aunque tenga errores ortográficos:
       "si", "sí", "si por favor", "si pro favor" (typo de "por"), "si porfavor", "si porfa",
       "claro", "dale", "ok", "perfecto", "listo", "de acuerdo", "de una", "vale",
       "bueno", "genial", "chévere", "ya te dije que sí", "obvio", "exacto", "tal cual",
       "afirmativo", combinaciones tipo "si dale", "claro porfa", etc.
    "no" si dice "no", "cancela", "olvídalo", "mejor no", "todavía no", "negativo".
    null si la respuesta es ambigua, una pregunta, o no es respuesta directa a algo del bot.
  Solo lo defines si el ÚLTIMO mensaje del asistente contenía una pregunta de confirmación.
- requestsHumanAgent: true | false — true SOLO si el cliente pide EXPLÍCITAMENTE hablar
  con un humano / asesor / agente / persona real, o expresa que el bot no le sirve.
  Ejemplos true: "quiero hablar con un asesor", "pásame con alguien real", "necesito
    una persona", "me pueden llamar?", "este bot no me sirve", "quiero atención humana",
    "comuníqueme con un agente", "ya me cansé de este bot".
  Ejemplos false (NO es petición de humano): "somos 13 personas", "5 personas familia"
    (está dando el cupo), "voy a llamar a mi familia", cualquier mensaje que solo
    da datos de la reserva (fechas, municipio, cupo, mascotas) o hace preguntas
    normales sobre fincas. Ante la duda → false.
  Omite el campo (no lo incluyas) si es false — solo ponlo cuando sea true.
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

  // ⚠️ El prompt del LLM dice "contractFields: objeto con name, cedula, email,
  // phone, address". A veces el modelo devuelve esos nombres SIN el prefijo
  // `contract`. Si hacemos spread directo en `BotEntities`, terminamos con
  // campos `name`, `address`, etc. que NO están en el schema → ArgumentValidationError.
  //
  // Aquí mapeamos ambas variantes al nombre canónico (`contractName`, etc.).
  const raw = p.contractFields as Record<string, unknown>;
  const pick = (canonical: string, alias: string): string | undefined => {
    const v1 = raw[canonical];
    if (typeof v1 === "string" && v1.trim().length > 0) return v1.trim();
    const v2 = raw[alias];
    if (typeof v2 === "string" && v2.trim().length > 0) return v2.trim();
    return undefined;
  };
  const normalized: Partial<
    Pick<
      BotEntities,
      "contractName" | "contractCedula" | "contractEmail" | "contractPhone" | "contractAddress"
    >
  > = {};
  const name = pick("contractName", "name");
  if (name) normalized.contractName = name;
  const cedula = pick("contractCedula", "cedula");
  if (cedula) normalized.contractCedula = cedula;
  const email = pick("contractEmail", "email");
  if (email) normalized.contractEmail = email;
  const phone = pick("contractPhone", "phone");
  if (phone) normalized.contractPhone = phone;
  const address = pick("contractAddress", "address");
  if (address) normalized.contractAddress = address;

  // Validaciones de formato. Si no cumplen, descartamos para no marcar el
  // contrato como "completo" con datos basura.
  if (
    normalized.contractEmail &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalized.contractEmail)
  ) {
    delete normalized.contractEmail;
  }
  if (
    normalized.contractCedula &&
    normalized.contractCedula.replace(/\D/g, "").length < 5
  ) {
    delete normalized.contractCedula;
  }
  if (
    normalized.contractPhone &&
    normalized.contractPhone.replace(/\D/g, "").length < 7
  ) {
    delete normalized.contractPhone;
  }
  if (normalized.contractName && normalized.contractName.length < 3) {
    delete normalized.contractName;
  }
  if (normalized.contractAddress && normalized.contractAddress.length < 5) {
    delete normalized.contractAddress;
  }

  return { ...p, contractFields: normalized };
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
