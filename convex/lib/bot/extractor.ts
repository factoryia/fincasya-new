/**
 * Bot v2 — Extractor de entidades.
 *
 * Hace UNA llamada al LLM (gpt-4.1-mini) para sacar entidades del mensaje del
 * cliente. No genera respuestas de usuario: solo extrae datos estructurados.
 *
 * Si el mensaje es un saludo puro o irrelevante, devuelve {} vacío.
 *
 * MODELO: `gpt-4.1-mini`. Para una tarea de extracción a JSON con un prompt
 * tan detallado, mini es de sobra capaz — y es rápido y barato. Se probó el
 * modelo grande `gpt-4.1`, pero es más lento (más riesgo de timeout en la
 * action de Convex) sin mejorar la extracción. NOTA: los bugs de "el bot no
 * entendió" casi nunca son del extractor — son lógica determinística (regex
 * de zonas, FSM, filtros del catálogo); subir el modelo no los arregla.
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
  Si el cliente da SOLO días, SIN nombrar el mes (ej "del 15 al 19"), asume mes actual ${new Date().toISOString().slice(5, 7)} y año ${new Date().getFullYear()}; y si esos días ya pasaron este mes, asume el mes siguiente.
  Si el cliente SÍ nombra el mes (ej "del 19 al 21 de mayo", "para agosto"), usa EXACTAMENTE ese mes — AUNQUE los días ya hayan pasado. NO lo adelantes al mes siguiente. (Un filtro aparte detecta las fechas pasadas y le avisa al cliente; tu trabajo es solo extraer lo que el cliente dijo, tal cual.)
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
  del municipio, no el texto literal.
  ⚠️ MUY IMPORTANTE — NO extraigas location si el mensaje contiene datos
  personales del contrato (nombre + cédula/documento + email/teléfono). En ese
  contexto la ciudad que aparece es la DIRECCIÓN del cliente, no el municipio
  de la finca. Ejemplo: "Camilo Riveros 111123211 ca@hotmail.com 3102001100
  villavicencio" → contractFields con esos datos, location OMITIDO.
  Ejemplos de corrección de typos:
    "melar", "mlgar", "melgr", "melgaar" → "Melgar"
    "viavicencio", "villaviciencio", "vilavicencio", "villavi" → "Villavicencio"
    "jirardot", "girardó", "girardot" → "Girardot"
    "anapoma", "anapoyma" → "Anapoima"
    "carmen apicala", "apicala", "carmen de apical" → "Carmen de Apicalá"
    "restrpo", "restrepo" → "Restrepo"
  Reconoce el municipio aunque venga con preposición ("en melar", "para melgar",
  "voy a melgar"), en minúsculas, sin tildes o con typos de 1-2 letras.
  ⚠️ TAMBIÉN extrae el municipio cuando el cliente PREGUNTA por disponibilidad
  o pide ver opciones ahí — esas frases SÍ indican la zona deseada:
    "¿tienes fincas en Santa Marta?" → location="Santa Marta"
    "hay casas en Cartagena?" / "tienen algo en Melgar" → ese municipio
    "ahora quiero ver fincas de Cartagena" / "muéstrame en Girardot" → ese municipio
  Si el cliente nombra un municipio NUEVO (distinto al de antes), devuélvelo —
  el bot regenerará el catálogo para esa zona. NO lo dejes vacío solo porque la
  frase sea una pregunta.
  Devuelve "RECOMENDADAS" si el cliente expresa que NO tiene preferencia /
  no conoce / quiere que recomendemos / quiere ver varias zonas. Patrones:
  "no sé", "no se", "no tengo lugar", "no tengo idea", "no tengo preferencia", "no tengo en mente",
  "donde sea", "donde recomiendes", "donde tú me digas", "lo que tú me digas", "cualquier lugar",
  "cualquier zona", "cualquiera", "da igual", "me da lo mismo", "tú decides", "sorpréndeme",
  "recomiéndame", "recomiéndeme", "que me recomiendes", "lo que sugieras", "lo que prefieras",
  **"alrededores"**, **"los alrededores"**, **"por los alrededores"**, **"cerca a Bogotá"**,
  **"cerca de Bogotá"**, **"alrededor de Bogotá"**, **"varias zonas"**, **"diferentes zonas"**,
  **"opciones de diferentes lugares"**, **"varios sitios"**,
  **"la costa"**, **"en la costa"**, **"por la costa"**, **"la costa caribe"**, **"el caribe"**.
  Si dice cualquier variante de las anteriores → location="RECOMENDADAS".
  (Una CIUDAD costera concreta — "Cartagena", "Santa Marta", "Barranquilla" —
  SÍ es un municipio: devuélvela como location, NO como "RECOMENDADAS". Solo
  "la costa" / "el caribe" genéricos van a "RECOMENDADAS".)

  ⚠️ CRÍTICO — EXCLUSIÓN SIN MUNICIPIO: si el cliente SOLO dice qué zona NO
  quiere (ej. "que no sean los llanos", "que no sea en el meta", "no en
  Villavicencio", "no llanos", "fuera del Tolima", "todos MENOS los llanos",
  "todas las zonas EXCEPTO el Tolima", "SIN los llanos") y NO menciona un
  municipio específico al que SÍ quiera ir → eso significa que NO tiene una preferencia
  puntual, solo una exclusión → devuelve location="RECOMENDADAS" y
  wantsRecomendadas=true. NO dejes location vacío en ese caso (si lo dejas
  vacío, el bot se queda preguntando por el municipio en bucle). La exclusión
  de zona la aplica otro filtro aparte; tu trabajo aquí es marcar que el
  cliente está listo para ver el catálogo recomendado.
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
- excludedRegions: array de las MACRO-ZONAS que el cliente pide EVITAR / no
  quiere. Valores EXACTOS permitidos: "LLANOS", "TOLIMA", "CUNDINAMARCA",
  "COSTA". INTERPRETA LA INTENCIÓN — el cliente lo dice de mil formas y NO hay
  que adivinar fraseos exactos; entiende el sentido:
    "no los llanos", "todos menos el llano", "que no sea Villavicencio",
    "nada del Meta", "el llano no", "menos Tolima", "evítame Cundinamarca",
    "lejos de la costa", "que no me mandes Restrepo", "sin Acacías", etc.
  Mapea la ciudad/zona mencionada a su MACRO-ZONA. Referencia:
    LLANOS = Villavicencio, Restrepo, Acacías, Cumaral, Granada, San Martín,
             Apiay, Puerto López, Guamal, depto. del Meta (los Llanos Orientales).
    TOLIMA = Melgar, Carmen de Apicalá, Flandes, Honda, Ibagué, Lérida.
    CUNDINAMARCA = Girardot, Anapoima, Tocaima, Tenjo, La Mesa, Nilo, Tabio, Villeta.
    COSTA = Cartagena, Santa Marta, Barranquilla, Islas del Rosario, San Andrés (el Caribe).
  Si el cliente excluye una CIUDAD suelta (ej. "Villavicencio no"), incluye su
  macro-zona entera (LLANOS). Si NO pide evitar ninguna zona, OMITE el campo
  (no devuelvas []).
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
  } catch (err) {
    // Si OpenAI falla (timeout, 429, 5xx, sin cupo) devolvemos {} → el bot
    // actúa como si el cliente no hubiera dado datos y los vuelve a pedir.
    // Logueamos para poder diagnosticar (¿cuota de OpenAI? ¿outage?).
    console.error("[extractor] generateText falló — devuelvo {}:", err);
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
  // Normalizar `excludedRegions`: el LLM puede devolver minúsculas, duplicados
  // o valores fuera del set permitido. Dejamos solo LLANOS/TOLIMA/CUNDINAMARCA
  // /COSTA en mayúsculas y sin repetir. Si queda vacío, OMITIMOS el campo (no
  // lo ponemos como [] ni undefined → así `mergeEntities` conserva una
  // exclusión previa si en este turno el cliente no la repitió).
  if (Array.isArray(p.excludedRegions)) {
    const VALID = new Set(["LLANOS", "TOLIMA", "CUNDINAMARCA", "COSTA"]);
    const cleaned = Array.from(
      new Set(
        p.excludedRegions
          .map((r) => String(r ?? "").trim().toUpperCase())
          .filter((r) => VALID.has(r)),
      ),
    );
    if (cleaned.length > 0) {
      p = { ...p, excludedRegions: cleaned };
    } else {
      p = { ...p };
      delete p.excludedRegions;
    }
  }

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
