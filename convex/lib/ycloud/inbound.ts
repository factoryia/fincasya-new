import type { Id } from "../../_generated/dataModel";
import type { BotEntities } from "../bot/types";
import {
  capacityCeilForCupo,
  capacityCeilRelaxedForCupo,
  inferRetailerIdFromCatalogTitle,
} from "../bot/entities";
import { INBOUND_DEBOUNCE_MS, MAX_CATALOG_PRODUCTS_PER_SEND } from "./constants";

async function isStillThisTailUserMessage(
  ctx: any,
  deps: { api: any },
  conversationId: Id<"conversations">,
  insertedMsgId: string,
  _insertedAt: number,
): Promise<boolean> {
  // Antes este chequeo también miraba `conv.lastMessageAt > insertedAt`. Eso
  // causaba RACE CONDITION cuando el bot estaba enviando un batch de catálogo
  // (con delays entre cards) y el cliente pickaba una finca DURANTE el envío:
  //
  //   1. Cliente envía msgs M1 (al inicio del flujo).
  //   2. Bot procesa M1 → empieza a enviar 4 cards de catálogo (~3s).
  //   3. Cliente, ANTES de que termine el envío, responde con "Quiero esta"
  //      (M2). Inserta M2 con createdAt=T.
  //   4. Bot termina el catálogo + closing message → llama
  //      `updateLastMessageAt` → conv.lastMessageAt = T+3.
  //   5. M2 termina el debounce (4s). Llama isStillThisTailUserMessage.
  //      Chequeo viejo: T+3 > T → return false → M2 se cancela.
  //   6. El "Quiero esta" queda SIN procesarse y el bot nunca llega a
  //      preguntar por mascotas.
  //
  // Solución: el segundo chequeo (getLatestUserMessage) ya cubre el caso
  // legítimo "skip mensajes user anteriores cuando hay uno más reciente". El
  // chequeo viejo de lastMessageAt agregaba un falso negativo cuando el bot
  // estaba activo. Por eso lo removemos: confiamos solo en que el msg
  // insertado siga siendo el último mensaje DEL USUARIO.
  void _insertedAt;
  const conv = await ctx.runQuery(deps.api.conversations.getById, { conversationId });
  if (!conv) return false;
  const latest = (await ctx.runQuery(deps.api.messages.getLatestUserMessage, {
    conversationId,
    scanLimit: 50,
  })) as { _id?: string } | null;
  return !!(latest && String(latest._id) === String(insertedMsgId));
}

/**
 * Heurística para decidir si el mensaje del cliente parece una pregunta tipo FAQ
 * que vale la pena resolver con el RAG (mascotas, horarios, pagos, ubicación, etc.).
 *
 * DELIBERADAMENTE conservadora: si hay duda, devuelve false. Disparar el RAG
 * cuando el cliente está dando datos del flujo (ej. "quiero reservar 22 amigos
 * en Melgar") rompe la experiencia con un volcado de FAQs.
 *
 * Reglas:
 *   - Trae `?` o `¿` → true.
 *   - Empieza con palabra interrogativa explícita (qué/cómo/cuál/dónde/cuándo/
 *     cuánto/puedo/se puede/me regalas/me dices/sabes/tienen/aceptan/permiten/
 *     hay/incluye) → true.
 *   - Mensaje corto (<=120 chars) con término FAQ inequívoco (horario, check-in,
 *     mascota, piscina, cancelación, formas de pago, política, reglas) → true.
 *   - "reserva/reservar/abono/depósito" SOLO se consideran si ya cumplió alguna
 *     de las reglas anteriores. Por sí solas NO disparan (son transaccionales).
 *   - Default: false.
 */
/**
 * Detecta si el cliente está pidiendo el modo "alrededores" / multi-zona: en
 * lugar de un solo municipio, quiere ver opciones de VARIOS lugares cercanos
 * (o sin preferencia específica). Cuando se detecta, el catálogo amplía el
 * cap a 25 fincas (vs. las 12 por defecto) y se priorizan las favoritas.
 *
 * Patrones cubiertos:
 *   - "alrededores", "los alrededores", "por los alrededores"
 *   - "alrededor de Bogotá", "cerca a Bogotá", "cerca de Bogotá"
 *   - "varias zonas", "diferentes zonas", "varios sitios"
 *   - "opciones de varios lados", "muestrame opciones cercanas"
 *
 * No se confunde con "no preferencia" pura: las frases tipo "no sé / donde sea"
 * disparan `wantsRecomendadas` en el extractor pero NO se consideran
 * "alrededores" (el cliente sin preferencia ve el cap normal, no expandido).
 */
function wantsExpandedSearch(text: string): boolean {
  const t = String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  if (t.length === 0 || t.length > 240) return false;
  return (
    /\b(alrededor(es)?|por\s+los?\s+alrededor(es)?|en\s+los?\s+alrededor(es)?)\b/.test(
      t,
    ) ||
    /\bcerca\s+(a|de|por)\s+(bogota|cundinamarca|la\s+capital)\b/.test(t) ||
    /\b(varias?|diferentes?|distintas?)\s+(zonas|ciudades|lugares|municipios|sitios)\b/.test(
      t,
    ) ||
    /\b(opciones?|fincas?)\s+(de|en)\s+(varios?|diferentes?|distintas?)\s+(lados|lugares|zonas|sitios|municipios)\b/.test(
      t,
    )
  );
}

/**
 * Detecta si el cliente pregunta por un PASADÍA (plan de día sin hospedaje).
 *
 * El pasadía es un servicio aparte: el cliente llega en la mañana y se va en
 * la tarde, sin pernoctar. Tiene reglas propias (solo Villavicencio, martes a
 * jueves, 9am-5pm) y el valor lo configura un asesor.
 *
 * Triggers: "pasadía", "pasar el día", "pasar un día", "plan de día",
 * "day pass", "solo por el día" (sin quedarse a dormir).
 */
function looksLikePasadia(text: string): boolean {
  const t = String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  if (t.length === 0 || t.length > 240) return false;
  return (
    /\bpasa?d[ií]as?\b/.test(t) ||
    /\bpasar\s+(el|un|los?)\s+d[ií]as?\b/.test(t) ||
    /\bplan\s+de\s+d[ií]a\b/.test(t) ||
    /\bday\s*pass\b/.test(t) ||
    /\b(solo|nada\s+mas|unicamente)\s+(por\s+)?el\s+d[ií]a\b/.test(t)
  );
}

/**
 * ¿El último mensaje del asistente fue el OFRECIMIENTO de pasadía (turno 1)?
 * Se usa para saber que el mensaje actual del cliente es la RESPUESTA a ese
 * ofrecimiento (turno 2) — el cliente normalmente contesta "sí" / "no" /
 * "quiero hospedaje", sin repetir la palabra "pasadía", así que no se puede
 * depender de `looksLikePasadia` para detectar el turno 2.
 *
 * Firma: el mensaje del turno 1 contiene "*pasadías*" + "martes a jueves".
 * Los mensajes de cierre / escalada de pasadía NO llevan "martes a jueves",
 * así que no generan falso positivo (no hay bucle).
 */
function lastAssistantMsgIsPasadiaOffer(
  msgs: Array<{ sender?: string; content?: string }>,
): boolean {
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].sender === "assistant") {
      const c = String(msgs[i].content ?? "").toLowerCase();
      return c.includes("pasad") && c.includes("martes a jueves");
    }
  }
  return false;
}

const CATALOG_EXPANDED_LIMIT = 25;

/**
 * Mapeo regional oficial (lista enviada por Adriana 2026-05-19): municipios
 * agrupados por macro-zona. Se usa para detectar inclusión ("cerca a Bogotá"
 * → Cundinamarca) o exclusión ("no en los llanos" → Meta/Llanos).
 *
 * Keywords normalizadas (lowercase, sin tildes) para matchear contra
 * `property.location`. Comparación por `includes`, así que keywords cortas
 * cubren variantes ("apiay" matchea "Vereda Apiay").
 */
const REGIONS = {
  LLANOS: [
    "villavicencio",
    "restrepo",
    "san martin",
    "granada",
    "cumaral",
    "apiay",
    "paratebueno",
    "puerto lopez",
    "puerto gaitan",
    "guamal",
    "barranca de upia",
    "barranca",
    "acacias",
    "meta",
  ],
  TOLIMA: [
    "flandes",
    "carmen de apicala",
    "honda",
    "herveo",
    "lerida",
    "ortega",
    "melgar",
    "armero",
    "san antonio",
    "icononzo",
    "venadillo",
    "ambalema",
    "villarica",
    "libano",
    "valle de san juan",
    "alvarado",
    "cunday",
    "anzoategui",
    "murillo",
    "san luis",
    "prado",
    "santa isabel",
    "suarez",
    "piedras",
    "planadas",
    "ibague",
    "tolima",
  ],
  CUNDINAMARCA: [
    "nilo",
    "tocaima",
    "girardot",
    "villapinzon",
    "zipaquira",
    "facatativa",
    "choconta",
    "cogua",
    "tabio",
    "guaduas",
    "bojaca",
    "gachala",
    "la mesa",
    "pacho",
    "san cayetano",
    "soacha",
    "la calera",
    "puerto salgar",
    "villeta",
    "la pena",
    "caqueza",
    "funza",
    "yacopi",
    "nemocon",
    "anapoima",
    "viota",
    "tenjo",
    "cundinamarca",
  ],
};

/**
 * Detecta zonas geográficas que el cliente quiere EXCLUIR del catálogo.
 * Mapea frases naturales → lista de keywords de `property.location` a filtrar.
 */
const ZONE_EXCLUSIONS: Array<{
  triggerRegex: RegExp;
  excludeLocationKeywords: string[];
}> = [
  {
    // "no llanos", "no en los llanos", "no en el meta", "fuera del llano", etc.
    triggerRegex:
      /\b(no\s+(?:en\s+)?(?:los\s+|el\s+)?(?:llanos?|meta)|fuera\s+(?:de\s+)?(?:los\s+)?(?:llanos?|meta)|lejos\s+(?:de\s+)?(?:los\s+)?(?:llanos?|meta)|evita\s+(?:los\s+)?(?:llanos?|meta)|que\s+no\s+sea\s+(?:en\s+)?(?:los\s+)?(?:llanos?|meta))\b/i,
    excludeLocationKeywords: REGIONS.LLANOS,
  },
  {
    // "no en tolima", "fuera de tolima", "evita tolima".
    triggerRegex:
      /\b(no\s+(?:en\s+)?tolima|fuera\s+(?:de\s+)?tolima|evita\s+tolima|que\s+no\s+sea\s+(?:en\s+)?tolima)\b/i,
    excludeLocationKeywords: REGIONS.TOLIMA,
  },
  {
    // "no en cundinamarca", etc.
    triggerRegex:
      /\b(no\s+(?:en\s+)?cundinamarca|fuera\s+(?:de\s+)?cundinamarca|evita\s+cundinamarca)\b/i,
    excludeLocationKeywords: REGIONS.CUNDINAMARCA,
  },
];
function detectExcludedZoneKeywords(text: string): string[] {
  const t = String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  const out = new Set<string>();
  for (const rule of ZONE_EXCLUSIONS) {
    if (rule.triggerRegex.test(t)) {
      for (const kw of rule.excludeLocationKeywords) out.add(kw);
    }
  }
  return Array.from(out);
}

/**
 * Detecta zonas geográficas que el cliente quiere INCLUIR (restricción
 * positiva). Mapea frases naturales → lista de keywords obligatorias.
 *
 * Soporta:
 *   - "cerca a Bogotá" / "cerca de Bogotá" → CUNDINAMARCA (los municipios
 *     cercanos a la capital están en este departamento).
 *   - "en Tolima" / "por Tolima" → TOLIMA.
 *   - "en los llanos" / "en el meta" → LLANOS.
 *   - "en Cundinamarca" → CUNDINAMARCA.
 *
 * No se confunde con "no en X": las reglas de inclusión solo disparan si NO
 * hay negación antes (ej. "en los llanos" sí, "no en los llanos" no).
 */
const ZONE_INCLUSIONS: Array<{
  triggerRegex: RegExp;
  restrictToLocationKeywords: string[];
}> = [
  {
    // "cerca a bogota", "cerca de bogota", "cerca por bogota", "alrededor de bogota"
    triggerRegex:
      /\b(?<!no\s)cerca\s+(a|de|por)\s+(bogota|la\s+capital)\b/i,
    restrictToLocationKeywords: REGIONS.CUNDINAMARCA,
  },
  {
    // "en tolima", "por tolima" (sin "no" antes)
    triggerRegex: /\b(?<!no\s)(?:en|por)\s+tolima\b/i,
    restrictToLocationKeywords: REGIONS.TOLIMA,
  },
  {
    // "en llanos", "en los llanos", "en el llano", "en meta" (sin "no" antes)
    triggerRegex:
      /\b(?<!no\s)(?:en|por)\s+(?:los\s+|el\s+)?(?:llanos?|meta)\b/i,
    restrictToLocationKeywords: REGIONS.LLANOS,
  },
  {
    // "en cundinamarca", "por cundinamarca" (sin "no" antes)
    triggerRegex: /\b(?<!no\s)(?:en|por)\s+cundinamarca\b/i,
    restrictToLocationKeywords: REGIONS.CUNDINAMARCA,
  },
];
function detectRestrictedZoneKeywords(text: string): string[] {
  const t = String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  const out = new Set<string>();
  for (const rule of ZONE_INCLUSIONS) {
    if (rule.triggerRegex.test(t)) {
      for (const kw of rule.restrictToLocationKeywords) out.add(kw);
    }
  }
  return Array.from(out);
}

/**
 * Aísla las líneas del burst que parecen contener UNA PREGUNTA. Devuelve un
 * ARRAY: cada elemento es una pregunta separada. El cliente suele mezclar
 * varias preguntas + datos de flujo en un mismo burst:
 *   "Esta opción me gusta\nHay algo adicional?\nCuáles son los horarios\nTengo 2 mascotas"
 * → preguntas = ["Hay algo adicional?", "Cuáles son los horarios"]
 *
 * Cada pregunta se consulta por separado en el RAG (ver `inbound.ts`), para
 * que el bot pueda responder TODAS — no solo la primera que matchee.
 *
 * Si NINGUNA línea parece pregunta, devuelve `[]`.
 */
function extractQuestionLinesArray(text: string): string[] {
  const lines = String(text ?? "")
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];
  if (lines.length === 1) return looksLikeQuestion(lines[0]) ? [lines[0]] : [];
  return lines.filter((l) => looksLikeQuestion(l));
}

function looksLikeQuestion(text: string): boolean {
  const t = String(text ?? "").trim();
  if (t.length < 4 || t.length > 250) return false;
  if (t.includes("?") || t.includes("¿")) return true;

  const lower = t.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");

  // ¿Empieza con palabra interrogativa o frase de petición de info?
  const startsAsQuestion =
    /^(que\b|cual\b|cuales\b|cuando\b|donde\b|como\b|cuanto\b|cuanta\b|cuantos\b|cuantas\b|puedo\b|se puede\b|me regala|me regalas|me dices|me dice|me confirma|me explica|me explican|me cuent|sabes\b|saben\b|tienen\b|tiene\b|aceptan\b|acepta\b|permiten\b|permite\b|hay\b|incluye\b|incluyen\b|conoce|conoces|necesito saber|quisiera saber|una consulta|una pregunta)\b/.test(
      lower,
    );
  if (startsAsQuestion) return true;

  // Patrones de AFIRMACIÓN: el cliente está aportando datos de flujo, no
  // preguntando. NUNCA tratar estos como pregunta aunque contengan keywords
  // FAQ-y (ej. "Voy a llevar 3 mascotas" → mencionando "mascotas" no es una
  // pregunta sobre la política de mascotas). Sin esta exclusión el RAG hace
  // match sobre la keyword prominente y termina respondiendo con la FAQ que
  // el FSM ya iba a emitir como bloque estructurado — duplicando contenido.
  //
  // Cubrimos también prefijos de confirmación tipo "si voy a llevar 3 perros",
  // "dale, llevo 2 gatos", "ok, somos 5", etc. — donde el cliente confirma +
  // aporta el dato en el mismo mensaje. Sin el prefijo opcional, el check fallaba
  // porque la línea empezaba con "si"/"dale" y no con el verbo de estado.
  const isStatementPattern =
    /^((?:s[ií]|dale|claro|listo|ok+|okey|perfecto|por supuesto)[\s,.\-:]+)?(tengo|llevo|voy\s+(a|con)\b|vamos\s+(a|con)\b|viajo\s+con\b|viajamos\s+con\b|traigo|trae|soy\s+con\b|somos|llevar[ée]|llevamos|ire?\s+con|iremos\s+con|estoy\s+con\b|estamos\s+con\b)\b/.test(
      lower,
    );
  if (isStatementPattern) return false;

  // Respuesta de DATO puro: "2 perros", "3 mascotas", "17 personas", "2",
  // "dos perros", "1 niño". El cliente está RESPONDIENDO un dato del flujo
  // (cuántas mascotas / personas) que el bot le acaba de preguntar — NO está
  // preguntando. Sin esta exclusión, "2 perros" matchea `perros` en
  // `shortAndFaqy`, dispara la FAQ de mascotas, y el wrapper la compounda con
  // el bloque `pet_rules_shown` del FSM → el cliente ve la política de
  // mascotas DOS veces (bug reportado: "le repitió el mensaje de mascotas").
  const isBareDataAnswer =
    /^(\d{1,3}|un[oa]?|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s*(perr[oa]s?|gat[oa]s?|mascotas?|personas?|pax|adultos?|ninos?|noches?|dias?)?[\s.!]*$/.test(
      lower,
    );
  if (isBareDataAnswer) return false;

  // RECHAZO / negación: "no quiero personal de servicio", "no gracias",
  // "no necesito", "no". El cliente está DECLINANDO algo, NO preguntando —
  // aunque la frase contenga una keyword FAQ-y ("personal de servicio").
  // Sin esto, "NO QUIERO PERSONAL DE SERVICIO" matchea `personal de servicio`
  // en `shortAndFaqy`, dispara la FAQ y el bot le RE-ENVÍA todo el bloque de
  // personal de servicio que el cliente acaba de rechazar.
  const isRefusalStatement =
    /^no\b[\s,.!]*$/.test(lower) ||
    /^no\s+(quiero|necesito|deseo|requiero|me\s+interesa|voy\s+a|gracias|por\s+ahora|hace\s+falta)\b/.test(
      lower,
    ) ||
    /^(no\s+gracias|as[ií]\s+esta\s+bien|nada\s+mas\s+gracias)\b/.test(lower);
  if (isRefusalStatement) return false;

  // Mensaje corto con términos FAQ inequívocos.
  const shortAndFaqy =
    t.length <= 140 &&
    /\b(horario|horarios|check ?in|check ?out|hora\s+de\s+(entrada|salida|llegada|llegar)|mascota|mascotas|perr[oa]s?|gatos?|piscina|jacuzzi|bbq|raza|cancelaci[oó]n|cancelar|forma[s]?\s+de\s+pago|metodo[s]?\s+de\s+pago|c[oó]mo\s+pago|c[oó]mo\s+se\s+paga|pol[ií]tica|reglas?|personal\s+de\s+servicio|cocinera|empleada|servicio\s+dom[eé]stico|aseo|ubicaci[oó]n|direcci[oó]n|d[oó]nde\s+queda|d[oó]nde\s+esta|c[oó]mo\s+llego|early\s+check|late\s+check|entrada\s+anticipada|salida\s+tardia)\b/.test(
      lower,
    );
  if (shortAndFaqy) return true;

  return false;
}

/** Texto único para el turno: última ráfaga de mensajes del usuario hasta el último del asistente. */
function mergeTrailingUserBurst(
  msgs: Array<{ sender?: string; content?: string }>,
): string {
  const parts: string[] = [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.sender === "assistant") break;
    if (m.sender === "user") {
      const t = String(m.content ?? "").trim();
      if (t) parts.unshift(t);
    }
  }
  return parts.join("\n");
}

export async function processInboundMessageV2(
  ctx: any,
  args: {
    eventId: string;
    phone: string;
    name: string;
    text: string;
    wamid?: string;
    replyToWamid?: string;
    type?: "text" | "image" | "audio" | "video" | "document";
    mediaUrl?: string;
  },
  deps: {
    internal: any;
    api: any;
    transcribeAudio: (url: string, prompt?: string) => Promise<string>;
    runBotTurn: (input: any) => Promise<any>;
  },
) {
  const rawText = String(args.text ?? "").trim();
  if (/^(status|presence)\s*:\s*active$/i.test(rawText)) return;

  const contactId: Id<"contacts"> = await ctx.runMutation(
    deps.internal.ycloud.getOrCreateContact,
    { phone: args.phone, name: args.name },
  );
  const { conversationId } = await ctx.runMutation(
    deps.internal.ycloud.getOrCreateConversation,
    { contactId },
  );

  let finalContent = args.text;
  if (args.type === "audio" && args.mediaUrl) {
    try {
      const transcript = await deps.transcribeAudio(args.mediaUrl, "FincasYa, fincas, reservas, Colombia");
      finalContent = `[Voz] ${transcript}`;
    } catch {
      finalContent = "[Audio] (no se pudo transcribir)";
    }
  }

  const now = Date.now();
  const replyToWamid = String(args.replyToWamid ?? "").trim();
  const insertedMsgId = await ctx.runMutation(deps.internal.messages.insertUserMessage, {
    conversationId,
    content: finalContent,
    createdAt: now,
    type: args.type,
    mediaUrl: args.mediaUrl,
    metadata: replyToWamid ? { replyToWamid } : undefined,
  });

  await new Promise((r) => setTimeout(r, INBOUND_DEBOUNCE_MS));

  const conv = await ctx.runQuery(deps.api.conversations.getById, { conversationId });
  if (!conv || (conv.lastMessageAt ?? 0) > now) return;

  const latestMsg = (await ctx.runQuery(deps.api.messages.getLatestUserMessage, {
    conversationId,
    scanLimit: 50,
  })) as any;
  if (!latestMsg || String(latestMsg._id) !== String(insertedMsgId)) return;
  if (conv.status !== "ai") return;

  const recentForBurst = (await ctx.runQuery(deps.api.messages.listRecent, {
    conversationId,
    limit: 30,
  })) as Array<{ sender?: string; content?: string }>;
  const burstText = mergeTrailingUserBurst(recentForBurst);
  const textForTurn = burstText || String(finalContent ?? "").trim();

  const lowerText = String(textForTurn ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");

  // PQRS / queja / reclamo / problema operativo: NO es flujo de venta — escalar
  // con mensaje empático específico (no el genérico de reserva).
  const looksLikeComplaint =
    /\b(pqrs|queja|quejas|quejarme|reclamo|reclamos|reclamar|reclamacion|denuncia|denunciar|peticion|inconformidad|inconforme)\b/.test(
      lowerText,
    ) ||
    /\b(no estoy buscando (finca|reserva)|no (es|estoy) (para|por) (reserva|reservar|buscar)|no (quiero|deseo) reservar|no es para reservar)\b/.test(
      lowerText,
    ) ||
    /\b(se da[nñ]o|se rompio|esta da[nñ]ad[oa]|no funciona|no sirve|esta malo|esta dañado)\b/.test(
      lowerText,
    );

  // Petición explícita de asesor humano (flujo normal, no necesariamente queja).
  //
  // ⚠️ CRÍTICO: NO incluir la palabra suelta "persona". El cliente dice
  // constantemente "somos 13 personas", "13 persona familia", "para 5
  // personas" al dar el cupo — eso NO es pedir un asesor. Igual con la
  // palabra suelta "llamar" ("voy a llamar a mi familia"). Solo cuentan
  // patrones inequívocos de petición de atención humana.
  const wantsHumanGeneric =
    /\b(hablar con (un |una )?(asesor|agente|persona|humano|alguien)|persona real|asesor|agente|atencion humana|servicio al cliente|comunicame con|pasame con|me comunican con|que me llamen|me pueden llamar|alguien (me )?ayud[ae]|me (puede|pueden) ayudar real|no me sirve (este|el) bot|no entiend[eo]s? nada|ya me cans[eé] del bot)\b/.test(
      lowerText,
    );

  const wantsHuman = looksLikeComplaint || wantsHumanGeneric;
  if (wantsHuman) {
    const t0 = Date.now();
    await ctx.runMutation(deps.internal.conversations.escalate, {
      conversationId,
      assignedUserId: process.env.CHATBOT_AUTO_ASSIGN_ADVISOR_ID?.trim() || undefined,
    });
    const handoffMsg = looksLikeComplaint
      ? "Lamento la situación 🙏 Te conecto con un asesor para gestionar tu solicitud. Un agente te escribirá en breve 🤝"
      : "Perfecto, te comunico con un asesor. Un agente te escribirá en breve ✨";
    await ctx.runMutation(deps.internal.messages.insertAssistantMessage, {
      conversationId,
      content: handoffMsg,
      createdAt: t0,
    });
    await ctx.runMutation(deps.internal.messages.insertSystemMessage, {
      conversationId,
      content:
        looksLikeComplaint
          ? "🚨 El cliente pidió atención humana (posible PQRS o tema operativo). Revisar y contactar. La IA quedó en pausa."
          : "📣 El cliente pidió hablar con un asesor. Revisar conversación y contactar. La IA quedó en pausa.",
      createdAt: t0 + 5,
      metadata: {
        kind: "inbox_escalation_alert",
        escalationReason: looksLikeComplaint ? "client_complaint" : "client_requested",
      },
    });
    await ctx.runAction(deps.internal.ycloud.sendWhatsAppMessage, {
      to: args.phone,
      text: handoffMsg,
      wamid: args.wamid,
    });
    await ctx.runMutation(deps.internal.conversations.updateLastMessageAt, { conversationId });
    return;
  }

  const session = await ctx.runQuery(deps.internal.botSessions.getByConversation, { conversationId });
  const currentPhase = session?.phase ?? "welcome";
  const currentSamePhaseTurnCount = session?.samePhaseTurnCount ?? 0;
  const currentPhaseEnteredAt = session?.phaseEnteredAt ?? Date.now();
  let currentEntities = session?.entities ?? {};

  // ── PASADÍA (plan de día, sin hospedaje) — flujo de 2 turnos ─────────────
  // El pasadía es un servicio aparte del hospedaje: SOLO Villavicencio, martes
  // a jueves, 9am-5pm, y el VALOR lo confirma un asesor (no está automatizado).
  //
  //   TURNO 1 — el cliente menciona "pasadía" → el bot explica las condiciones
  //     (solo Villavicencio) y pregunta si quiere continuar con el pasadía
  //     (→ asesor) o prefiere reservar una finca para hospedaje. NO envía
  //     catálogo, NO escala, NO re-pregunta datos que el cliente ya dio.
  //   TURNO 2 — el cliente responde al ofrecimiento:
  //     • Quiere hospedaje / otra reserva → cae al flujo normal (runBotTurn).
  //     • Declina del todo → cierre cordial breve, sin escalar.
  //     • Cualquier otra cosa (confirma el pasadía) → escala al asesor.
  //
  // Solo dispara en fases tempranas (welcome / collecting / catalog_sent).
  const pasadiaPhaseOk =
    currentPhase === "welcome" ||
    currentPhase === "collecting" ||
    currentPhase === "catalog_sent";
  const isPasadiaFollowUp =
    pasadiaPhaseOk && lastAssistantMsgIsPasadiaOffer(recentForBurst);
  const isPasadiaTrigger =
    pasadiaPhaseOk && !isPasadiaFollowUp && looksLikePasadia(textForTurn);

  if (isPasadiaTrigger) {
    // TURNO 1 — explicar condiciones + preguntar. SIN catálogo, SIN escalar.
    const tPas = Date.now();
    const pasadiaMsg = [
      "¡Hola! ☀️ Qué buena idea planear un día de descanso.",
      "",
      "Te cuento que nuestros *pasadías* funcionan bajo estas condiciones:",
      "",
      "• 📍 *Ubicación:* disponible *únicamente en Villavicencio*.",
      "• 📅 *Días:* entre semana, de martes a jueves.",
      "• ⏰ *Horario:* de 9:00 a.m. a 5:00 p.m.",
      "",
      "El *valor* del pasadía lo confirma directamente un asesor.",
      "",
      "¿Quieres que te conecte con un asesor para coordinar tu *pasadía en Villavicencio*? 🤝",
      "",
      "O si prefieres, te ayudo a *reservar una finca para hospedaje* (con noche) en la fecha y el lugar que quieras 🏡",
    ].join("\n");
    await ctx.runMutation(deps.internal.messages.insertAssistantMessage, {
      conversationId,
      content: pasadiaMsg,
      createdAt: tPas,
    });
    await ctx.runAction(deps.internal.ycloud.sendWhatsAppMessage, {
      to: args.phone,
      text: pasadiaMsg,
      wamid: args.wamid,
    });
    await ctx.runMutation(deps.internal.conversations.updateLastMessageAt, {
      conversationId,
    });
    return;
  }

  if (isPasadiaFollowUp) {
    // TURNO 2 — el cliente respondió al ofrecimiento del pasadía.
    const wantsHospedajeInstead =
      /\b(hospedaje|hospedarme|hospedarnos|alojamiento|alojarme|reservar (una )?finca|alquilar (una )?finca|con noche|por noche|noches?|dormir|quedarnos|quedarme|pernoctar|otra fecha|otras fechas|mas fechas|otro lugar|otro municipio|otra ciudad|otra zona)\b/.test(
        lowerText,
      );
    const declinesEverything =
      !wantsHospedajeInstead &&
      /^(no|no gracias|nada mas|ya no|ninguno|asi no|no por ahora)\b[\s.!]*$/.test(
        lowerText,
      );

    if (wantsHospedajeInstead) {
      // El cliente pivotó a hospedaje normal → NO escalamos ni enviamos
      // catálogo aquí: dejamos que el flujo normal (`runBotTurn`, más abajo)
      // recoja los datos. No hacemos `return`.
    } else if (declinesEverything) {
      // El cliente no quiere nada más → cierre cordial breve, sin escalar.
      const tDecl = Date.now();
      const declMsg =
        "Entiendo 🙏 El *pasadía* lo manejamos únicamente en Villavicencio. Si más adelante quieres reservar una finca para *hospedaje*, con gusto te ayudo 🏡✨";
      await ctx.runMutation(deps.internal.messages.insertAssistantMessage, {
        conversationId,
        content: declMsg,
        createdAt: tDecl,
      });
      await ctx.runAction(deps.internal.ycloud.sendWhatsAppMessage, {
        to: args.phone,
        text: declMsg,
        wamid: args.wamid,
      });
      await ctx.runMutation(deps.internal.conversations.updateLastMessageAt, {
        conversationId,
      });
      return;
    } else {
      // El cliente confirma interés en el pasadía → escalar al asesor (el
      // valor del pasadía es manual, no está en el flujo automatizado).
      const tEsc = Date.now();
      const escMsg = [
        "¡Listo! ☀️ Te conecto con un asesor que coordina la *disponibilidad* y el *valor* de tu pasadía en Villavicencio.",
        "",
        "En breve te escribe para ayudarte 🤝 ✨",
      ].join("\n");
      await ctx.runMutation(deps.internal.conversations.escalate, {
        conversationId,
        assignedUserId:
          process.env.CHATBOT_AUTO_ASSIGN_ADVISOR_ID?.trim() || undefined,
      });
      await ctx.runMutation(deps.internal.messages.insertAssistantMessage, {
        conversationId,
        content: escMsg,
        createdAt: tEsc,
      });
      await ctx.runAction(deps.internal.ycloud.sendWhatsAppMessage, {
        to: args.phone,
        text: escMsg,
        wamid: args.wamid,
      });
      await ctx.runMutation(deps.internal.messages.insertSystemMessage, {
        conversationId,
        content:
          "☀️ El cliente confirmó interés en un PASADÍA (plan de día). Coordinar disponibilidad (solo Villavicencio, mar-jue, 9am-5pm) y el valor. La IA quedó en pausa.",
        createdAt: tEsc + 5,
        metadata: {
          kind: "inbox_escalation_alert",
          escalationReason: "pasadia_request",
        },
      });
      await ctx.runMutation(deps.internal.conversations.updateLastMessageAt, {
        conversationId,
      });
      return;
    }
  }

  // ── Media en fases post-catálogo → escalar a humano ──────────────────────
  // En `contract` / `quote_shown` / `pet_rules_shown` / `pet_check` / `done`,
  // si el cliente manda imagen / video / documento, casi siempre es:
  //   - Foto de la cédula (parte del contrato).
  //   - Comprobante de transferencia / pago.
  //   - Documento o foto extra para el asesor.
  // El bot NO sabe leer imágenes y no debería intentar adivinar. Escalamos
  // automáticamente para que un humano verifique.
  const isMediaMessage =
    args.type === "image" || args.type === "video" || args.type === "document";
  const phaseRequiresHumanForMedia: Array<typeof currentPhase> = [
    "pet_check",
    "pet_rules_shown",
    "quote_shown",
    "contract",
    "done",
  ];
  if (isMediaMessage && phaseRequiresHumanForMedia.includes(currentPhase)) {
    const tMedia = Date.now();
    await ctx.runMutation(deps.internal.conversations.escalate, {
      conversationId,
      assignedUserId:
        process.env.CHATBOT_AUTO_ASSIGN_ADVISOR_ID?.trim() || undefined,
    });
    const mediaHandoffMsg =
      "Gracias por enviarnos el documento 📎 Te conecto con un asesor para revisarlo y confirmarte los siguientes pasos. Un agente te escribirá en breve 🤝 ✨";
    await ctx.runMutation(deps.internal.messages.insertAssistantMessage, {
      conversationId,
      content: mediaHandoffMsg,
      createdAt: tMedia,
    });
    await ctx.runMutation(deps.internal.messages.insertSystemMessage, {
      conversationId,
      content:
        "📎 Cliente envió archivo/foto en fase post-catálogo. Revisar (puede ser cédula, comprobante de pago o documento adicional). La IA quedó en pausa.",
      createdAt: tMedia + 5,
      metadata: {
        kind: "inbox_escalation_alert",
        escalationReason: "media_post_catalog",
        phaseAtEscalation: currentPhase,
        mediaType: args.type,
        mediaUrl: args.mediaUrl ?? null,
      },
    });
    await ctx.runAction(deps.internal.ycloud.sendWhatsAppMessage, {
      to: args.phone,
      text: mediaHandoffMsg,
      wamid: args.wamid,
    });
    await ctx.runMutation(deps.internal.conversations.updateLastMessageAt, {
      conversationId,
    });
    return;
  }
  // Resolución de retailerId vía `replyToWamid`:
  //
  // El cliente puede haber enviado un BURST tipo:
  //   1. "quiero esta" (respondiendo a la tarjeta del catálogo → replyToWamid SET)
  //   2. "Voy a llevar 3 mascotas" (sin quote → replyToWamid NULL)
  //
  // Con el debounce, solo se procesa el ÚLTIMO webhook (mensaje #2). Su
  // `args.replyToWamid` viene NULL. Si solo miráramos `args.replyToWamid` aquí,
  // perderíamos la pista del catálogo que el cliente eligió en el mensaje #1.
  //
  // Solución: si el webhook actual NO trae replyToWamid, escanear los mensajes
  // de usuario recientes (desde el último mensaje del asistente) y usar el
  // PRIMER `replyToWamid` que encontremos en sus metadatos. Esto recupera la
  // selección del cliente aunque haya sido en un mensaje intermedio del burst.
  let resolvableReplyToWamid: string = replyToWamid;
  if (!resolvableReplyToWamid && !(currentEntities.selectedPropertyRetailerId ?? "").trim()) {
    try {
      const recentRaw = (await ctx.runQuery(deps.api.messages.listRecent, {
        conversationId,
        limit: 12,
      })) as Array<{
        sender?: string;
        content?: string;
        metadata?: { replyToWamid?: string };
      }>;
      // Recorrer DESC desde el más reciente hasta el último mensaje del asistente.
      for (let i = recentRaw.length - 1; i >= 0; i--) {
        const m = recentRaw[i];
        if (m.sender === "assistant") break;
        if (m.sender === "user") {
          const w = String(m.metadata?.replyToWamid ?? "").trim();
          if (w.length >= 8) {
            resolvableReplyToWamid = w;
            break;
          }
        }
      }
    } catch (err) {
      console.error(
        "inbound: error escaneando replyToWamid en historial reciente (degradado):",
        err,
      );
    }
  }

  if (resolvableReplyToWamid) {
    const pick = await ctx.runQuery(deps.internal.ycloud.getCatalogProductByOutboundWamid, {
      conversationId,
      wamid: resolvableReplyToWamid,
    });
    if (pick?.productRetailerId) {
      const prop = await ctx.runQuery(deps.api.whatsappCatalogs.getPropertyByRetailerId, {
        productRetailerId: pick.productRetailerId,
      });
      currentEntities = {
        ...currentEntities,
        selectedPropertyRetailerId: pick.productRetailerId,
        catalogUserPickedReply: true,
        ...(prop?.propertyName?.trim()
          ? { selectedPropertyName: prop.propertyName.trim() }
          : {}),
      };
    }
  }
  const turnCount = (session?.turnCount ?? 0) + 1;

  const recentMsgs = (await ctx.runQuery(deps.api.messages.listRecent, {
    conversationId,
    limit: 12,
  })) as Array<{ sender?: string; content?: string }>;
  const history = recentMsgs
    .filter((m) => m.sender === "user" || m.sender === "assistant")
    .map((m) => ({
      role: (m.sender === "assistant" ? "assistant" : "user") as "user" | "assistant",
      content: String(m.content ?? ""),
    }));

  // Pre-fetch RAG (FAQs) si el mensaje parece una pregunta. Si no es pregunta,
  // ahorramos la llamada de embeddings + vector search.
  //
  // `searchFaqForBot` ya devuelve SOLO el texto del top-1 entry (no concatena
  // varias FAQs distintas), con su score. Si score < minScore o no hay match,
  // devuelve `text: ""` y caemos al flujo normal sin RAG.
  //
  // IMPORTANTE: cuando el cliente envía un burst (varias cosas en mensajes
  // separados que se mergean con `\n`), por ejemplo "3 mascotas\nQué horarios
  // maneja", consultar el texto completo hace que el embedding semántico
  // matchee la palabra más prominente ("mascotas") en lugar de la pregunta
  // real ("horarios"). El RAG devolvería la FAQ de mascotas — que el FSM ya
  // va a emitir como pet_rules_shown estructurado — creando una respuesta
  // duplicada. Por eso aislamos la(s) línea(s) de pregunta del burst antes
  // de consultar el RAG.
  // RAG por CADA pregunta del burst. El cliente puede preguntar varias cosas
  // a la vez ("hay algo adicional?" + "cuáles son los horarios?"); consultamos
  // el RAG una vez por pregunta y combinamos los fragmentos distintos. Cap de
  // 3 preguntas para acotar costo de embeddings + latencia.
  let faqContext: string | null = null;
  const questionLines = extractQuestionLinesArray(textForTurn);
  if (questionLines.length > 0) {
    const faqChunks: string[] = [];
    for (const q of questionLines.slice(0, 3)) {
      if (!looksLikeQuestion(q)) continue;
      try {
        const ragResult = (await ctx.runAction(deps.api.knowledge.searchFaqForBot, {
          query: q,
        })) as { text?: string; title?: string; score?: number } | null;
        const t = String(ragResult?.text ?? "").trim();
        // Evitar duplicados: dos preguntas distintas pueden matchear la misma FAQ.
        if (t.length > 0 && !faqChunks.some((c) => c === t)) {
          faqChunks.push(t);
        }
      } catch (err) {
        console.error("inbound: searchFaqForBot fallo (degradado, sigue sin RAG):", err);
      }
    }
    if (faqChunks.length > 0) {
      faqContext = faqChunks.join("\n\n━━━━━━━━━━\n\n");
    }
  }

  // Recuperar los retailerIds del último batch de catálogo enviado. Se usa en
  // `runBotTurn` para resolver picks ambiguos del cliente (ej. "Quiero esta")
  // cuando el último catálogo contenía exactamente UNA finca.
  let lastCatalogRetailerIds: string[] = [];
  try {
    lastCatalogRetailerIds = (await ctx.runQuery(
      deps.internal.ycloud.getLatestCatalogRetailerIds,
      { conversationId },
    )) as string[];
  } catch (err) {
    console.error(
      "inbound: getLatestCatalogRetailerIds fallo (degradado, sigue sin resolver pick vago):",
      err,
    );
  }

  const result = await deps.runBotTurn({
    messageText: textForTurn,
    currentPhase,
    currentEntities,
    conversationHistory: history,
    currentSamePhaseTurnCount,
    currentPhaseEnteredAt,
    faqContext,
    contactName: args.name,
    lastCatalogRetailerIds,
    fetchStayQuote: async (e: BotEntities) => {
      const rid =
        e.selectedPropertyRetailerId?.trim() ||
        inferRetailerIdFromCatalogTitle(e.selectedPropertyName) ||
        "";
      const cin = e.checkIn?.trim();
      const cout = e.checkOut?.trim();
      if (!rid || !cin || !cout) return null;
      const data = (await ctx.runQuery(deps.api.whatsappCatalogs.getBotStayQuoteByRetailerId, {
        productRetailerId: rid,
        fechaEntrada: cin,
        fechaSalida: cout,
        cupo: e.cupo,
      })) as {
        text?: string;
        totals?: {
          propertyTitle?: string;
          nightly?: number;
          nightsCount?: number;
          subtotal?: number;
          appliedRule?: string;
          cupo?: number;
          damageDeposit?: number;
          wristbandFee?: number;
        };
      } | null;
      const text = String(data?.text ?? "").trim();
      if (!text) return null;
      return {
        text,
        totals: data?.totals
          ? {
              propertyTitle: String(data.totals.propertyTitle ?? "").trim(),
              nightly: Number(data.totals.nightly ?? 0),
              nightsCount: Number(data.totals.nightsCount ?? 0),
              subtotal: Number(data.totals.subtotal ?? 0),
              appliedRule: String(data.totals.appliedRule ?? "").trim(),
              cupo: Number(data.totals.cupo ?? 0),
              damageDeposit: Number(data.totals.damageDeposit ?? 0),
              wristbandFee: Number(data.totals.wristbandFee ?? 0),
            }
          : undefined,
      };
    },
  });

  if (
    !(await isStillThisTailUserMessage(ctx, deps, conversationId, String(insertedMsgId), now))
  ) {
    return;
  }

  await ctx.runMutation(deps.internal.botSessions.upsert, {
    conversationId,
    phone: args.phone,
    phase: result.nextPhase,
    entities: result.updatedEntities,
    turnCount,
    samePhaseTurnCount: result.samePhaseTurnCount,
    phaseEnteredAt: result.phaseEnteredAt,
  });

  const action = result.action;

  // ⚠️ Cuando `action === send_catalog`, DIFERIMOS el envío del replyText
  // (pre-catálogo "Te comparto las opciones disponibles") hasta saber si
  // hay fichas reales. Si el query devuelve vacío, NO enviamos el pre-catálogo
  // y vamos directo al mensaje de escalada — así evitamos la incoherencia
  // "te comparto opciones... no tengo opciones".
  const deferReplyForCatalog = action.type === "send_catalog";

  if (result.replyText && !deferReplyForCatalog) {
    await ctx.runMutation(deps.internal.messages.insertAssistantMessage, {
      conversationId,
      content: result.replyText,
      createdAt: Date.now(),
    });
    await ctx.runAction(deps.internal.ycloud.sendWhatsAppMessage, {
      to: args.phone,
      text: result.replyText,
      wamid: args.wamid,
    });
  }

  // Mensajes adicionales (paquetes multi-burbuja, p. ej. tras `pet_check`).
  // Se envían en orden con un pequeño delay para que WhatsApp los muestre como
  // burbujas separadas y no en una sola notificación. NO se incluye `wamid`
  // (`context.message_id`) para que no queden todos citando el mismo mensaje
  // del cliente — solo el primero lo hace.
  //
  // Estos también se difieren si la acción es send_catalog (mismo motivo).
  const extras: string[] = Array.isArray(result.additionalMessages)
    ? (result.additionalMessages as string[])
    : [];
  if (!deferReplyForCatalog) {
    for (const extra of extras) {
      const text = String(extra ?? "").trim();
      if (!text) continue;
      await new Promise((r) => setTimeout(r, 600));
      await ctx.runMutation(deps.internal.messages.insertAssistantMessage, {
        conversationId,
        content: text,
        createdAt: Date.now(),
      });
      await ctx.runAction(deps.internal.ycloud.sendWhatsAppMessage, {
        to: args.phone,
        text,
      });
    }
  }
  if (action.type === "send_catalog") {
    if (
      !(await isStillThisTailUserMessage(ctx, deps, conversationId, String(insertedMsgId), now))
    ) {
      return;
    }
    // Si el cliente confirmó evento Y declaró capacidad de evento mayor que el
    // cupo de hospedaje, el filtro de catálogo debe respetar la mayor. El helper
    // server-side `catalogPeopleCountForFilter` ya considera `eventCapacity` de
    // la finca cuando `isEvento=true`; aquí solo le pasamos el `minCapacity`
    // correcto (lo que el cliente realmente necesita acomodar).
    const eventPeople = Number(
      result.updatedEntities.eventPeopleCount ?? 0,
    );
    const effectiveMinCapacity =
      action.isEvento && eventPeople > action.cupo ? eventPeople : action.cupo;

    // Paginación: si `action.paginate === true` (cliente pidió "ver más"),
    // excluimos del query todos los retailerIds ya enviados a esta conversación
    // para no repetir las mismas fincas.
    let excludeRetailerIds: string[] = [];
    if (action.paginate === true) {
      try {
        excludeRetailerIds = (await ctx.runQuery(
          deps.internal.ycloud.getAllCatalogRetailerIdsForConversation,
          { conversationId },
        )) as string[];
      } catch (err) {
        console.error(
          "inbound: getAllCatalogRetailerIdsForConversation fallo (paginación degradada):",
          err,
        );
      }
    }

    // Filtros geográficos: el cliente puede pedir inclusión ("cerca a
    // Bogotá" → Cundinamarca; "en Tolima"; "en los llanos") o exclusión
    // ("no en los llanos"; "fuera de Tolima"). Mapping en REGIONS.
    const excludeLocationKeywords = detectExcludedZoneKeywords(textForTurn);
    const restrictToLocationKeywords = detectRestrictedZoneKeywords(textForTurn);

    // Modo "alrededores" / multi-zona: el cliente quiere ver opciones de
    // varios lugares cercanos (no un solo municipio específico). En ese caso
    // ampliamos el cap del catálogo de 12 → 25 para que vea más variedad de
    // zonas. El sort de favoritas-primero (en `whatsappCatalogs.ts`)
    // garantiza que las marcadas como favoritas salgan al inicio.
    const expandedMode = wantsExpandedSearch(textForTurn);
    const effectiveSendCap = expandedMode
      ? CATALOG_EXPANDED_LIMIT
      : MAX_CATALOG_PRODUCTS_PER_SEND;

    const catalogPayload = (await ctx.runQuery(
      deps.api.whatsappCatalogs.getPayloadByLocationForN8n,
      {
        location: action.location,
        fechaEntrada: action.checkIn,
        fechaSalida: action.checkOut,
        minCapacity: effectiveMinCapacity,
        // Techo estricto: la primera pasada solo trae fincas en el rango ajustado.
        // Ver `capacityCeilForCupo` (~cupo + buffer adaptativo).
        maxCapacity: capacityCeilForCupo(effectiveMinCapacity),
        // Techo relajado: si la pasada estricta no llena el catálogo, la
        // intermedia amplía hasta `maxCapacityRelaxed` (~1.7x el cupo).
        // EVITA que aparezcan fincas absurdamente grandes (ej. una de 53
        // personas para alguien que pidió 22). Ver `capacityCeilRelaxedForCupo`.
        maxCapacityRelaxed: capacityCeilRelaxedForCupo(effectiveMinCapacity),
        isEvento: action.isEvento,
        excludeRetailerIds,
        excludeLocationKeywords,
        restrictToLocationKeywords,
        // En modo expandido pedimos hasta 25 candidates al query (cap interno
        // de la query es 30); en modo normal usamos el default (30 también
        // pero el send se corta a 12).
        limit: effectiveSendCap,
      },
    )) as {
      catalogId?: string;
      productRetailerIds?: string[];
      productQuoteLines?: string[];
      productTitles?: string[];
    } | null;

    if (catalogPayload?.productRetailerIds?.length) {
      // Hay fichas → ahora SÍ enviamos el pre-catálogo diferido + extras + fichas.
      if (result.replyText) {
        await ctx.runMutation(deps.internal.messages.insertAssistantMessage, {
          conversationId,
          content: result.replyText,
          createdAt: Date.now(),
        });
        await ctx.runAction(deps.internal.ycloud.sendWhatsAppMessage, {
          to: args.phone,
          text: result.replyText,
          wamid: args.wamid,
        });
      }
      for (const extra of extras) {
        const text = String(extra ?? "").trim();
        if (!text) continue;
        await new Promise((r) => setTimeout(r, 600));
        await ctx.runMutation(deps.internal.messages.insertAssistantMessage, {
          conversationId,
          content: text,
          createdAt: Date.now(),
        });
        await ctx.runAction(deps.internal.ycloud.sendWhatsAppMessage, {
          to: args.phone,
          text,
        });
      }

      const cap = effectiveSendCap;
      const ids = catalogPayload.productRetailerIds.slice(0, cap);
      const lines = (catalogPayload.productQuoteLines ?? []).slice(0, cap);
      const titles = (catalogPayload.productTitles ?? []).slice(0, cap);
      const sendRows = (await ctx.runAction(deps.internal.ycloud.sendWhatsAppCatalogList, {
        to: args.phone,
        productRetailerIds: ids,
        productQuoteLines: lines.length ? lines : undefined,
        bodyText: `Fincas disponibles en ${action.location === "RECOMENDADAS" ? "nuestras zonas favoritas" : action.location}:`,
        catalogId: catalogPayload.catalogId,
        wamid: args.wamid,
        conversationId,
      })) as Array<{ productRetailerId: string; wamid?: string }>;

      const tBase = Date.now();
      for (let i = 0; i < ids.length; i++) {
        const quote = lines[i]?.trim();
        const title = titles[i]?.trim() || ids[i];
        const body = quote && quote.length > 0 ? quote : `🏡 ${title}`;
        const wamidOut = sendRows[i]?.wamid;
        await ctx.runMutation(deps.internal.messages.insertAssistantMessageWithMedia, {
          conversationId,
          content: body,
          type: "product",
          metadata: {
            productRetailerId: ids[i],
            wamid: wamidOut,
            productTitle: title,
          },
          createdAt: tBase + i * 25,
        });
      }

      // ── Mensaje de cierre del catálogo ─────────────────────────────────
      // Después de mandar todas las fichas, enviamos UNA línea final para
      // cerrar el bloque: el cliente ve un mensaje claro de "estas son las
      // opciones" + invitación a elegir / pedir más info. Sin esto, el
      // catálogo termina sin cierre y el cliente queda sin saber qué hacer.
      //
      // SE OMITE para eventos (más abajo viene la lógica específica de
      // preguntas del evento / escalada).
      if (action.isEvento !== true) {
        const tClose = Date.now() + 50;
        const closeMsg =
          "✨ Perfecto, estas son las *fincas disponibles*. Dime *cuál te gustó* o si quieres información adicional 🤝";
        await ctx.runMutation(deps.internal.messages.insertAssistantMessage, {
          conversationId,
          content: closeMsg,
          createdAt: tClose,
        });
        await ctx.runAction(deps.internal.ycloud.sendWhatsAppMessage, {
          to: args.phone,
          text: closeMsg,
        });
      }

      // ── EVENTO: política comercial ─────────────────────────────────────
      // Antes el bot escalaba a humano APENAS enviaba el catálogo cuando era
      // evento. Eso producía dos malas UX: (a) el cliente recibía fichas y de
      // inmediato un "te conecto con asesor" sin que hubiera podido elegir
      // siquiera, y (b) si el cliente no llegaba a dar `eventPeopleCount` /
      // `eventLogistics` por las preguntas que se hacían ANTES del catálogo,
      // el flujo escalaba sin que el cliente viera ni una finca.
      //
      // Nueva política (refinada):
      //   1. Mostrar primero el catálogo (siempre).
      //   2. Preguntar detalles del evento (total de personas + logística)
      //      DESPUÉS de mandar las fichas, SIN escalar todavía.
      //   3. Cuando se conoce la logística:
      //      - `extra` (DJ / banda / sonido pro / iluminación / matrimonios):
      //        escalar al asesor — el bot no calcula sobreprecio.
      //      - `basic` (cumpleaños familiar, sonido de la finca, departir
      //        tranquilos): SEGUIR EL FLUJO NORMAL — el bot continúa con
      //        pet_check → quote_shown → contract. La cotización estándar
      //        aplica sin sobreprecio.
      if (action.isEvento === true) {
        const tEvent = Date.now() + 50;
        const peopleCount = Number(
          result.updatedEntities.eventPeopleCount ?? 0,
        );
        const peopleCountMissing = !peopleCount || peopleCount <= 0;
        const logistics = result.updatedEntities.eventLogistics ?? null;
        const logisticsMissing = !logistics;
        const needsEventDetails = peopleCountMissing || logisticsMissing;

        if (needsEventDetails) {
          // Aún faltan datos del evento → preguntar SIN escalar. El bot sigue
          // activo esperando que el cliente elija finca + entregue detalles.
          const askLines: string[] = [
            "Como es para *evento* 🎉, mientras revisas las opciones te hago un par de preguntas 👇",
            "",
          ];
          if (peopleCountMissing) {
            askLines.push(
              "👥 *Total de personas en el evento* (las que duermen + las que van solo por el día / pasadía).",
            );
          }
          if (logisticsMissing) {
            askLines.push(
              "🎵 *Logística del evento*:",
              "🎧 Sonido profesional / DJ / iluminación",
              "🎸 Banda en vivo o grupos musicales",
              "🏡 O solo el sonido básico de la finca (departir tranquilos)",
            );
          }
          askLines.push(
            "",
            "Cuéntame cuál finca te gusta y estos datos para confirmarte la disponibilidad 🤝",
          );
          const eventQuestionsMsg = askLines.join("\n");
          await ctx.runMutation(deps.internal.messages.insertAssistantMessage, {
            conversationId,
            content: eventQuestionsMsg,
            createdAt: tEvent,
          });
          await ctx.runAction(deps.internal.ycloud.sendWhatsAppMessage, {
            to: args.phone,
            text: eventQuestionsMsg,
          });
        } else if (logistics === "extra") {
          // Logística pesada (DJ / banda / sonido pro / iluminación) →
          // escalar al asesor: el bot NO calcula sobreprecio del evento.
          const eventHandoffMsg = [
            "Como es para *evento* 🎉, el precio final puede variar según la logística (sonido pro, banda, equipos).",
            "",
            "👉 Mientras revisas las opciones, te conecto con un asesor para confirmarte *precios y disponibilidad* del evento. Un agente te escribirá en breve 🤝 ✨",
          ].join("\n");
          await ctx.runMutation(deps.internal.conversations.escalate, {
            conversationId,
            assignedUserId:
              process.env.CHATBOT_AUTO_ASSIGN_ADVISOR_ID?.trim() || undefined,
          });
          await ctx.runMutation(deps.internal.messages.insertAssistantMessage, {
            conversationId,
            content: eventHandoffMsg,
            createdAt: tEvent,
          });
          await ctx.runMutation(deps.internal.messages.insertSystemMessage, {
            conversationId,
            content:
              "🎉 Evento con logística *extra* (DJ/banda/sonido pro). El cliente recibió el catálogo + entregó detalles. Confirmar precio/condiciones del evento. La IA quedó en pausa.",
            createdAt: tEvent + 5,
            metadata: {
              kind: "inbox_escalation_alert",
              escalationReason: "event_after_catalog",
              requestedLocation: action.location,
              requestedCupo: action.cupo,
              eventPeopleCount: peopleCount,
              eventLogistics: logistics,
            },
          });
          await ctx.runAction(deps.internal.ycloud.sendWhatsAppMessage, {
            to: args.phone,
            text: eventHandoffMsg,
          });
        } else {
          // Logística básica (cumpleaños familiar, departir tranquilos) → NO
          // escalar. El bot sigue el flujo normal: en el próximo turno cuando
          // el cliente elija una finca, transition catalog_sent → pet_check
          // y de ahí avanza a quote_shown + contract con la cotización
          // estándar (sin sobreprecio de evento, porque no aplica).
          const basicEventAckMsg = [
            "¡Perfecto! 🎉 Para tu evento *básico* (sin sonido pro ni banda) te aplica la tarifa normal de la finca.",
            "",
            "Cuéntame *cuál finca te llama la atención* y seguimos con la reserva 🤝",
          ].join("\n");
          await ctx.runMutation(deps.internal.messages.insertAssistantMessage, {
            conversationId,
            content: basicEventAckMsg,
            createdAt: tEvent,
          });
          await ctx.runAction(deps.internal.ycloud.sendWhatsAppMessage, {
            to: args.phone,
            text: basicEventAckMsg,
          });
        }
      }
    } else {
      // Catálogo vacío: ninguna finca cumple los filtros (cupo + evento +
      // location + capacidad). El bot ya envió el pre-catálogo prometiendo
      // opciones, pero las fichas reales no van a aparecer. Escalamos a humano
      // con un mensaje específico para que el cliente NO quede esperando.
      const noResultsMsg = [
        "Por ahora no tengo opciones exactas para esos requisitos en el catálogo 🤔",
        "",
        "*Te conecto con un asesor* para evaluar disponibilidad especial y opciones personalizadas según tus fechas y tipo de plan 🤝",
        "",
        "Un agente te escribirá en breve para ayudarte ✨",
      ].join("\n");
      await ctx.runMutation(deps.internal.conversations.escalate, {
        conversationId,
        assignedUserId:
          process.env.CHATBOT_AUTO_ASSIGN_ADVISOR_ID?.trim() || undefined,
      });
      const tNoRes = Date.now();
      await ctx.runMutation(deps.internal.messages.insertAssistantMessage, {
        conversationId,
        content: noResultsMsg,
        createdAt: tNoRes,
      });
      await ctx.runMutation(deps.internal.messages.insertSystemMessage, {
        conversationId,
        content:
          "🚨 Catálogo vacío: el cliente pidió fincas pero los filtros (cupo + evento + zona) no devolvieron opciones. Revisar requisitos y contactar.",
        createdAt: tNoRes + 5,
        metadata: {
          kind: "inbox_escalation_alert",
          escalationReason: "catalog_no_results",
          requestedLocation: action.location,
          requestedCupo: action.cupo,
          requestedIsEvento: action.isEvento,
        },
      });
      await ctx.runAction(deps.internal.ycloud.sendWhatsAppMessage, {
        to: args.phone,
        text: noResultsMsg,
      });
      await ctx.runMutation(deps.internal.conversations.updateLastMessageAt, {
        conversationId,
      });
      return;
    }
  } else if (action.type === "escalate_human") {
    const reason = action.reason;
    await ctx.runMutation(deps.internal.conversations.escalate, {
      conversationId,
      assignedUserId: process.env.CHATBOT_AUTO_ASSIGN_ADVISOR_ID?.trim() || undefined,
      ...(reason === "contract_complete" ? { priority: "urgent" as const } : {}),
    });
    const alertCreatedAt = Date.now() + (result.replyText ? 20 : 0);
    const alertBody =
      reason === "contract_complete"
        ? "🚨 El cliente completó los datos del contrato por WhatsApp. Prioridad: revisar, avisar al equipo si aplica y contactar al cliente. La IA quedó en pausa."
        : reason === "stuck_loop"
          ? "⚠️ Escalación automática: el cliente llevaba varios turnos sin avanzar; se ofreció asesor humano. Revisar y contactar. La IA quedó en pausa."
          : reason === "pets_exceed_limit"
            ? "🐾 El cliente declaró más de 3 mascotas. Evaluar condiciones especiales (aseo extra, fincas con espacio, depósito ajustado). La IA quedó en pausa."
            : reason === "catalog_no_results"
              ? "🚨 Catálogo vacío para los filtros del cliente. Revisar requisitos (cupo / evento / zona) y proponer opciones manualmente. La IA quedó en pausa."
              : reason === "event_after_catalog"
                ? "🎉 Evento confirmado: cliente recibió el catálogo. Confirmar precio y condiciones del evento (logística + capacidad). La IA quedó en pausa."
                : reason === "media_post_catalog"
                  ? "📎 Cliente envió archivo/foto en fase post-catálogo. Revisar (cédula, comprobante, doc). La IA quedó en pausa."
                  : reason === "client_requested"
                    ? "📣 El cliente pidió hablar con un asesor. Revisar conversación y contactar. La IA quedó en pausa."
                    : "ℹ️ Conversación pasada a asesor humano. La IA quedó en pausa.";
    await ctx.runMutation(deps.internal.messages.insertSystemMessage, {
      conversationId,
      content: alertBody,
      createdAt: alertCreatedAt,
      metadata: {
        kind: "inbox_escalation_alert",
        escalationReason: reason ?? "generic",
      },
    });
  }

  await ctx.runMutation(deps.internal.conversations.updateLastMessageAt, { conversationId });
}
