import type { Id } from '../../_generated/dataModel';
import type { BotEntities } from '../bot/types';
import {
  capacityCeilForCupo,
  capacityCeilRelaxedForCupo,
  countNights,
  inferRetailerIdFromCatalogTitle,
} from '../bot/entities';
import {
  ADVISOR_ACTIVITY_WINDOW_MS,
  INBOUND_DEBOUNCE_MS,
  MAX_CATALOG_PRODUCTS_PER_SEND,
} from './constants';
import {
  buildBodyParams,
  getTemplateDef,
  renderTemplateBody,
} from './templateCatalog';
import {
  getFaqTextByKey,
  localFaqFallback,
  localFaqMatchesForText,
} from '../faqSeed';
import {
  AFTER_HOURS_NOTICE,
  clientFlaggedUrgent,
  isWithinBusinessHours,
  TEMPORAL_MESSAGE_CLOSING,
} from '../businessHours';
import type { DeliverTextResult } from './assistantOutbound';
import { bootstrapBotStateFromHistory } from '../bot/conversationBootstrap';

/** Plantilla de consentimiento (Ley 1581) — deshabilitada por ahora. */
const WHATSAPP_DATA_CONSENT_ENABLED = false;
/** Mensaje temporal al iniciar conversación (admin) — OFF hasta validar con equipo. */
const WHATSAPP_TEMPORAL_START_MESSAGE_ENABLED = false;

async function isStillThisTailUserMessage(
  ctx: any,
  deps: { api: any },
  conversationId: Id<'conversations'>,
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
  let conv = await ctx.runQuery(deps.api.conversations.getById, {
    conversationId,
  });
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
  const t = String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
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
 * "day pass", "solo por el día", "un solo día", "solamente un día" (el
 * cliente quiere un único día, sin pernoctar).
 */
function looksLikePasadia(text: string): boolean {
  const t = String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
  if (t.length === 0 || t.length > 240) return false;
  return (
    /\bpasa?d[ií]as?\b/.test(t) ||
    /\bpasar\s+(el|un|los?)\s+d[ií]as?\b/.test(t) ||
    /\bplan\s+de\s+d[ií]a\b/.test(t) ||
    /\bday\s*pass\b/.test(t) ||
    /\b(solo|nada\s+mas|unicamente)\s+(por\s+)?el\s+d[ií]a\b/.test(t) ||
    // "un solo día" / "solo un día" / "solamente un día" / "un día solamente":
    // el cliente dice explícitamente que quiere UN único día (sin dormir) →
    // es un plan de día. Lo enrutamos al flujo pasadía (que le aclara que es
    // solo en Villavicencio y le ofrece la alternativa de hospedaje).
    /\bun\s+solo\s+d[ií]a\b/.test(t) ||
    /\bsolo\s+un\s+d[ií]a\b/.test(t) ||
    /\bsolamente\s+un\s+d[ií]a\b/.test(t) ||
    /\bun\s+d[ií]a\s+(solo|solamente|unicamente)\b/.test(t)
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
    if (msgs[i].sender === 'assistant') {
      const c = String(msgs[i].content ?? '').toLowerCase();
      return c.includes('pasad') && c.includes('martes a jueves');
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
    'villavicencio',
    'restrepo',
    'san martin',
    'granada',
    'cumaral',
    'apiay',
    'paratebueno',
    'puerto lopez',
    'puerto gaitan',
    'guamal',
    'barranca de upia',
    'barranca',
    'acacias',
    'meta',
  ],
  TOLIMA: [
    'flandes',
    'carmen de apicala',
    'honda',
    'herveo',
    'lerida',
    'ortega',
    'melgar',
    'armero',
    'san antonio',
    'icononzo',
    'venadillo',
    'ambalema',
    'villarica',
    'libano',
    'valle de san juan',
    'alvarado',
    'cunday',
    'anzoategui',
    'murillo',
    'san luis',
    'prado',
    'santa isabel',
    'suarez',
    'piedras',
    'planadas',
    'ibague',
    'tolima',
  ],
  CUNDINAMARCA: [
    'nilo',
    'tocaima',
    'girardot',
    'villapinzon',
    'zipaquira',
    'facatativa',
    'choconta',
    'cogua',
    'tabio',
    'guaduas',
    'bojaca',
    'gachala',
    'la mesa',
    'pacho',
    'san cayetano',
    'soacha',
    'la calera',
    'puerto salgar',
    'villeta',
    'la pena',
    'caqueza',
    'funza',
    'yacopi',
    'nemocon',
    'anapoima',
    'viota',
    'tenjo',
    'cundinamarca',
  ],
  COSTA: [
    'cartagena',
    'santa marta',
    'barranquilla',
    'islas del rosario',
    'covenas',
    'tolu',
    'san bernardo',
    'san andres',
    'providencia',
    'riohacha',
    'palomino',
    'costa',
    'caribe',
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
    // Cubre TODAS las formas de excluir los llanos:
    //  - "no llanos", "no en los llanos", "que no sean los llanos"
    //  - "todos MENOS los llanos", "MENOS llanos", "EXCEPTO los llanos"
    //  - "SIN llanos", "FUERA del llano", "LEJOS del meta", "EVITA los llanos"
    // "no" permite 0-3 palabras intermedias (atrapa el verbo: "no SEAN los
    // llanos"). "menos/excepto/sin" van ESTRICTOS (solo artículo) para no
    // falsear con comparativos ("menos CARO en los llanos" — ahí el cliente SÍ
    // quiere llanos). "meta" estricto siempre (palabra común: "no es mi meta").
    triggerRegex:
      /\b(?:no\s+(?:\w+\s+){0,3}llanos?|(?:menos|excepto|sin)\s+(?:los\s+|el\s+)?llanos?|(?:no|menos|excepto|sin)\s+(?:el\s+)?meta|(?:fuera|lejos|aparte)\s+(?:de\s+)?(?:los\s+|el\s+)?(?:llanos?|meta)|evit[ae]\s+(?:los\s+|el\s+)?(?:llanos?|meta))\b/i,
    excludeLocationKeywords: REGIONS.LLANOS,
  },
  {
    // "no tolima", "todos menos tolima", "excepto tolima", "sin tolima",
    // "fuera de tolima", "evita tolima".
    triggerRegex:
      /\b(?:no\s+(?:\w+\s+){0,3}tolima|(?:menos|excepto|sin)\s+(?:el\s+)?tolima|(?:fuera|lejos|aparte)\s+(?:de\s+)?tolima|evit[ae]\s+tolima)\b/i,
    excludeLocationKeywords: REGIONS.TOLIMA,
  },
  {
    // "no cundinamarca", "menos cundinamarca", "excepto cundinamarca", etc.
    triggerRegex:
      /\b(?:no\s+(?:\w+\s+){0,3}cundinamarca|(?:menos|excepto|sin)\s+(?:la\s+)?cundinamarca|(?:fuera|lejos|aparte)\s+(?:de\s+)?cundinamarca|evit[ae]\s+cundinamarca)\b/i,
    excludeLocationKeywords: REGIONS.CUNDINAMARCA,
  },
];
function detectExcludedZoneKeywords(text: string): string[] {
  const t = String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
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
    triggerRegex: /\b(?<!no\s)cerca\s+(a|de|por)\s+(bogota|la\s+capital)\b/i,
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
  {
    // "en la costa", "por la costa", "la costa caribe", o ciudades costeras
    // (Cartagena, Santa Marta, Barranquilla, Islas del Rosario). Sin "no"
    // antes (para no confundir con "no en la costa").
    triggerRegex:
      /\b(?<!no\s)(?:(?:en|por|hacia|para)\s+(?:la\s+)?costa(?:\s+caribe)?|costa\s+caribe|cartagena|santa\s+marta|barranquilla|islas?\s+del?\s+rosario)\b/i,
    restrictToLocationKeywords: REGIONS.COSTA,
  },
];
function detectRestrictedZoneKeywords(text: string): string[] {
  const t = String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
  const out = new Set<string>();
  for (const rule of ZONE_INCLUSIONS) {
    if (rule.triggerRegex.test(t)) {
      for (const kw of rule.restrictToLocationKeywords) out.add(kw);
    }
  }
  return Array.from(out);
}

/**
 * Mapea cada REGION a su código de departamento (para el campo estructurado
 * `property.departamentos`). COSTA es multi-departamento → no tiene un solo
 * código, se expande solo por keywords de ubicación.
 */
const REGION_TO_DEPT_CODE: Record<string, string | null> = {
  LLANOS: 'META',
  TOLIMA: 'TOLIMA',
  CUNDINAMARCA: 'CUNDINAMARCA',
  COSTA: null,
};

/**
 * Dado el municipio que pidió el cliente, devuelve la EXPANSIÓN por
 * departamento/zona: todas las keywords de municipios de la misma región +
 * el código de departamento. Permite que "Melgar" traiga TODO Tolima (no solo
 * 2-3 de Melgar). Devuelve null si el municipio no pertenece a ninguna región
 * conocida (entonces no se expande, se filtra solo por el municipio exacto).
 */
function departmentExpansionForMunicipality(
  location: string | undefined,
): { keywords: string[]; deptCodes: string[] } | null {
  const norm = String(location ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim();
  if (!norm || norm === 'recomendadas') return null;
  for (const [region, kws] of Object.entries(REGIONS)) {
    const hit = kws.some((kw) => kw === norm || norm.includes(kw));
    if (hit) {
      const code = REGION_TO_DEPT_CODE[region];
      return { keywords: kws, deptCodes: code ? [code] : [] };
    }
  }
  return null;
}

/** Keywords de ubicación del Eje Cafetero (para la colección homónima). */
const EJE_CAFETERO_KEYWORDS = [
  'pereira',
  'armenia',
  'manizales',
  'salento',
  'montenegro',
  'quimbaya',
  'calarca',
  'filandia',
  'circasia',
  'chinchina',
  'santa rosa de cabal',
  'marsella',
  'eje cafetero',
  'quindio',
  'risaralda',
  'caldas',
];

/**
 * COLECCIONES / CATEGORÍAS del catálogo (las "pestañas" del home: Destinos de
 * Playa, Luxury, Eje Cafetero…). A diferencia de los municipios (que ya se
 * filtran por `location`), estas categorías NO se pueden expresar solo con
 * ubicación, así que se mapean a un `categoryMatch` HÍBRIDO (tag + ubicación +
 * atributo) que el query aplica con semántica OR. Diseño híbrido porque los
 * `catalogFilterTags` están poco poblados — así "playa" trae fincas con el tag
 * O fincas en municipios costeros, aunque no estén tageadas.
 *
 * NOTA: "cerca a Bogotá" / "en Tolima" / "en la costa" / etc. ya los maneja
 * `ZONE_INCLUSIONS` (restrict por ubicación) — no se duplican aquí.
 */
type CategoryMatch = {
  filterTags?: string[];
  locationKeywords?: string[];
  categories?: string[];
  requireEventsCapable?: boolean;
};
const CATEGORY_COLLECTIONS: Array<{
  triggerRegex: RegExp;
  label: string;
  categoryMatch: CategoryMatch;
}> = [
  {
    // "destinos de playa", "fincas de playa", "en la playa", "frente al mar"
    triggerRegex:
      /\b(destinos?\s+de\s+playa|fincas?\s+(?:de|en|con)\s+playa|de\s+playa|en\s+la\s+playa|frente\s+al\s+mar|cerca\s+(?:a|al|del)\s+mar|con\s+playa)\b/i,
    label: 'Destinos de Playa',
    categoryMatch: {
      filterTags: ['playa', 'santa-marta'],
      locationKeywords: REGIONS.COSTA,
    },
  },
  {
    // "de lujo", "lujosas", "luxury", "alta gama", "exclusivas", "premium"
    triggerRegex:
      /\b(de\s+lujo|lujos[ao]s?|luxury|alta\s+gama|exclusiv[ao]s?|premium|gama\s+alta)\b/i,
    label: 'Fincas de Lujo',
    categoryMatch: {
      filterTags: ['luxury'],
      categories: ['LUJO', 'PREMIUM'],
    },
  },
  {
    // "eje cafetero", "zona cafetera", "region cafetera"
    triggerRegex:
      /\b(eje\s+cafetero|zona\s+cafetera|region\s+cafetera|paisaje\s+cafetero)\b/i,
    label: 'Eje Cafetero',
    categoryMatch: {
      filterTags: ['eje-cafetero'],
      locationKeywords: EJE_CAFETERO_KEYWORDS,
    },
  },
  {
    // "finca para eventos", "salón de eventos", "para celebraciones grandes"
    // (trigger explícito para no chocar con el flujo `isEvento` normal).
    triggerRegex:
      /\b(fincas?\s+para\s+eventos?|salon\s+de\s+eventos?|finca\s+de\s+eventos?|para\s+(?:hacer\s+)?(?:un\s+)?evento\s+grande|para\s+celebraciones?\s+grandes?)\b/i,
    label: 'Fincas para Eventos',
    categoryMatch: {
      filterTags: ['eventos'],
      requireEventsCapable: true,
    },
  },
];

/**
 * Detecta si el cliente pidió una COLECCIÓN/categoría (playa, lujo, eje
 * cafetero, eventos). Devuelve el `categoryMatch` + label, o null. Si matchea
 * más de una, gana la primera en orden (las más específicas van primero).
 */
function detectCategoryCollection(
  text: string,
): { label: string; categoryMatch: CategoryMatch } | null {
  const t = String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
  for (const c of CATEGORY_COLLECTIONS) {
    if (c.triggerRegex.test(t)) {
      return { label: c.label, categoryMatch: c.categoryMatch };
    }
  }
  return null;
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
/**
 * ¿El mensaje es el cliente ENTREGANDO sus datos del contrato? (nombre,
 * cédula, correo, teléfono, dirección de residencia). Se detecta por la
 * presencia de 2+ etiquetas de campo de contrato. Si lo es, NO se trata
 * ninguna línea como pregunta — sin esto, la línea "Dirección de residencia:
 * Villavicencio" matchea `direccion` en `shortAndFaqy` y el bot dispara la FAQ
 * de ubicación de la finca en vez de procesar los datos del contrato.
 */
function looksLikeContractData(text: string): boolean {
  const t = String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
  let hits = 0;
  if (/\bnombre\s+completo\b/.test(t)) hits += 1;
  if (/\bcedula\b/.test(t)) hits += 1;
  if (/\b(correo|e-?mail)\b/.test(t)) hits += 1;
  if (/\b(telefono|celular|tel(?:efono)?\s+de\s+contacto)\b/.test(t)) hits += 1;
  if (/\bdireccion\s+de\s+residencia\b|\bresidencia\b/.test(t)) hits += 1;
  return hits >= 2;
}

function extractQuestionLinesArray(text: string): string[] {
  // El cliente entregando sus datos del contrato NO es una pregunta — aunque
  // alguna línea ("Dirección de residencia: …") tenga una keyword FAQ-y.
  if (looksLikeContractData(text)) return [];
  const lines = String(text ?? '')
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];
  if (lines.length === 1) return looksLikeQuestion(lines[0]) ? [lines[0]] : [];
  return lines.filter((l) => looksLikeQuestion(l));
}

/**
 * Frases del bot que PROMETEN pasar al cliente con un experto. La IA, cuando
 * no sabe una respuesta o ante frustración, naturalmente dice "te conecto con
 * un asesor" / "déjame confirmarlo con un experto" / "un experto te contacta en
 * breve" — pero si el FSM no devolvió la acción `escalate_human`, el sistema
 * antes seguía con el bot encendido y el cliente esperaba a un asesor que
 * NUNCA llegaba (bug reportado por Adriana: *"el bot avisa que va a pasar a
 * humano pero no lo hace"*). Estas regex DETECTAN la promesa para que el
 * post-procesado en `processInboundMessageV2` honre lo dicho y escale de
 * oficio (ver `escalationReason: "bot_promised_handoff"`).
 *
 * Las paths que ya escalan correctamente (wantsHuman, pasadia, cedula,
 * payment, catalog_no_results, etc.) hacen `return` antes de llegar al
 * post-procesado, así que NO hay riesgo de doble escalación aunque sus
 * mensajes también matcheen.
 */
const HANDOFF_REGEXES: RegExp[] = [
  // "te conecto/paso/comunico (con) asesor/experto/agente/humano/equipo"
  /\bte\s+(?:conecto|paso|comunico|conectare|pasare|comunicare)\s+(?:con\s+)?(?:un|el|nuestro)?\s*(?:asesor|experto|experta|agente|humano|equipo)\b/i,
  // "dejame / voy a / te  confirmar(lo|la) con (un) asesor/experto"
  /\b(?:dejame|voy\s+a|te)\s+confirma\w*\s+con\s+(?:un|el|nuestro)?\s*(?:asesor|experto|experta)\b/i,
  // "un asesor/experto/agente (humano) te <verbo conjugado>"
  /\bun[oa]?\s+(?:asesor|experto|experta|agente)\s+(?:humano\s+)?te\s+(?:va\s+a\s+|puede\s+|podria\s+)?(?:responde\w*|contacta\w*|ayuda\w*|escrib\w*|atend\w*|atiend\w*|llama\w*|comunicar\w*|verifica\w*|confirma\w*|gestion\w*)\b/i,
  // "voy a conectarte/pasarte/comunicarte/escalar..."
  /\bvoy\s+a\s+(?:conectarte|pasarte|comunicarte|escalar\w*)\b/i,
  // "me comunico con (un) asesor/experto"
  /\bme\s+comunico\s+con\s+(?:un|el)?\s*(?:asesor|experto|experta)\b/i,
  // "escalar a/con (un) asesor/experto"
  /\bescalar\s+(?:a|con)\s+(?:un\s+)?(?:asesor|experto|experta)\b/i,
];

function botPromisedHandoff(text: string): boolean {
  if (!text) return false;
  const t = text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  return HANDOFF_REGEXES.some((re) => re.test(t));
}

/**
 * Si la env `URGENT_ALERTS_WEBHOOK_URL` está configurada, dispara un POST
 * HTTP con el payload de la alerta urgente. Diseñado para conectarse a Slack
 * incoming webhook, n8n, Zapier o cualquier endpoint que acepte JSON.
 *
 * Errores se loguean pero **NO** interrumpen el flujo — el webhook es
 * best-effort: la escalación al inbox ya quedó hecha, esto es el ping al
 * canal externo. Sin la env configurada simplemente no hace nada.
 */
async function fireUrgentWebhookIfConfigured(payload: {
  alertReason: string;
  conversationId: string;
  contactPhone: string;
  contactName?: string | null;
  lastMessage: string;
  team?: 'ventas' | 'operaciones' | 'administracion' | 'atencion-cliente';
  extra?: Record<string, unknown>;
}): Promise<void> {
  const url = process.env.URGENT_ALERTS_WEBHOOK_URL?.trim();
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        priority: 'urgent',
        firedAt: Date.now(),
        source: 'fincasya-bot',
      }),
    });
  } catch (err) {
    console.error(
      '[urgent-webhook] fallo (la escalación a inbox sí quedó):',
      err,
    );
  }
}

function looksLikeQuestion(text: string): boolean {
  const t = String(text ?? '').trim();
  if (t.length < 4 || t.length > 250) return false;
  if (t.includes('?') || t.includes('¿')) return true;

  const lower = t.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');

  // FILTRO / preferencia, NO pregunta: "que no sea en los llanos", "que sea
  // cerca a Bogotá", "que tenga piscina", "que quede cerca". El "que" aquí es
  // conjunción ("[quiero] que sea…"), no el interrogativo "¿qué…?". Sin esta
  // exclusión, "Que no sea en los llanos" matchea `que\b` en `startsAsQuestion`
  // y dispara una FAQ irrelevante (ej. la de ubicación) — el cliente solo está
  // dando un filtro de zona, que lo recoge `detectExcludedZoneKeywords`.
  if (/^que\s+(no\s+)?(sea|este|tenga|quede|sirva|venga)n?\b/.test(lower)) {
    return false;
  }

  // ¿Empieza con palabra interrogativa o frase de petición de info?
  const startsAsQuestion =
    /^(que\b|cual\b|cuales\b|cuando\b|donde\b|como\b|cuanto\b|cuanta\b|cuantos\b|cuantas\b|puedo\b|se puede\b|me regala|me regalas|me dices|me dice|me confirma|me explica|me explican|me cuent|sabes\b|saben\b|tienen\b|tiene\b|aceptan\b|acepta\b|permiten\b|permite\b|hay\b|incluye\b|incluyen\b|conoce|conoces|necesito saber|quisiera saber|quiero saber|una consulta|una pregunta)\b/.test(
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

  // Mensaje que aporta DATOS de la reserva (rango de fechas y/o cupo): el
  // cliente está dando información, NO preguntando. Sin esto, "del 15 al 17
  // de junio para 10 personas y 1 perro, grupo familiar solo descanso"
  // matchea `perro` en `shortAndFaqy` → el bot dispara la FAQ de personal de
  // servicio / mascotas SIN que el cliente preguntara nada. Las preguntas
  // reales (con "?" o que empiezan con palabra interrogativa "cuánto/cuál
  // /qué…") ya se detectaron arriba, así que esto no las pisa.
  const looksLikeReservationData =
    /\bdel?\s+\d{1,2}\s+(?:al|a)\s+\d{1,2}\b/.test(lower) ||
    /\b\d{1,2}\s+(?:al|a)\s+\d{1,2}\s+de\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b/.test(
      lower,
    ) ||
    /\b\d{1,3}\s*personas?\b/.test(lower);
  if (looksLikeReservationData) return false;

  // Mensaje corto con términos FAQ inequívocos.
  const shortAndFaqy =
    t.length <= 140 &&
    /\b(horario|horarios|check ?in|check ?out|hora\s+de\s+(entrada|salida|llegada|llegar|ingreso)|a\s+qu[eé]?\s+horas?\b|horas?\s+(de|del|es|son|para)\s+(la\s+|el\s+)?(entrada|salida|ingreso|llegada)|mascota|mascotas|perr[oa]s?|gatos?|piscina|jacuzzi|bbq|raza|cancelaci[oó]n|cancelar|forma[s]?\s+de\s+pago|metodo[s]?\s+de\s+pago|medio[s]?\s+de\s+pago|proceso\s+de\s+pago|c[oó]mo\s+(?:puedo\s+|podemos\s+)?(?:pago|pagar|paga\w+|consigno|consignar|transferir|deposit\w+|cancel(?:o|ar))|d[oó]nde\s+(?:puedo\s+|podemos\s+)?(?:pago|pagar|consigno|consignar|transferir|deposit\w+)|c[oó]mo\s+se\s+paga|aceptan\s+(?:tarjeta|nequi|pse|bancolombia|davivienda|bbva)|nequi|bancolombia|davivienda|\bbbva\b|\bpse\b|que\s+(?:banco|cuenta|cuentas|medios?|formas?)\s+(?:tienen|manejan|aceptan|reciben|usan)|pol[ií]tica|reglas?|personal\s+de\s+servicio|cocinera|empleada|servicio\s+dom[eé]stico|aseo|ubicaci[oó]n|direcci[oó]n(?!\s+de\s+residencia)|d[oó]nde\s+queda|d[oó]nde\s+esta|c[oó]mo\s+llego|early\s+check|late\s+check|entrada\s+anticipada|salida\s+tardia|licor|cervezas?|alcohol|trago|alimentos?|llevar\s+(comida|bebidas?|mercado|trago)|botellas?\s+de\s+vidrio)\b/.test(
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
    if (m.sender === 'assistant') break;
    if (m.sender === 'user') {
      const t = String(m.content ?? '').trim();
      if (t) parts.unshift(t);
    }
  }
  return parts.join('\n');
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
    type?: 'text' | 'image' | 'audio' | 'video' | 'document';
    mediaUrl?: string;
    /** Reprocesar el último mensaje del cliente sin insertar uno nuevo (panel inbox). */
    retryMode?: boolean;
    existingMessageId?: Id<'messages'>;
    conversationId?: Id<'conversations'>;
  },
  deps: {
    internal: any;
    api: any;
    transcribeAudio: (url: string, prompt?: string) => Promise<string>;
    /**
     * Clasifica una imagen recibida en la fase de contrato vía modelo de
     * visión. Devuelve "cedula" | "comprobante" | "otro", o `null` si no se
     * pudo analizar (→ el llamador escala a un asesor como fallback seguro).
     */
    classifyImage?: (
      url: string,
    ) => Promise<'cedula' | 'comprobante' | 'otro' | null>;
    runBotTurn: (input: any) => Promise<any>;
    /** Envío de texto al cliente (WhatsApp). En canal web es no-op. */
    deliverText?: (payload: {
      to: string;
      text: string;
      wamid?: string;
    }) => Promise<DeliverTextResult | void>;
    /** Envío de fichas de catálogo (WhatsApp). En canal web solo persiste en BD. */
    deliverCatalog?: (payload: {
      to: string;
      productRetailerIds: string[];
      productQuoteLines?: string[];
      bodyText?: string;
      catalogId?: string;
      wamid?: string;
      conversationId: Id<'conversations'>;
    }) => Promise<
      Array<{ productRetailerId: string; wamid?: string; ok?: boolean }>
    >;
    channel?: 'whatsapp' | 'web';
  },
) {
  const deliverText =
    deps.deliverText ??
    (async (payload: { to: string; text: string; wamid?: string }) => {
      return (await ctx.runAction(
        deps.internal.ycloud.sendWhatsAppMessage,
        payload,
      )) as DeliverTextResult;
    });

  const sendAssistantText = async (args: {
    conversationId: Id<'conversations'>;
    to: string;
    text: string;
    wamid?: string;
    createdAt?: number;
    metadata?: Record<string, unknown>;
  }) => {
    const body = String(args.text ?? '').trim();
    if (!body) return;
    let sent: DeliverTextResult = {};
    if ((deps.channel ?? 'whatsapp') !== 'web') {
      sent =
        (await deliverText({
          to: args.to,
          text: body,
          wamid: args.wamid,
        })) ?? {};
    }
    const outboundWamid = String(sent.wamid ?? '').trim();
    const rawStatus = String(sent.status ?? '')
      .trim()
      .toLowerCase();
    const whatsappStatus =
      rawStatus === 'failed' ||
      rawStatus === 'accepted' ||
      rawStatus === 'sent' ||
      rawStatus === 'delivered' ||
      rawStatus === 'read'
        ? rawStatus
        : outboundWamid
          ? ('sent' as const)
          : undefined;
    await ctx.runMutation(deps.internal.messages.insertAssistantMessage, {
      conversationId: args.conversationId,
      content: body,
      createdAt: args.createdAt ?? Date.now(),
      metadata: {
        ...(args.metadata ?? {}),
        source: 'bot_automation',
      },
      ...(outboundWamid.length > 6 ? { wamid: outboundWamid } : {}),
      ...(whatsappStatus ? { whatsappStatus } : {}),
    });
  };
  const deliverCatalog =
    deps.deliverCatalog ??
    (async (payload: {
      to: string;
      productRetailerIds: string[];
      productQuoteLines?: string[];
      bodyText?: string;
      catalogId?: string;
      wamid?: string;
      conversationId: Id<'conversations'>;
    }) =>
      (await ctx.runAction(deps.internal.ycloud.sendWhatsAppCatalogList, {
        to: payload.to,
        productRetailerIds: payload.productRetailerIds,
        productQuoteLines: payload.productQuoteLines,
        bodyText: payload.bodyText,
        catalogId: payload.catalogId,
        wamid: payload.wamid,
        conversationId: payload.conversationId,
      })) as Array<{
        productRetailerId: string;
        wamid?: string;
        ok?: boolean;
      }>);

  const rawText = String(args.text ?? '').trim();
  if (/^(status|presence)\s*:\s*active$/i.test(rawText)) return;

  const retryMode =
    args.retryMode === true &&
    args.existingMessageId != null &&
    args.conversationId != null;

  const inboundWamidEarly = String(args.wamid ?? '').trim();

  let contactId: Id<'contacts'>;
  let conversationId: Id<'conversations'>;
  let isNewConversation = false;
  let isReactivatedConversation = false;
  let resumingFromHuman = false;

  if (retryMode) {
    const conv = (await ctx.runQuery(deps.api.conversations.getById, {
      conversationId: args.conversationId!,
    })) as { contactId: Id<'contacts'> } | null;
    if (!conv) return;
    conversationId = args.conversationId!;
    contactId = conv.contactId;
    isNewConversation = false;
    isReactivatedConversation = false;
  } else {
    contactId = await ctx.runMutation(deps.internal.ycloud.getOrCreateContact, {
      phone: args.phone,
      name: args.name,
    });
    const created = await ctx.runMutation(
      deps.internal.ycloud.getOrCreateConversation,
      { contactId, channel: deps.channel ?? 'whatsapp' },
    );
    conversationId = created.conversationId;
    isNewConversation = Boolean(created.isNew);
    isReactivatedConversation = Boolean(created.isReactivated);
  }

  let finalContent = args.text;
  if (!retryMode && args.type === 'audio' && args.mediaUrl) {
    try {
      const transcript = await deps.transcribeAudio(
        args.mediaUrl,
        'FincasYa, fincas, reservas, Colombia',
      );
      finalContent = `[Voz] ${transcript}`;
    } catch {
      finalContent = '[Audio] (no se pudo transcribir)';
    }
  }

  const now = Date.now();
  const replyToWamid = String(args.replyToWamid ?? '').trim();
  const inboundWamid = inboundWamidEarly;
  const userMsgMetadata: Record<string, string> = {};
  if (replyToWamid) userMsgMetadata.replyToWamid = replyToWamid;

  let insertedMsgId: Id<'messages'>;

  // Se usa para evitar duplicar avisos "fuera de horario" cuando ya
  // enviamos el mensaje temporal configurado por admin en el arranque.
  let temporalMessageStartSent = false;
  let temporalMessageWasSentForConversation = false;
  if (retryMode && args.existingMessageId) {
    insertedMsgId = args.existingMessageId;
    finalContent = String(args.text ?? '').trim();
    if (!finalContent && args.type === 'audio' && args.mediaUrl) {
      try {
        const transcript = await deps.transcribeAudio(
          args.mediaUrl,
          'FincasYa, fincas, reservas, Colombia',
        );
        finalContent = `[Voz] ${transcript}`;
      } catch {
        finalContent = '[Audio] (no se pudo transcribir)';
      }
    }
  } else if (inboundWamid.length > 6) {
    const existing = (await ctx.runQuery(deps.internal.messages.getByWamid, {
      wamid: inboundWamid,
    })) as { _id: Id<'messages'>; conversationId: Id<'conversations'> } | null;
    if (existing && existing.conversationId === conversationId) {
      insertedMsgId = existing._id;
    } else {
      insertedMsgId = await ctx.runMutation(
        deps.internal.messages.insertUserMessage,
        {
          conversationId,
          content: finalContent,
          createdAt: now,
          type: args.type,
          mediaUrl: args.mediaUrl,
          metadata: Object.keys(userMsgMetadata).length
            ? userMsgMetadata
            : undefined,
          wamid: inboundWamid,
        },
      );
    }
  } else {
    insertedMsgId = await ctx.runMutation(
      deps.internal.messages.insertUserMessage,
      {
        conversationId,
        content: finalContent,
        createdAt: now,
        type: args.type,
        mediaUrl: args.mediaUrl,
        metadata: Object.keys(userMsgMetadata).length
          ? userMsgMetadata
          : undefined,
      },
    );
  }

  if (!retryMode) {
    await new Promise((r) => setTimeout(r, INBOUND_DEBOUNCE_MS));
  }

  let conv = await ctx.runQuery(deps.api.conversations.getById, {
    conversationId,
  });
  const latestMsg = (await ctx.runQuery(
    deps.api.messages.getLatestUserMessage,
    {
      conversationId,
      scanLimit: 50,
    },
  )) as { _id: Id<'messages'>; content?: string } | null;

  if (!retryMode) {
    if (!conv || (conv.lastMessageAt ?? 0) > now) return;
    if (!latestMsg || String(latestMsg._id) !== String(insertedMsgId)) return;
  } else if (!latestMsg) {
    return;
  }

  // ─── SCREENING DE ETIQUETAS PERSISTENTES (antes de promover human→ai) ─
  // Debe correr mientras la conversación sigue en `human`; si promovemos a
  // `ai` primero, etiquetas como `cliente-grosero` dejarían de escalar.
  const convTags = Array.isArray(conv?.tags) ? conv.tags : [];
  const HARD_ESCALATE_TAGS = [
    'cliente-grosero',
    'propietario',
    'reserva-activa',
  ];
  const hardEscalateTag = HARD_ESCALATE_TAGS.find((t) => convTags.includes(t));
  // Si el asesor dejó el chat en modo bot, las etiquetas son informativas: no
  // forzar humano hasta que cambien el toggle manualmente.
  if (hardEscalateTag && conv && conv.status !== 'ai') {
    const t0 = Date.now();
    const priority =
      hardEscalateTag === 'cliente-grosero' ? 'urgent' : 'medium';
    await ctx.runMutation(deps.internal.conversations.escalate, {
      conversationId,
      operationalState: 'requires_advisor' as const,
      priority: priority as 'urgent' | 'medium',
      assignedUserId:
        process.env.CHATBOT_AUTO_ASSIGN_ADVISOR_ID?.trim() || undefined,
    });
    const handoffMsg =
      hardEscalateTag === 'cliente-grosero'
        ? 'Te conecto con un experto para atenderte personalmente. Te escribirá en breve 🤝'
        : hardEscalateTag === 'propietario'
          ? '¡Hola! 👋 Te conecto con nuestro equipo de expertos para atenderte — un experto te escribe en breve 🤝'
          : '¡Hola! 👋 Veo que ya tienes una reserva con nosotros. Te conecto con un experto para atenderte con prioridad 🤝';
    await ctx.runMutation(deps.internal.messages.insertAssistantMessage, {
      conversationId,
      content: handoffMsg,
      createdAt: t0,
    });
    await ctx.runMutation(deps.internal.messages.insertSystemMessage, {
      conversationId,
      content: `🏷️ Conversación etiquetada como "${hardEscalateTag}" — handoff automático al equipo correspondiente. La IA quedó en pausa.`,
      createdAt: t0 + 5,
      metadata: {
        kind: 'inbox_escalation_alert',
        escalationReason: `tag_${hardEscalateTag.replace(/-/g, '_')}`,
      },
    });
    await deliverText({
      to: args.phone,
      text: handoffMsg,
      wamid: args.wamid,
    });
    await ctx.runMutation(deps.internal.conversations.updateLastMessageAt, {
      conversationId,
    });
    if (priority === 'urgent') {
      await fireUrgentWebhookIfConfigured({
        alertReason: `tag_${hardEscalateTag.replace(/-/g, '_')}`,
        conversationId: String(conversationId),
        contactPhone: args.phone,
        contactName: args.name,
        lastMessage: String(latestMsg.content ?? '').slice(0, 500),
        team:
          hardEscalateTag === 'cliente-grosero'
            ? 'atencion-cliente'
            : 'operaciones',
      });
    }
    return;
  }

  // Conversación en modo humano: el asesor atiende. Sin bot ni mensajes automáticos al cliente.
  if (conv && conv.status === 'human') {
    await ctx.runMutation(deps.internal.conversations.updateLastMessageAt, {
      conversationId,
    });
    return;
  }

  // "Solo conversaciones nuevas" (CORTE POR FECHA): el bot NO responde chats
  // creados ANTES del corte configurado (backlog viejo). Las conversaciones
  // creadas desde que se activó el flag funcionan normal — incluso sus mensajes
  // posteriores. Aviso en inbox para que el equipo retome manualmente.
  // `retryMode` (retry manual del asesor) siempre pasa.
  if (!retryMode && conv) {
    const botOnlyNewSince = (await ctx.runQuery(
      deps.internal.platformSettings.getBotOnlyNewConversationsCutoffInternal,
      {},
    )) as number | null;
    const convCreatedAt = Number(
      (conv as { createdAt?: number } | null)?.createdAt ?? 0,
    );
    if (
      botOnlyNewSince != null &&
      convCreatedAt > 0 &&
      convCreatedAt < botOnlyNewSince
    ) {
      await ctx.runMutation(deps.internal.conversations.flagPriorityAlert, {
        conversationId,
        alertReason: 'bot_only_new_silence',
        priority: 'medium' as const,
        tag: '',
        inboxMessage: `🤫 Cliente escribió en una conversación ya iniciada con el equipo. Regla activa: la IA solo atiende conversaciones nuevas — el bot se mantuvo en SILENCIO. Retomar manualmente. Mensaje: "${String(latestMsg?.content ?? '').slice(0, 200)}"`,
      });
      await ctx.runMutation(deps.internal.conversations.updateLastMessageAt, {
        conversationId,
      });
      return;
    }
  }

  // Conversación en modo IA pero con asesor humano activo (celular o inbox):
  // el bot NO debe responder ni enviar plantillas. Forzar humano y salir.
  if (conv && conv.status === 'ai') {
    const hasAdvisorActivity =
      !!conv.assignedUserId ||
      ((await ctx.runQuery(
        deps.internal.messages.hasRecentHumanAdvisorMessages,
        {
          conversationId,
          sinceMs: Date.now() - ADVISOR_ACTIVITY_WINDOW_MS,
        },
      )) as boolean);
    if (hasAdvisorActivity) {
      await ctx.runMutation(deps.internal.conversations.escalate, {
        conversationId,
      });
      await ctx.runMutation(deps.internal.conversations.flagPriorityAlert, {
        conversationId,
        alertReason: 'advisor_active_bot_blocked',
        priority: 'medium' as const,
        tag: '',
        inboxMessage: `👤 Bot bloqueado: hay actividad de asesor humano en las últimas 48 h. El cliente escribió pero la IA no respondió. Mensaje: "${String(latestMsg?.content ?? '').slice(0, 200)}"`,
      });
      await ctx.runMutation(deps.internal.conversations.updateLastMessageAt, {
        conversationId,
      });
      return;
    }
  }

  // El STATUS de la conversación es la fuente de verdad: si está en 'ai' (un
  // admin la puso en "Bot", o arrancó en IA), el bot responde — AUNQUE el switch
  // GLOBAL de IA de WhatsApp esté apagado. El global solo define el DEFAULT de
  // las conversaciones NUEVAS y el apagado en masa (que voltea todas a 'human');
  // NO debe bloquear una conversación que un asesor activó a mano.
  if (!conv || conv.status !== 'ai') return;

  if (!retryMode && !resumingFromHuman) {
    const manualResume = (await ctx.runMutation(
      deps.internal.botSessions.consumePendingResumeFromHuman,
      { conversationId },
    )) as boolean;
    if (manualResume) resumingFromHuman = true;
  }

  if (!retryMode) {
    const claimKey =
      inboundWamid.length > 6
        ? `wamid:${inboundWamid}`
        : `msg:${insertedMsgId}`;
    const claim = (await ctx.runMutation(
      deps.internal.ycloud.tryClaimInboundForBot,
      { claimKey },
    )) as { claimed: boolean };
    if (!claim.claimed) return;
  }

  // ───────────────────────────────────────────────────────────────────────
  // PRIORIDAD MÁXIMA: cliente con RESERVA VIGENTE o POR VENIR.
  //
  // Si el teléfono del contacto coincide con un booking activo o futuro
  // (status ∈ {PENDING, PENDING_PAYMENT, CONFIRMED, PAID} **y**
  // fechaSalida ≥ hoy), su caso es OPERATIVO: preguntas sobre su estadía,
  // llegada, problemas, modificaciones. NO debe pasar por el flujo de
  // cotización del bot — escalamos DE INMEDIATO con contexto para que el
  // asesor lo atienda con prioridad. Si tiene varias reservas, devolvemos la
  // más cercana en fechas (la relevante para esta atención).
  // ───────────────────────────────────────────────────────────────────────
  const activeBooking = (await ctx.runQuery(
    deps.internal.bookings.findActiveOrUpcomingByGuestPhone,
    { phone: args.phone },
  )) as null | {
    _id: string;
    reference?: string;
    fechaEntrada: number;
    fechaSalida: number;
    status: string;
    propertyId: string;
  };
  if (activeBooking) {
    const t0 = Date.now();
    await ctx.runMutation(deps.internal.conversations.escalate, {
      conversationId,
      assignedUserId:
        process.env.CHATBOT_AUTO_ASSIGN_ADVISOR_ID?.trim() || undefined,
    });
    const handoffMsg =
      '¡Hola! 👋 Veo que ya tienes una reserva con nosotros. Te conecto con un experto para atenderte con prioridad — te escribirá en breve 🤝✨';
    await ctx.runMutation(deps.internal.messages.insertAssistantMessage, {
      conversationId,
      content: handoffMsg,
      createdAt: t0,
    });
    const fmtDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    const refLabel =
      activeBooking.reference && activeBooking.reference.length > 0
        ? `#${activeBooking.reference}`
        : `#${String(activeBooking._id).slice(-8)}`;
    await ctx.runMutation(deps.internal.messages.insertSystemMessage, {
      conversationId,
      content: `🏡 Cliente con reserva vigente o por venir: ${refLabel} · ${fmtDate(activeBooking.fechaEntrada)} → ${fmtDate(activeBooking.fechaSalida)} · ${activeBooking.status}. Escalación automática para atención operativa. La IA quedó en pausa.`,
      createdAt: t0 + 5,
      metadata: {
        kind: 'inbox_escalation_alert',
        escalationReason: 'client_has_active_booking',
        bookingId: activeBooking._id,
        bookingStatus: activeBooking.status,
      },
    });
    await deliverText({
      to: args.phone,
      text: handoffMsg,
      wamid: args.wamid,
    });
    await ctx.runMutation(deps.internal.conversations.updateLastMessageAt, {
      conversationId,
    });
    await fireUrgentWebhookIfConfigured({
      alertReason: 'client_has_active_booking',
      conversationId: String(conversationId),
      contactPhone: args.phone,
      contactName: args.name,
      lastMessage: String(latestMsg.content ?? '').slice(0, 500),
      team: 'operaciones',
      extra: {
        bookingId: activeBooking._id,
        bookingStatus: activeBooking.status,
        bookingReference: activeBooking.reference,
      },
    });
    return;
  }

  const tagFlags = {
    isVip:
      convTags.includes('cliente-importante') ||
      convTags.includes('cliente-especial'),
    isDifficult: convTags.includes('cliente-complicado'),
    isReturning: convTags.includes('cliente-recurrente'),
  };

  const recentForBurst = (await ctx.runQuery(deps.api.messages.listRecent, {
    conversationId,
    limit: 30,
  })) as Array<{ sender?: string; content?: string }>;
  const burstText = mergeTrailingUserBurst(recentForBurst);
  const textForTurn = burstText || String(finalContent ?? '').trim();

  const lowerText = String(textForTurn ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');

  // ═══════════════════════════════════════════════════════════════════════
  // CLASIFICADOR MULTIFUNCIONAL — el WhatsApp NO es solo comercial. Antes de
  // pasar al flujo de cotización, detectamos en orden de prioridad:
  //   (1) Emergencia → escalación DURA inmediata (24/7, bypassa todo).
  //   (2) Propietario → escalación DURA a equipo administrativo.
  //   (3) Cliente recurrente → ALERTA BLANDA (el bot sigue, asesor entra).
  //   (4) Intención de cierre/pago → ALERTA BLANDA urgente.
  // Las features 5-6 (estancia activa + problemas en estadía) están cubiertas
  // por el bloque "RESERVA VIGENTE" más arriba: cualquier mensaje de cliente
  // con booking activo/futuro ya escala automáticamente.
  // ═══════════════════════════════════════════════════════════════════════

  // ─── (1) EMERGENCIA ────────────────────────────────────────────────────
  // Regex determinístico (NO dependemos del LLM para algo crítico). Las
  // emergencias se atienden incluso fuera de horario laboral.
  // OJO: "ladron" SUELTO falseaba con nombres de finca u otros contextos
  // ("¿está disponible la finca el ladrón?"). Exigimos verbo de acción antes
  // (hay/entró/vimos/vinieron un ladrón) y dejamos "me/nos robaron" como
  // captura genérica de robo. "se está quemando" capturado aparte.
  const isEmergency =
    /\b(emergencia|accidente|me\s+robaron|nos\s+robaron|(?:hay|entr[oó]|vimos|vinieron|estan?\s+entrando)\s+(?:un\s+|unos\s+|varios\s+|los\s+)?ladron\w*|asalto|atraco|herid[oa]|sangr\w+|ambulancia|policia|incendio|fuego|se\s+est[aá]\s+quemando|me\s+desmay\w*|infarto|convuls\w+|amenaza|amenazan|me\s+amenaz\w*|ayuda\s+urgente|necesito\s+ayuda\s+ya|secuestr\w+|me\s+atacaron)\b/.test(
      lowerText,
    );
  if (isEmergency) {
    const t0 = Date.now();
    await ctx.runMutation(deps.internal.conversations.escalate, {
      conversationId,
      operationalState: 'requires_advisor' as const,
      priority: 'urgent' as const,
      assignedUserId:
        process.env.CHATBOT_AUTO_ASSIGN_ADVISOR_ID?.trim() || undefined,
    });
    const handoffMsg =
      'Recibí tu mensaje y ya alertamos a nuestro equipo de operaciones para atenderte de inmediato 🚨\n\nSi es una emergencia *médica o de seguridad*, por favor llama también al *123* (línea única nacional). Un experto te contacta por aquí en minutos.';
    await ctx.runMutation(deps.internal.messages.insertAssistantMessage, {
      conversationId,
      content: handoffMsg,
      createdAt: t0,
    });
    await ctx.runMutation(deps.internal.messages.insertSystemMessage, {
      conversationId,
      content:
        '🚨🚨🚨 EMERGENCIA detectada en el mensaje del cliente. PRIORIDAD CRÍTICA — contactar de inmediato. La IA quedó en pausa.',
      createdAt: t0 + 5,
      metadata: {
        kind: 'inbox_escalation_alert',
        escalationReason: 'emergency',
      },
    });
    await ctx.runMutation(deps.internal.conversations.addConversationTag, {
      conversationId,
      tag: 'emergencia',
    });
    await deliverText({
      to: args.phone,
      text: handoffMsg,
      wamid: args.wamid,
    });
    await ctx.runMutation(deps.internal.conversations.updateLastMessageAt, {
      conversationId,
    });
    await fireUrgentWebhookIfConfigured({
      alertReason: 'emergency',
      conversationId: String(conversationId),
      contactPhone: args.phone,
      contactName: args.name,
      lastMessage: textForTurn.slice(0, 500),
      team: 'operaciones',
    });
    return;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // GATE DE CONSENTIMIENTO DE DATOS (Ley 1581) — solo WhatsApp, UNA vez.
  //
  // Va DESPUÉS de los casos críticos (reserva vigente, etiquetas de handoff
  // duro y emergencia) para no interrumpir a clientes ya activos ni demorar
  // una urgencia. Antes de iniciar el flujo comercial, el cliente NUEVO debe
  // autorizar el tratamiento de sus datos. El bot envía la plantilla
  // `tratamiento_de_datos` con botones "Sí, autorizo" / "No autorizo":
  //   - "Sí, autorizo"  → se marca el consentimiento y se CONTINÚA el flujo
  //     normal (bienvenida, o la intención previa si ya escribió algo útil —
  //     `runBotTurn` lo decide más abajo).
  //   - "No autorizo"   → mensaje cordial + el bot queda en pausa para este
  //     contacto (puede reintentar escribiendo de nuevo).
  //   - cualquier otra cosa sin responder → (re)envía la plantilla (cooldown).
  //
  // Quien YA autorizó alguna vez nunca vuelve a ver esta solicitud. El canal
  // web no pasa por este gate.
  // ═══════════════════════════════════════════════════════════════════════
  if (
    WHATSAPP_TEMPORAL_START_MESSAGE_ENABLED &&
    !retryMode &&
    (isNewConversation || isReactivatedConversation) &&
    (deps.channel ?? 'whatsapp') === 'whatsapp'
  ) {
    const temporalCfg = (await ctx.runQuery(
      deps.api.whatsappTemporalMessage.getActive,
      {},
    )) as null | { active?: boolean; content?: string };
    const content = String(temporalCfg?.content ?? '').trim();
    if (temporalCfg?.active === true && content.length > 0) {
      const alreadySent = (await ctx.runMutation(
        deps.internal.botSessions.markAlertFired,
        {
          conversationId,
          phone: args.phone,
          alertReason: 'whatsapp_temporal_message_start_sent',
        },
      )) as boolean;
      if (alreadySent) {
        await sendAssistantText({
          conversationId,
          to: args.phone,
          text: content,
          wamid: args.wamid,
          metadata: { source: 'whatsapp_temporal_message_start' },
        });
        temporalMessageStartSent = true;
      }
    }
  }

  if (
    WHATSAPP_DATA_CONSENT_ENABLED &&
    (deps.channel ?? 'whatsapp') === 'whatsapp'
  ) {
    const consent = (await ctx.runQuery(deps.internal.contacts.getDataConsent, {
      contactId,
    })) as null | {
      status: 'granted' | 'denied' | null;
      requestedAt: number | null;
      respondedAt: number | null;
      name: string;
    };

    if (consent && consent.status !== 'granted') {
      // `lowerText` ya viene normalizado (sin acentos, minúsculas) del burst.
      // El "no" se evalúa primero porque "no autorizo" contiene "autorizo".
      const saysDeny =
        /\bno\s+autoriz|no\s+acepto|no\s+estoy\s+de\s+acuerdo|^no\b|no\s+gracias/.test(
          lowerText,
        );
      const saysGrant =
        !saysDeny &&
        /autoriz|acepto|de\s+acuerdo|^si\b|claro\s+que\s+si|por\s+supuesto/.test(
          lowerText,
        );

      if (saysGrant) {
        await ctx.runMutation(deps.internal.contacts.setDataConsent, {
          contactId,
          status: 'granted',
        });
        await ctx.runMutation(deps.internal.messages.insertSystemMessage, {
          conversationId,
          content:
            '✅ El cliente AUTORIZÓ el tratamiento de datos (Ley 1581) por WhatsApp.',
          createdAt: Date.now(),
          metadata: { kind: 'data_consent', consentStatus: 'granted' },
        });
        // FALL THROUGH: el resto de `processInboundMessageV2` corre normal y
        // `runBotTurn` envía la bienvenida o atiende la intención previa.
      } else if (saysDeny) {
        await ctx.runMutation(deps.internal.contacts.setDataConsent, {
          contactId,
          status: 'denied',
        });
        const denyMsg =
          'Entiendo 🙏 Sin tu autorización para el tratamiento de datos personales no podemos continuar con la búsqueda ni ofrecerte atención personalizada. Si cambias de opinión, escríbenos cuando quieras y con gusto te ayudamos 💚';
        await ctx.runMutation(deps.internal.messages.insertAssistantMessage, {
          conversationId,
          content: denyMsg,
          createdAt: Date.now(),
        });
        await ctx.runMutation(deps.internal.messages.insertSystemMessage, {
          conversationId,
          content:
            '🚫 El cliente NO autorizó el tratamiento de datos. El bot quedó en pausa para este contacto.',
          createdAt: Date.now() + 5,
          metadata: { kind: 'data_consent', consentStatus: 'denied' },
        });
        await deliverText({ to: args.phone, text: denyMsg, wamid: args.wamid });
        await ctx.runMutation(deps.internal.conversations.updateLastMessageAt, {
          conversationId,
        });
        return;
      } else {
        // Sin respuesta clara → (re)enviar la plantilla de consentimiento.
        // Cooldown para no spamear si el cliente escribe varias veces seguidas.
        const CONSENT_RESEND_COOLDOWN_MS = 60_000;
        const lastReq = Number(consent.requestedAt ?? 0);
        const shouldSend =
          !lastReq || Date.now() - lastReq > CONSENT_RESEND_COOLDOWN_MS;
        const isFirstRequest = !lastReq;
        if (shouldSend) {
          // Bienvenida ANTES de la plantilla de consentimiento, pero solo la
          // PRIMERA vez (en los reenvíos por cooldown no repetimos el saludo).
          // Así el contacto nuevo recibe: 1) saludo de bienvenida y enseguida
          // 2) la solicitud de tratamiento de datos, en el mismo turno.
          if (isFirstRequest) {
            const welcomeMsg =
              '¡Hola! 👋 Bienvenido(a) a *FincasYa* 🌿 Te ayudamos a encontrar la finca ideal para tus vacaciones, descanso o eventos especiales. 🏡✨';
            await ctx.runMutation(
              deps.internal.messages.insertAssistantMessage,
              { conversationId, content: welcomeMsg, createdAt: Date.now() },
            );
            await deliverText({
              to: args.phone,
              text: welcomeMsg,
              wamid: args.wamid,
            });
          }
          const def = getTemplateDef('data_consent');
          if (def) {
            const firstName =
              (consent.name || args.name || '').trim().split(/\s+/)[0] || '';
            const bodyParams = buildBodyParams(def, { nombre: firstName });
            let templateWamid: string | undefined;
            try {
              const sent = (await ctx.runAction(
                deps.internal.ycloud.sendWhatsAppTemplate,
                { to: args.phone, templateKey: 'data_consent', bodyParams },
              )) as { wamid?: string; status?: string };
              templateWamid = sent?.wamid;
            } catch (err) {
              console.error(
                'inbound: error enviando plantilla de consentimiento:',
                err,
              );
            }
            await ctx.runMutation(
              deps.internal.contacts.markDataConsentRequested,
              { contactId },
            );
            await ctx.runMutation(
              deps.internal.messages.insertAssistantMessage,
              {
                conversationId,
                content: renderTemplateBody(def, bodyParams),
                createdAt: Date.now(),
                wamid:
                  templateWamid && templateWamid.length > 6
                    ? templateWamid
                    : undefined,
                metadata: {
                  source: 'data_consent_template',
                  templateName: def.name,
                  templateFooter: def.footer ?? undefined,
                  templateButtons: (
                    def.buttons ?? (def.button ? [def.button] : [])
                  ).map((b) => ({ type: b.type, text: b.text })),
                },
              },
            );
            await ctx.runMutation(
              deps.internal.conversations.updateLastMessageAt,
              { conversationId },
            );
          }
        }
        return;
      }
    }
  }

  // ─── (2) PROPIETARIO ──────────────────────────────────────────────────
  // Auto-declaración del propietario. El lookup por phone contra `users`
  // está pendiente (requiere `users.phone` indexado — flag 🟡 del roadmap);
  // por ahora cubrimos por keywords inequívocos.
  const isOwner =
    /\b(soy\s+(el\s+|la\s+)?(due[nñ][oa]|propietari[oa])|administr[oa]\s+(la|mi|esta)\s+finca|mi\s+finca\s+(de|en|que\s+est[áa])|hablo\s+como\s+propietari[oa]|escrib[oe]\s+como\s+propietari[oa])\b/.test(
      lowerText,
    );
  if (isOwner) {
    const t0 = Date.now();
    await ctx.runMutation(deps.internal.conversations.escalate, {
      conversationId,
      operationalState: 'requires_advisor' as const,
      priority: 'medium' as const,
      assignedUserId:
        process.env.CHATBOT_AUTO_ASSIGN_ADVISOR_ID?.trim() || undefined,
    });
    const handoffMsg =
      '¡Hola! 👋 Veo que escribes como propietario. Te conecto con nuestro equipo de expertos para atenderte directamente — un experto te escribe en breve 🤝';
    await ctx.runMutation(deps.internal.messages.insertAssistantMessage, {
      conversationId,
      content: handoffMsg,
      createdAt: t0,
    });
    await ctx.runMutation(deps.internal.messages.insertSystemMessage, {
      conversationId,
      content:
        '🏠 PROPIETARIO detectado por autodeclaración. Enrutar al equipo administrativo. La IA quedó en pausa.',
      createdAt: t0 + 5,
      metadata: {
        kind: 'inbox_escalation_alert',
        escalationReason: 'owner_inquiry',
      },
    });
    await ctx.runMutation(deps.internal.conversations.addConversationTag, {
      conversationId,
      tag: 'propietario',
    });
    await deliverText({
      to: args.phone,
      text: handoffMsg,
      wamid: args.wamid,
    });
    await ctx.runMutation(deps.internal.conversations.updateLastMessageAt, {
      conversationId,
    });
    return;
  }

  // ─── (3) CLIENTE RECURRENTE ──────────────────────────────────────────
  // ¿El teléfono ya tuvo una sesión de bot que llegó a fase comercial
  // (catálogo enviado / cotización / contrato)? → alerta blanda para que
  // un asesor entre con el contexto previo. El bot sigue conversando.
  const previousSession = (await ctx.runQuery(
    deps.internal.botSessions.findRecentCommercialByPhone,
    { phone: args.phone, excludingConversationId: conversationId },
  )) as null | {
    _id: string;
    phase: string;
    entities: Record<string, unknown>;
    updatedAt: number;
  };
  // SAFETY: solo dispara la alerta si la sesión previa tiene info comercial
  // real (al menos finca elegida O fechas confirmadas). Sin esto un session
  // huérfano en `catalog_sent` SIN datos generaba "Cliente RECURRENTE — sin
  // detalles guardados", inútil para el asesor.
  if (previousSession) {
    const e = previousSession.entities as {
      location?: string;
      checkIn?: string;
      checkOut?: string;
      cupo?: number;
      selectedPropertyName?: string;
    };
    const hasMeaningfulContext =
      !!e.selectedPropertyName || (!!e.checkIn && !!e.checkOut) || !!e.location;
    if (hasMeaningfulContext) {
      const ctxBits: string[] = [];
      if (e.selectedPropertyName)
        ctxBits.push(`finca=${e.selectedPropertyName}`);
      if (e.location) ctxBits.push(`zona=${e.location}`);
      if (e.checkIn && e.checkOut)
        ctxBits.push(`fechas=${e.checkIn}→${e.checkOut}`);
      if (e.cupo) ctxBits.push(`cupo=${e.cupo}`);
      // Fecha de la sesión previa — formato dd/mm/yyyy para que el asesor
      // sepa si fue de "ayer" o "hace 2 meses". Ventana global ya está
      // acotada a 90 días por `findRecentCommercialByPhone`.
      const prevDate = new Date(previousSession.updatedAt);
      const dd = String(prevDate.getDate()).padStart(2, '0');
      const mm = String(prevDate.getMonth() + 1).padStart(2, '0');
      const yyyy = prevDate.getFullYear();
      const dateLabel = `${dd}/${mm}/${yyyy}`;
      await ctx.runMutation(deps.internal.conversations.flagPriorityAlert, {
        conversationId,
        alertReason: 'returning_close',
        priority: 'medium' as const,
        tag: 'cliente-recurrente',
        inboxMessage: `↩️ Cliente RECURRENTE — sesión previa del ${dateLabel} (fase: ${previousSession.phase}). Contexto guardado: ${ctxBits.join(' · ')}. Considera retomar desde ahí en lugar de empezar de cero.`,
      });
    }
  }

  // ─── (4) INTENCIÓN DE CIERRE / PAGO ──────────────────────────────────
  // Frases inequívocas de "quiero reservar/pagar/cerrar ahora". El bot sigue
  // pero un asesor debe entrar pronto para cerrar la venta sin fricciones.
  const isClosingIntent =
    /\b(quiero\s+(reservar|pagar|cerrar|concretar|separar|asegurar)|c[oó]mo\s+(hago\s+)?(para\s+)?(reservar|pagar|abonar|cancelar|consignar)|c[oó]mo\s+(pago|abono|consigno|reservo)|d[oó]nde\s+(pago|consigno|abono)|me\s+interesa\s+(esta|esa|definitivamente|mucho)|definitivamente\s+(la\s+)?quiero|quiero\s+esta|quiero\s+esa|ya\s+(cotic[eé]|cotizamos|hab[ií]a\s+cotizado)\s+(y\s+)?(quiero|deseo)?\s*(concretar|reservar|cerrar|pagar)|todav[ií]a\s+(esta|sigue)\s+disponible|sigue\s+disponible|aun\s+(esta|sigue)\s+disponible|por\s+(donde|d[oó]nde)\s+(te\s+)?(pago|consigno|abono))\b/.test(
      lowerText,
    );
  if (isClosingIntent) {
    await ctx.runMutation(deps.internal.conversations.flagPriorityAlert, {
      conversationId,
      alertReason: 'closing_intent',
      priority: 'urgent' as const,
      tag: 'intencion-cierre',
      operationalState: 'ready_to_book' as const,
      inboxMessage: `💰 INTENCIÓN DE CIERRE detectada — el cliente expresó intención clara de reservar/pagar. Prioridad alta para cerrar la venta sin fricciones. Frase detonante: "${textForTurn.slice(0, 200)}"`,
    });
    await fireUrgentWebhookIfConfigured({
      alertReason: 'closing_intent',
      conversationId: String(conversationId),
      contactPhone: args.phone,
      contactName: args.name,
      lastMessage: textForTurn.slice(0, 500),
      team: 'ventas',
    });
  }

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
      assignedUserId:
        process.env.CHATBOT_AUTO_ASSIGN_ADVISOR_ID?.trim() || undefined,
    });
    const handoffMsg = looksLikeComplaint
      ? 'Lamento la situación 🙏 Te conecto con un experto para gestionar tu solicitud. Te escribirá en breve 🤝'
      : 'Perfecto, te comunico con un experto. Te escribirá en breve ✨';
    await ctx.runMutation(deps.internal.messages.insertAssistantMessage, {
      conversationId,
      content: handoffMsg,
      createdAt: t0,
    });
    await ctx.runMutation(deps.internal.messages.insertSystemMessage, {
      conversationId,
      content: looksLikeComplaint
        ? '🚨 El cliente pidió atención humana (posible PQRS o tema operativo). Revisar y contactar. La IA quedó en pausa.'
        : '📣 El cliente pidió hablar con un experto. Revisar conversación y contactar. La IA quedó en pausa.',
      createdAt: t0 + 5,
      metadata: {
        kind: 'inbox_escalation_alert',
        escalationReason: looksLikeComplaint
          ? 'client_complaint'
          : 'client_requested',
      },
    });
    await deliverText({
      to: args.phone,
      text: handoffMsg,
      wamid: args.wamid,
    });
    await ctx.runMutation(deps.internal.conversations.updateLastMessageAt, {
      conversationId,
    });
    await fireUrgentWebhookIfConfigured({
      alertReason: looksLikeComplaint ? 'client_complaint' : 'client_requested',
      conversationId: String(conversationId),
      contactPhone: args.phone,
      contactName: args.name,
      lastMessage: textForTurn.slice(0, 500),
      team: looksLikeComplaint ? 'atencion-cliente' : 'ventas',
    });
    return;
  }

  const session = await ctx.runQuery(
    deps.internal.botSessions.getByConversation,
    { conversationId },
  );
  let currentPhase = session?.phase ?? 'welcome';
  const currentSamePhaseTurnCount = session?.samePhaseTurnCount ?? 0;
  const currentPhaseEnteredAt = session?.phaseEnteredAt ?? Date.now();
  let currentEntities = session?.entities ?? {};

  // Persistimos el hecho de haber enviado el mensaje temporal en `botSessions`
  // para poder reutilizarlo cuando el bot llegue al final del flujo.
  temporalMessageWasSentForConversation = Array.isArray(
    (session as any)?.firedAlerts,
  )
    ? (session as any).firedAlerts.includes(
        'whatsapp_temporal_message_start_sent',
      )
    : false;
  const advisorContinuityWasSentForConversation = Array.isArray(
    (session as any)?.firedAlerts,
  )
    ? (session as any).firedAlerts.includes('advisor_continuity_notice')
    : false;

  // Texto de TODOS los mensajes recientes del cliente (no solo el turno
  // actual). Se usa para detectar filtros de zona que el cliente dijo turnos
  // atrás (ej. "no llanos" al inicio, fechas/cupo en mensajes posteriores).
  const recentUserText = recentForBurst
    .filter((m) => m.sender === 'user')
    .map((m) => String(m.content ?? ''))
    .join('\n');

  // Si el cliente SOLO excluyó una zona ("que no sean los llanos") y aún no
  // hay un municipio concreto, eso significa "no tengo preferencia puntual,
  // solo esa exclusión" → `location = "RECOMENDADAS"`. Sin esto el FSM trata
  // `location` como faltante y el bot se queda preguntando "¿a qué
  // municipio?" en bucle, en vez de enviar el catálogo recomendado con la
  // exclusión de zona aplicada. (Backup determinístico — el extractor LLM
  // también lo marca, pero esto garantiza el comportamiento.)
  if (
    !String(currentEntities.location ?? '').trim() &&
    detectExcludedZoneKeywords(recentUserText).length > 0
  ) {
    currentEntities = { ...currentEntities, location: 'RECOMENDADAS' };
  }

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
    currentPhase === 'welcome' ||
    currentPhase === 'collecting' ||
    currentPhase === 'catalog_sent';
  const isPasadiaFollowUp =
    pasadiaPhaseOk && lastAssistantMsgIsPasadiaOffer(recentForBurst);
  const isPasadiaTrigger =
    pasadiaPhaseOk && !isPasadiaFollowUp && looksLikePasadia(textForTurn);

  if (isPasadiaTrigger) {
    // TURNO 1 — explicar condiciones + preguntar. SIN catálogo, SIN escalar.
    const tPas = Date.now();
    const pasadiaMsg = [
      '¡Hola! ☀️ Qué buena idea planear un día de descanso.',
      '',
      'Te cuento que nuestros *pasadías* funcionan bajo estas condiciones:',
      '',
      '• 📍 *Ubicación:* disponible *únicamente en Villavicencio*.',
      '• 📅 *Días:* entre semana, de martes a jueves.',
      '• ⏰ *Horario:* de 9:00 a.m. a 5:00 p.m.',
      '',
      'El *valor* del pasadía lo confirma directamente un asesor.',
      '',
      '¿Quieres que te conecte con un experto para coordinar tu *pasadía en Villavicencio*? 🤝',
      '',
      'O si prefieres, te ayudo a *reservar una finca para hospedaje* (con noche) en la fecha y el lugar que quieras 🏡',
    ].join('\n');
    await ctx.runMutation(deps.internal.messages.insertAssistantMessage, {
      conversationId,
      content: pasadiaMsg,
      createdAt: tPas,
    });
    await deliverText({
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
        'Entiendo 🙏 El *pasadía* lo manejamos únicamente en Villavicencio. Si más adelante quieres reservar una finca para *hospedaje*, con gusto te ayudo 🏡✨';
      await ctx.runMutation(deps.internal.messages.insertAssistantMessage, {
        conversationId,
        content: declMsg,
        createdAt: tDecl,
      });
      await deliverText({
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
        '¡Listo! ☀️ Te conecto con un experto que coordina la *disponibilidad* y el *valor* de tu pasadía en Villavicencio.',
        '',
        'En breve te escribe para ayudarte 🤝 ✨',
      ].join('\n');
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
      await deliverText({
        to: args.phone,
        text: escMsg,
        wamid: args.wamid,
      });
      await ctx.runMutation(deps.internal.messages.insertSystemMessage, {
        conversationId,
        content:
          '☀️ El cliente confirmó interés en un PASADÍA (plan de día). Coordinar disponibilidad (solo Villavicencio, mar-jue, 9am-5pm) y el valor. La IA quedó en pausa.',
        createdAt: tEsc + 5,
        metadata: {
          kind: 'inbox_escalation_alert',
          escalationReason: 'pasadia_request',
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
    args.type === 'image' || args.type === 'video' || args.type === 'document';
  const phaseRequiresHumanForMedia: Array<typeof currentPhase> = [
    'pet_check',
    'pet_rules_shown',
    'quote_shown',
    'contract',
    'done',
  ];
  if (isMediaMessage && phaseRequiresHumanForMedia.includes(currentPhase)) {
    // ── Imagen en fase `contract` → analizar con VISIÓN ────────────────────
    // El cliente debería estar enviando la foto de su cédula. En vez de
    // adivinar ("gracias por el documento"), clasificamos la imagen con un
    // modelo de visión: cédula → datos completos, escalar para generar el
    // contrato; comprobante → escalar para verificar el pago; otra cosa →
    // pedir que reenvíe la cédula (sin escalar). Si el análisis falla
    // (`null`), cae al escalado genérico de abajo (fallback seguro).
    if (
      args.type === 'image' &&
      currentPhase === 'contract' &&
      args.mediaUrl &&
      typeof deps.classifyImage === 'function'
    ) {
      const kind = await deps.classifyImage(args.mediaUrl);
      if (kind === 'cedula') {
        const tCed = Date.now();
        const cedMsg = [
          '¡Recibí la foto de tu *cédula*! 📄✅',
          '',
          'Con esto ya tengo todo para tu contrato. Te conecto con un experto que lo genera y te lo envía para asegurar tu reserva 🤝 ✨',
        ].join('\n');
        await ctx.runMutation(deps.internal.conversations.escalate, {
          conversationId,
          assignedUserId:
            process.env.CHATBOT_AUTO_ASSIGN_ADVISOR_ID?.trim() || undefined,
        });
        await ctx.runMutation(deps.internal.messages.insertAssistantMessage, {
          conversationId,
          content: cedMsg,
          createdAt: tCed,
        });
        await ctx.runMutation(deps.internal.messages.insertSystemMessage, {
          conversationId,
          content:
            '🪪 El cliente envió la FOTO DE LA CÉDULA. Datos del contrato completos → generar y enviar el contrato. La IA quedó en pausa.',
          createdAt: tCed + 5,
          metadata: {
            kind: 'inbox_escalation_alert',
            escalationReason: 'contract_cedula_received',
            mediaUrl: args.mediaUrl ?? null,
          },
        });
        await deliverText({
          to: args.phone,
          text: cedMsg,
          wamid: args.wamid,
        });
        await ctx.runMutation(deps.internal.conversations.updateLastMessageAt, {
          conversationId,
        });
        return;
      }
      if (kind === 'comprobante') {
        const tCmp = Date.now();
        const cmpMsg = [
          '¡Recibí tu *comprobante de pago*! 💰',
          '',
          'Te conecto con un experto para verificarlo y confirmarte los siguientes pasos 🤝 ✨',
        ].join('\n');
        await ctx.runMutation(deps.internal.conversations.escalate, {
          conversationId,
          assignedUserId:
            process.env.CHATBOT_AUTO_ASSIGN_ADVISOR_ID?.trim() || undefined,
        });
        await ctx.runMutation(deps.internal.messages.insertAssistantMessage, {
          conversationId,
          content: cmpMsg,
          createdAt: tCmp,
        });
        await ctx.runMutation(deps.internal.messages.insertSystemMessage, {
          conversationId,
          content:
            '💰 El cliente envió un COMPROBANTE DE PAGO. Verificar el pago y continuar con la reserva. La IA quedó en pausa.',
          createdAt: tCmp + 5,
          metadata: {
            kind: 'inbox_escalation_alert',
            escalationReason: 'payment_receipt_received',
            mediaUrl: args.mediaUrl ?? null,
          },
        });
        await deliverText({
          to: args.phone,
          text: cmpMsg,
          wamid: args.wamid,
        });
        await ctx.runMutation(deps.internal.conversations.updateLastMessageAt, {
          conversationId,
        });
        return;
      }
      if (kind === 'otro') {
        // No es cédula ni comprobante → pedir que reenvíe la cédula. NO se
        // escala: el bot espera la imagen correcta (el cliente la reenvía y
        // vuelve a pasar por este clasificador).
        const tOtr = Date.now();
        const otrMsg = [
          'Mmm, esa imagen no parece tu cédula 🤔',
          '',
          'Para preparar tu contrato necesito una *foto clara del frente de tu cédula* 📄. ¿Me la reenvías, por favor?',
        ].join('\n');
        await ctx.runMutation(deps.internal.messages.insertAssistantMessage, {
          conversationId,
          content: otrMsg,
          createdAt: tOtr,
        });
        await deliverText({
          to: args.phone,
          text: otrMsg,
          wamid: args.wamid,
        });
        await ctx.runMutation(deps.internal.conversations.updateLastMessageAt, {
          conversationId,
        });
        return;
      }
      // kind === null → análisis falló → continúa al escalado genérico abajo.
    }

    const tMedia = Date.now();
    await ctx.runMutation(deps.internal.conversations.escalate, {
      conversationId,
      assignedUserId:
        process.env.CHATBOT_AUTO_ASSIGN_ADVISOR_ID?.trim() || undefined,
    });
    const mediaHandoffMsg =
      'Gracias por enviarnos el documento 📎 Te conecto con un experto para revisarlo y confirmarte los siguientes pasos. Te escribirá en breve 🤝 ✨';
    await ctx.runMutation(deps.internal.messages.insertAssistantMessage, {
      conversationId,
      content: mediaHandoffMsg,
      createdAt: tMedia,
      metadata:
        inboundWamid.length > 6 ? { replyToWamid: inboundWamid } : undefined,
    });
    await ctx.runMutation(deps.internal.messages.insertSystemMessage, {
      conversationId,
      content:
        '📎 Cliente envió archivo/foto en fase post-catálogo. Revisar (puede ser cédula, comprobante de pago o documento adicional). La IA quedó en pausa.',
      createdAt: tMedia + 5,
      metadata: {
        kind: 'inbox_escalation_alert',
        escalationReason: 'media_post_catalog',
        phaseAtEscalation: currentPhase,
        mediaType: args.type,
        mediaUrl: args.mediaUrl ?? null,
      },
    });
    await deliverText({
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
  if (
    !resolvableReplyToWamid &&
    !(currentEntities.selectedPropertyRetailerId ?? '').trim()
  ) {
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
        if (m.sender === 'assistant') break;
        if (m.sender === 'user') {
          const w = String(m.metadata?.replyToWamid ?? '').trim();
          if (w.length >= 8) {
            resolvableReplyToWamid = w;
            break;
          }
        }
      }
    } catch (err) {
      console.error(
        'inbound: error escaneando replyToWamid en historial reciente (degradado):',
        err,
      );
    }
  }

  if (resolvableReplyToWamid) {
    const pick = await ctx.runQuery(
      deps.internal.ycloud.getCatalogProductByOutboundWamid,
      {
        conversationId,
        wamid: resolvableReplyToWamid,
      },
    );
    if (pick?.productRetailerId) {
      const prop = await ctx.runQuery(
        deps.api.whatsappCatalogs.getPropertyByRetailerId,
        {
          productRetailerId: pick.productRetailerId,
        },
      );
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
    limit: 30,
  })) as Array<{ sender?: string; content?: string }>;
  const history = recentMsgs
    .filter((m) => m.sender === 'user' || m.sender === 'assistant')
    .map((m) => ({
      role: (m.sender === 'assistant' ? 'assistant' : 'user') as
        | 'user'
        | 'assistant',
      content: String(m.content ?? ''),
    }));

  // OJO: NO usar `!isNewConversation` como señal de "conversación en curso".
  // `isNewConversation` solo es true para el mensaje que CREÓ la conversación;
  // en una ráfaga de primer contacto ("Hola," + "quiero alquilar una finca"),
  // el turno que responde lo dispara un mensaje posterior → isNew=false → se
  // forzaba modo resume y el bot se saltaba la bienvenida oficial y el saludo
  // (bug real). Las conversaciones viejas con historial las detecta
  // `conversationHasPriorEngagement` (¿algún assistant respondió antes?).
  const bootstrapped = await bootstrapBotStateFromHistory({
    currentPhase,
    currentEntities,
    conversationHistory: history,
    recentUserText,
    forceResume: retryMode || resumingFromHuman,
  });
  currentPhase = bootstrapped.phase;
  currentEntities = bootstrapped.entities;
  const resumeOngoingConversation = bootstrapped.resumeOngoingConversation;

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
  const multiFaqKeys = localFaqMatchesForText(textForTurn);
  const faqChunks: string[] = [];

  // Varios temas en un solo mensaje ("¿perros? ¿puedo llevar comida?") → todas las FAQs.
  if (multiFaqKeys.length >= 2 && questionLines.length > 0) {
    for (const key of multiFaqKeys.slice(0, 4)) {
      const answer = (getFaqTextByKey(key) ?? '').trim();
      if (answer.length > 0 && !faqChunks.includes(answer))
        faqChunks.push(answer);
    }
  } else if (questionLines.length > 0) {
    for (const q of questionLines.slice(0, 3)) {
      if (!looksLikeQuestion(q)) continue;
      let answer = '';
      try {
        const ragResult = (await ctx.runAction(
          deps.api.knowledge.searchFaqForBot,
          {
            query: q,
          },
        )) as { text?: string; title?: string; score?: number } | null;
        answer = String(ragResult?.text ?? '').trim();
      } catch (err) {
        console.error(
          'inbound: searchFaqForBot fallo (degradado, sigue sin RAG):',
          err,
        );
      }
      if (!answer) {
        answer = (localFaqFallback(q) ?? '').trim();
      }
      if (answer.length > 0 && !faqChunks.some((c) => c === answer)) {
        faqChunks.push(answer);
      }
    }
    // Si el RAG solo devolvió una FAQ pero el texto menciona otro tema, añadirlo.
    if (multiFaqKeys.length >= 2) {
      for (const key of multiFaqKeys) {
        const answer = (getFaqTextByKey(key) ?? '').trim();
        if (answer.length > 0 && !faqChunks.includes(answer))
          faqChunks.push(answer);
      }
    }
  }

  if (faqChunks.length > 0) {
    faqContext = faqChunks.join('\n\n━━━━━━━━━━\n\n');
  }

  // ── Pregunta sin respuesta en fase `contract` → escalar a un asesor ──────
  // En `contract` el bot solo recolecta los datos del contrato. Si el cliente
  // hace una pregunta que el RAG NO puede responder (ninguna FAQ matchea —
  // ej. "¿puedo llevar licor?"), el flujo determinístico solo re-emite el
  // recordatorio de datos e IGNORA la pregunta. En vez de eso escalamos a un
  // asesor humano (que además maneja el contrato de todas formas): responde
  // la duda y cierra la reserva. Si SÍ hay FAQ que responde (`faqContext`
  // poblado), no escalamos — el RAG-bypass de `replies.ts` la contesta.
  if (
    currentPhase === 'contract' &&
    questionLines.length > 0 &&
    !String(faqContext ?? '').trim()
  ) {
    const tCq = Date.now();
    const cqMsg = [
      '¡Buena pregunta! 🙌',
      '',
      'Te conecto con un experto que te resuelve esa duda y te ayuda a finalizar tu reserva 🤝 ✨',
    ].join('\n');
    await ctx.runMutation(deps.internal.conversations.escalate, {
      conversationId,
      assignedUserId:
        process.env.CHATBOT_AUTO_ASSIGN_ADVISOR_ID?.trim() || undefined,
    });
    await ctx.runMutation(deps.internal.messages.insertAssistantMessage, {
      conversationId,
      content: cqMsg,
      createdAt: tCq,
    });
    await deliverText({
      to: args.phone,
      text: cqMsg,
      wamid: args.wamid,
    });
    await ctx.runMutation(deps.internal.messages.insertSystemMessage, {
      conversationId,
      content:
        '❓ El cliente hizo una PREGUNTA en la fase de contrato que el bot no pudo responder (sin FAQ). Contestarle la duda y ayudar a cerrar la reserva. La IA quedó en pausa.',
      createdAt: tCq + 5,
      metadata: {
        kind: 'inbox_escalation_alert',
        escalationReason: 'contract_question',
      },
    });
    await ctx.runMutation(deps.internal.conversations.updateLastMessageAt, {
      conversationId,
    });
    return;
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
      'inbound: getLatestCatalogRetailerIds fallo (degradado, sigue sin resolver pick vago):',
      err,
    );
  }

  // Pre-fetch del PLAYBOOK DE TONO: lazy vía `fetchPlaybookContext` (solo si
  // el turno usa LLM contextual — mismo patrón que `fetchStayQuote`).
  const fetchPlaybookContext = async (): Promise<string | null> => {
    try {
      const pb = (await ctx.runAction(deps.api.knowledge.searchPlaybookForBot, {
        query: textForTurn,
        phase: currentPhase,
      })) as { text?: string; count?: number } | null;
      const pbText = String(pb?.text ?? '').trim();
      return pbText || null;
    } catch (err) {
      console.error(
        'inbound: searchPlaybookForBot fallo (degradado, sigue sin tono):',
        err,
      );
      return null;
    }
  };

  const result = await deps.runBotTurn({
    messageText: textForTurn,
    currentPhase,
    currentEntities,
    conversationHistory: history,
    currentSamePhaseTurnCount,
    currentPhaseEnteredAt,
    resumeOngoingConversation,
    faqContext,
    fetchPlaybookContext,
    contactName: args.name,
    lastCatalogRetailerIds,
    tagFlags,
    channel: deps.channel ?? 'whatsapp',
    resolvePropertyByName: async (name: string) => {
      const n = String(name ?? '').trim();
      if (!n) return null;
      return (await ctx.runQuery(
        deps.api.whatsappCatalogs.findPropertyByNameForBot,
        { name: n },
      )) as {
        productRetailerId: string;
        title: string;
        location: string;
      } | null;
    },
    fetchStayQuote: async (e: BotEntities) => {
      const rid =
        e.selectedPropertyRetailerId?.trim() ||
        inferRetailerIdFromCatalogTitle(e.selectedPropertyName) ||
        '';
      const cin = e.checkIn?.trim();
      const cout = e.checkOut?.trim();
      if (!rid || !cin || !cout) return null;
      const data = (await ctx.runQuery(
        deps.api.whatsappCatalogs.getBotStayQuoteByRetailerId,
        {
          productRetailerId: rid,
          fechaEntrada: cin,
          fechaSalida: cout,
          cupo: e.cupo,
        },
      )) as {
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
      const text = String(data?.text ?? '').trim();
      if (!text) return null;
      return {
        text,
        totals: data?.totals
          ? {
              propertyTitle: String(data.totals.propertyTitle ?? '').trim(),
              nightly: Number(data.totals.nightly ?? 0),
              nightsCount: Number(data.totals.nightsCount ?? 0),
              subtotal: Number(data.totals.subtotal ?? 0),
              appliedRule: String(data.totals.appliedRule ?? '').trim(),
              cupo: Number(data.totals.cupo ?? 0),
              damageDeposit: Number(data.totals.damageDeposit ?? 0),
              wristbandFee: Number(data.totals.wristbandFee ?? 0),
            }
          : undefined,
      };
    },
  });

  if (
    !(await isStillThisTailUserMessage(
      ctx,
      deps,
      conversationId,
      String(insertedMsgId),
      now,
    ))
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
  const deferReplyForCatalog = action.type === 'send_catalog';

  // ─── ESTADÍA LARGA (3+ noches) — alerta blanda ─────────────────────────
  // Si las fechas resueltas en este turno cubren 3 noches o más, marcamos
  // la conversación como OPORTUNIDAD PRIORITARIA. El bot sigue cualificando
  // normal; el asesor entra antes para acompañar el cierre de mayor valor.
  // Cubre los 4 ejemplos del story (3 noches, viernes→lunes = 3 noches,
  // 4 noches, "varios días" si las fechas concretas lo confirman).
  {
    const ci = (result.updatedEntities as { checkIn?: string }).checkIn;
    const co = (result.updatedEntities as { checkOut?: string }).checkOut;
    if (typeof ci === 'string' && typeof co === 'string') {
      const nights = countNights(ci, co);
      if (nights >= 3) {
        await ctx.runMutation(deps.internal.conversations.flagPriorityAlert, {
          conversationId,
          alertReason: 'long_stay_3plus',
          priority: 'medium' as const,
          tag: 'oportunidad-prioritaria',
          inboxMessage: `🏖️ ESTADÍA LARGA detectada — ${nights} noches (${ci} → ${co}). Oportunidad comercial prioritaria; el bot sigue cualificando pero un asesor debería entrar pronto para cerrar.`,
        });
      }
    }
  }

  // ─── AUTO-ETIQUETADO DE LEAD ─────────────────────────────────────────
  // Cuando el bot ya tiene contexto comercial significativo (finca elegida
  // + cupo), enriquece el nombre del contacto en el inbox con la etiqueta
  // del deal — así de un vistazo el equipo sabe quién es quién:
  //   "Camilo R"  →  "Camilo R · Quinta Montebello · 15pax · 07-08→10-08"
  // También sube `crmType` a 'lead' (sin degradar 'client' si ya cerró).
  // La mutación es idempotente: si el dealLabel no cambió, no-op.
  {
    const e = result.updatedEntities as {
      selectedPropertyName?: string;
      cupo?: number;
      checkIn?: string;
      checkOut?: string;
    };
    if (
      typeof e.selectedPropertyName === 'string' &&
      e.selectedPropertyName.trim().length > 0 &&
      typeof e.cupo === 'number' &&
      e.cupo > 0
    ) {
      const parts: string[] = [e.selectedPropertyName.trim(), `${e.cupo}pax`];
      if (e.checkIn && e.checkOut) {
        const fmtMmDd = (ymd: string) => ymd.slice(5); // "MM-DD"
        parts.push(`${fmtMmDd(e.checkIn)}→${fmtMmDd(e.checkOut)}`);
      }
      const dealLabel = parts.join(' · ');
      await ctx.runMutation(deps.internal.contacts.setLeadDealLabel, {
        contactId: conv.contactId,
        dealLabel,
      });
    }
  }

  // ─── AUTO-ENRIQUECIMIENTO DEL CONTACTO con datos del contrato ─────────
  // El bot recolecta nombre/cédula/email/dirección turno a turno en la fase
  // `contract`. Apenas alguno aparezca en `updatedEntities`, lo copiamos al
  // contact del CRM — así el equipo lo ve enriquecido sin esperar a que un
  // asesor lo escriba a mano. Idempotente: la mutación solo escribe lo
  // que falta en el contact (no pisa lo que ya hay).
  {
    const ce = result.updatedEntities as {
      contractName?: string;
      contractCedula?: string;
      contractEmail?: string;
      contractAddress?: string;
    };
    if (
      ce.contractName ||
      ce.contractCedula ||
      ce.contractEmail ||
      ce.contractAddress
    ) {
      await ctx.runMutation(deps.internal.contacts.upsertFromContractData, {
        contactId: conv.contactId,
        contractName: ce.contractName,
        contractCedula: ce.contractCedula,
        contractEmail: ce.contractEmail,
        contractAddress: ce.contractAddress,
      });
    }
  }

  // ─── FUERA DE HORARIO — acuse al cliente ───────────────────────────────
  // Si el cliente escribe fuera del horario laboral configurado, anexamos
  // un aviso al primer reply. Solo se anexa UNA vez por conversación
  // (idempotencia vía `markAlertFired`). Emergencias y escalaciones duras
  // bypassan (ya tienen su propio mensaje y se atienden 24/7).
  if (
    result.replyText &&
    action.type !== 'escalate_human' &&
    !isWithinBusinessHours(Date.now()) &&
    !temporalMessageWasSentForConversation &&
    !advisorContinuityWasSentForConversation
  ) {
    const alreadyNotified = (await ctx.runMutation(
      deps.internal.botSessions.markAlertFired,
      {
        conversationId,
        phone: args.phone,
        alertReason: 'after_hours_notice',
      },
    )) as boolean;
    if (alreadyNotified) {
      result.replyText = String(result.replyText) + AFTER_HOURS_NOTICE;
      // Si el cliente además marcó URGENTE en el mensaje, alerta blanda
      // para que un on-call vea el caso aunque sea fuera de horario.
      if (clientFlaggedUrgent(textForTurn)) {
        await ctx.runMutation(deps.internal.conversations.flagPriorityAlert, {
          conversationId,
          alertReason: 'urgent_after_hours',
          priority: 'urgent' as const,
          tag: 'urgente-fuera-horario',
          inboxMessage: `⏰⚡ Cliente marcó URGENTE fuera de horario laboral. Mensaje: "${textForTurn.slice(0, 200)}". Considerar atención on-call.`,
        });
        await fireUrgentWebhookIfConfigured({
          alertReason: 'urgent_after_hours',
          conversationId: String(conversationId),
          contactPhone: args.phone,
          contactName: args.name,
          lastMessage: textForTurn.slice(0, 500),
          team: 'operaciones',
        });
      }
    }
  }

  if (result.replyText && !deferReplyForCatalog) {
    const replyWamid = String(args.wamid ?? '').trim();
    await sendAssistantText({
      conversationId,
      to: args.phone,
      text: result.replyText,
      wamid: args.wamid,
      metadata: {
        ...(replyWamid.length > 6 ? { replyToWamid: replyWamid } : {}),
        ...(result.playbookUsed ? { playbookUsed: true } : {}),
      },
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
      const text = String(extra ?? '').trim();
      if (!text) continue;
      await new Promise((r) => setTimeout(r, 600));
      await sendAssistantText({
        conversationId,
        to: args.phone,
        text,
      });
    }
  }

  // ─── CIERRE por mensaje temporal (fin del flujo) ──────────────────────
  // Cuando el admin envía un mensaje temporal al inicio, el cliente debe
  // recibir un cierre similar al final del flujo (ej. al completar contrato).
  if (
    temporalMessageWasSentForConversation &&
    action.type === 'escalate_human' &&
    (action as any)?.reason === 'contract_complete'
  ) {
    const alreadyClosing = (await ctx.runMutation(
      deps.internal.botSessions.markAlertFired,
      {
        conversationId,
        phone: args.phone,
        alertReason: 'whatsapp_temporal_message_closing_sent',
      },
    )) as boolean;

    if (alreadyClosing) {
      const closingText = TEMPORAL_MESSAGE_CLOSING;
      await sendAssistantText({
        conversationId,
        to: args.phone,
        text: closingText,
        wamid: args.wamid,
        metadata:
          replyToWamid.length > 6
            ? { source: 'whatsapp_temporal_message_closing', replyToWamid }
            : { source: 'whatsapp_temporal_message_closing' },
      });
    }
  }

  if (action.type === 'send_catalog') {
    if (
      !(await isStillThisTailUserMessage(
        ctx,
        deps,
        conversationId,
        String(insertedMsgId),
        now,
      ))
    ) {
      return;
    }
    // Si el cliente confirmó evento Y declaró capacidad de evento mayor que el
    // cupo de hospedaje, el filtro de catálogo debe respetar la mayor. El helper
    // server-side `catalogPeopleCountForFilter` ya considera `eventCapacity` de
    // la finca cuando `isEvento=true`; aquí solo le pasamos el `minCapacity`
    // correcto (lo que el cliente realmente necesita acomodar).
    const eventPeople = Number(result.updatedEntities.eventPeopleCount ?? 0);
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
          'inbound: getAllCatalogRetailerIdsForConversation fallo (paginación degradada):',
          err,
        );
      }
    }

    // Filtros geográficos — ZONAS A EXCLUIR. Fuente PRIMARIA: el LLM extractor
    // (`updatedEntities.excludedRegions`), que INTERPRETA la intención del
    // cliente sin importar el fraseo ("no llanos", "todos menos el llano",
    // "que no sea Villavicencio", "lejos de la costa"…). Persiste entre turnos
    // porque vive en las entidades. Fuente SECUNDARIA (red de seguridad): la
    // regex `detectExcludedZoneKeywords` sobre los mensajes recientes — por si
    // el LLM no clasificó la zona. Se unen ambas.
    const llmExcludedKeywords: string[] = [];
    for (const region of (result.updatedEntities?.excludedRegions ??
      []) as string[]) {
      const kws = REGIONS[region as keyof typeof REGIONS];
      if (kws) llmExcludedKeywords.push(...kws);
    }
    const excludeLocationKeywords = Array.from(
      new Set([
        ...llmExcludedKeywords,
        ...detectExcludedZoneKeywords(recentUserText),
      ]),
    );
    let restrictToLocationKeywords =
      detectRestrictedZoneKeywords(recentUserText);

    // Una zona EXCLUIDA no puede a la vez estar RESTRINGIDA (incluida). Esto
    // pasa con frases como "no esté EN los llanos": `detectExcludedZoneKeywords`
    // captura LLANOS (correcto), pero `detectRestrictedZoneKeywords` TAMBIÉN lo
    // captura — la regex de inclusión matchea "en los llanos" y su lookbehind
    // `(?<!no\s)` solo mira UNA palabra atrás, así que el "no" de "no esté en
    // los llanos" no lo frena. Sin esta resta, el query recibe
    // restrict=LLANOS + exclude=LLANOS → contradicción → catálogo VACÍO → el
    // bot escala a un asesor sin razón (mientras que "que no SEAN los llanos",
    // sin la palabra "en", sí funciona — de ahí la incoherencia reportada).
    if (excludeLocationKeywords.length && restrictToLocationKeywords.length) {
      const exclSet = new Set(excludeLocationKeywords);
      restrictToLocationKeywords = restrictToLocationKeywords.filter(
        (kw) => !exclSet.has(kw),
      );
    }

    // Modo "alrededores" / multi-zona: el cliente quiere ver opciones de
    // varios lugares cercanos (no un solo municipio específico). En ese caso
    // ampliamos el cap del catálogo de 12 → 25 para que vea más variedad de
    // zonas. El sort de favoritas-primero (en `whatsappCatalogs.ts`)
    // garantiza que las marcadas como favoritas salgan al inicio.
    // COLECCIÓN/CATEGORÍA pedida por el cliente (playa, lujo, eje cafetero…).
    // Se detecta sobre todo el texto reciente del cliente. Si matchea, se pasa
    // como `categoryMatch` al query (filtro híbrido tag+ubicación+atributo) y
    // se ajusta el texto pre-catálogo para nombrar la colección.
    const categoryCollection = detectCategoryCollection(recentUserText);

    // EXPANSIÓN POR DEPARTAMENTO/ZONA: si el cliente pidió un municipio
    // concreto, ampliamos a toda su zona (Melgar → todo Tolima) para no
    // quedarnos en 2-3 opciones. El municipio exacto sale PRIMERO (sort
    // Tier 0). NO aplica en RECOMENDADAS ni cuando hay restricción/exclusión
    // de zona activa (el cliente fue explícito sobre qué zona quiere/evita) ni
    // cuando pidió una colección (playa/lujo/etc. ya define su propio alcance).
    const noZoneConstraint =
      restrictToLocationKeywords.length === 0 &&
      excludeLocationKeywords.length === 0 &&
      !categoryCollection;
    const deptExpansion =
      action.location !== 'RECOMENDADAS' && noZoneConstraint
        ? departmentExpansionForMunicipality(action.location)
        : null;

    // Cap del catálogo. Modo expandido (hasta 25 fincas) cuando el cliente
    // pide "alrededores"/multi-zona O cuando expandimos a un departamento
    // (Melgar → todo Tolima): así caben el municipio + el resto de la zona +
    // las marcadas "cerca a" sin que el municipio exacto (que va primero)
    // sature el cap normal de 12.
    const expandedMode = wantsExpandedSearch(recentUserText) || !!deptExpansion;
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
        // Expansión por departamento/zona (Melgar → todo Tolima). El municipio
        // exacto sale primero por el sort Tier 0.
        ...(deptExpansion
          ? {
              expandLocationKeywords: deptExpansion.keywords,
              expandDepartmentCodes: deptExpansion.deptCodes,
            }
          : {}),
        // Filtro por colección/categoría (playa, lujo, eje cafetero…) si el
        // cliente la pidió. AND adicional con location/capacity; OR interno.
        ...(categoryCollection
          ? { categoryMatch: categoryCollection.categoryMatch }
          : {}),
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
      // ─── HONESTIDAD CUANDO LA QUERY HIZO FALLBACK A OTRA ZONA ──────────
      // Si el cliente pidió una ciudad concreta (ej. "Pereira") y la query
      // no encontró NINGUNA finca con ese nombre en los títulos devueltos,
      // significa que están viendo fincas de OTRAS zonas como fallback. En
      // ese caso NO mandamos el genérico "Te comparto las opciones
      // disponibles" — eso es deshonesto, parece que sí teníamos en su
      // ciudad. Mejor reconocer y proponer alternativas cercanas.
      //
      // Caso "RECOMENDADAS" (cliente no especificó zona) NO entra acá.
      const normLoc = (s: string) =>
        s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
      const titlesForLocCheck = catalogPayload.productTitles ?? [];
      const requestedLocNorm = normLoc(action.location);
      const isRecomendadas = action.location === 'RECOMENDADAS';
      const someMatchRequested =
        isRecomendadas ||
        titlesForLocCheck.some((t) => normLoc(t).includes(requestedLocNorm));
      const isFallbackOnly =
        !someMatchRequested && titlesForLocCheck.length > 0;
      const preCatalogText = isFallbackOnly
        ? [
            `Por el momento no tenemos fincas disponibles en *${action.location}* para esas fechas 😔`,
            '',
            'Pero con gusto te compartimos algunas opciones cercanas que podrían gustarte 🏡✨',
            '',
            '💰 Los valores son *aproximados* por noche y pueden variar según la *temporada*.',
            '👉 Cuéntanos *cuál te llama la atención* y con gusto te ayudamos con la reserva 🤝',
          ].join('\n')
        : categoryCollection
          ? [
              `✨ Con mucho gusto te compartimos nuestras opciones de *${categoryCollection.label}* 🏡`,
              '',
              '💰 Los valores son *aproximados* por noche y pueden variar según la *temporada*.',
              '👉 Cuéntanos *cuál te llama la atención* y con gusto te ayudamos con la reserva 🤝',
            ].join('\n')
          : result.replyText;

      // Hay fichas → ahora SÍ enviamos el pre-catálogo diferido + extras + fichas.
      if (preCatalogText) {
        await sendAssistantText({
          conversationId,
          to: args.phone,
          text: preCatalogText,
          wamid: args.wamid,
        });
      }
      for (const extra of extras) {
        const text = String(extra ?? '').trim();
        if (!text) continue;
        await new Promise((r) => setTimeout(r, 600));
        await sendAssistantText({
          conversationId,
          to: args.phone,
          text,
        });
      }

      const cap = effectiveSendCap;
      const ids = catalogPayload.productRetailerIds.slice(0, cap);
      const lines = (catalogPayload.productQuoteLines ?? []).slice(0, cap);
      const titles = (catalogPayload.productTitles ?? []).slice(0, cap);
      const sendRows = await deliverCatalog({
        to: args.phone,
        productRetailerIds: ids,
        productQuoteLines: lines.length ? lines : undefined,
        bodyText: `Fincas disponibles en ${action.location === 'RECOMENDADAS' ? 'nuestras zonas favoritas' : action.location}:`,
        catalogId: catalogPayload.catalogId,
        wamid: args.wamid,
        conversationId,
      });

      const tBase = Date.now();
      for (let i = 0; i < ids.length; i++) {
        // Si la ficha NO se pudo enviar (producto ausente del catálogo Meta,
        // etc.), `ok === false`: NO la registramos como mensaje de producto —
        // si no, la paginación "ver más" creería que se envió y la excluiría
        // (o peor, el cliente vería una finca que nunca recibió).
        if (sendRows[i] && sendRows[i].ok === false) continue;
        const quote = lines[i]?.trim();
        const title = titles[i]?.trim() || ids[i];
        const body = quote && quote.length > 0 ? quote : `🏡 ${title}`;
        const wamidOut = sendRows[i]?.wamid;
        const metadata: Record<string, unknown> = {
          productRetailerId: ids[i],
          wamid: wamidOut,
          productTitle: title,
        };
        if (deps.channel === 'web') {
          try {
            const prop = (await ctx.runQuery(
              deps.api.whatsappCatalogs.getPropertyByRetailerId,
              { productRetailerId: ids[i] },
            )) as {
              imageUrl?: string;
              slug?: string;
              propertyId?: string;
              propertyName?: string;
              location?: string;
            } | null;
            if (prop?.imageUrl?.trim())
              metadata.imageUrl = prop.imageUrl.trim();
            if (prop?.slug?.trim()) metadata.slug = prop.slug.trim();
            if (prop?.propertyId) metadata.propertyId = prop.propertyId;
            if (prop?.propertyName?.trim())
              metadata.propertyName = prop.propertyName.trim();
            if (prop?.location?.trim())
              metadata.location = prop.location.trim();
          } catch (err) {
            console.error(
              'inbound: getPropertyByRetailerId (web catalog UI):',
              err,
            );
          }
        }
        await ctx.runMutation(
          deps.internal.messages.insertAssistantMessageWithMedia,
          {
            conversationId,
            content: body,
            type: 'product',
            metadata,
            createdAt: tBase + i * 25,
            wamid: wamidOut,
            whatsappStatus: wamidOut ? 'sent' : undefined,
          },
        );
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
          '✨ Estas son algunas de nuestras fincas para tus fechas 🏡 Recuerde que los valores son *aproximados* y pueden variar según la *temporada*. Cuéntanos *cuál te gustó más* o si deseas información adicional y con gusto te ayudamos 🤝';
        await ctx.runMutation(deps.internal.messages.insertAssistantMessage, {
          conversationId,
          content: closeMsg,
          createdAt: tClose,
        });
        await deliverText({
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
            'Como es para *evento* 🎉, mientras revisas las opciones te hago un par de preguntas 👇',
            '',
          ];
          if (peopleCountMissing) {
            askLines.push(
              '👥 *Total de personas en el evento* (las que duermen + las que van solo por el día / pasadía).',
            );
          }
          if (logisticsMissing) {
            askLines.push(
              '🎵 *Logística del evento*:',
              '🎧 Sonido profesional / DJ / iluminación',
              '🎸 Banda en vivo o grupos musicales',
              '🏡 O solo el sonido básico de la finca (departir tranquilos)',
            );
          }
          askLines.push(
            '',
            'Cuéntame cuál finca te gusta y estos datos para confirmarte la disponibilidad 🤝',
          );
          const eventQuestionsMsg = askLines.join('\n');
          await ctx.runMutation(deps.internal.messages.insertAssistantMessage, {
            conversationId,
            content: eventQuestionsMsg,
            createdAt: tEvent,
          });
          await deliverText({
            to: args.phone,
            text: eventQuestionsMsg,
          });
        } else if (logistics === 'extra') {
          // Logística pesada (DJ / banda / sonido pro / iluminación) →
          // escalar al asesor: el bot NO calcula sobreprecio del evento.
          const eventHandoffMsg = [
            'Como es para *evento* 🎉, el precio final puede variar según la logística (sonido pro, banda, equipos).',
            '',
            '👉 Mientras revisas las opciones, te conecto con un experto para confirmarte *precios y disponibilidad* del evento. Te escribirá en breve 🤝 ✨',
          ].join('\n');
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
              '🎉 Evento con logística *extra* (DJ/banda/sonido pro). El cliente recibió el catálogo + entregó detalles. Confirmar precio/condiciones del evento. La IA quedó en pausa.',
            createdAt: tEvent + 5,
            metadata: {
              kind: 'inbox_escalation_alert',
              escalationReason: 'event_after_catalog',
              requestedLocation: action.location,
              requestedCupo: action.cupo,
              eventPeopleCount: peopleCount,
              eventLogistics: logistics,
            },
          });
          await deliverText({
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
            '¡Perfecto! 🎉 Para tu evento *básico* (sin sonido pro ni banda) te aplica la tarifa normal de la finca.',
            '',
            'Cuéntame *cuál finca te llama la atención* y seguimos con la reserva 🤝',
          ].join('\n');
          await ctx.runMutation(deps.internal.messages.insertAssistantMessage, {
            conversationId,
            content: basicEventAckMsg,
            createdAt: tEvent,
          });
          await deliverText({
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
        '¡Gracias por escribirnos! 🙌 Para tus fechas y tu plan queremos darte las mejores opciones.',
        '',
        '*Te conectamos con un experto* que revisa la disponibilidad y te arma opciones personalizadas 🤝',
        '',
        'En unos minutos un experto te escribe para ayudarte ✨',
      ].join('\n');
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
          '🚨 Catálogo vacío: el cliente pidió fincas pero los filtros (cupo + evento + zona) no devolvieron opciones. Revisar requisitos y contactar.',
        createdAt: tNoRes + 5,
        metadata: {
          kind: 'inbox_escalation_alert',
          escalationReason: 'catalog_no_results',
          requestedLocation: action.location,
          requestedCupo: action.cupo,
          requestedIsEvento: action.isEvento,
        },
      });
      await deliverText({
        to: args.phone,
        text: noResultsMsg,
      });
      await ctx.runMutation(deps.internal.conversations.updateLastMessageAt, {
        conversationId,
      });
      return;
    }
  } else if (action.type === 'escalate_human') {
    const reason = action.reason;
    await ctx.runMutation(deps.internal.conversations.escalate, {
      conversationId,
      assignedUserId:
        process.env.CHATBOT_AUTO_ASSIGN_ADVISOR_ID?.trim() || undefined,
      ...(reason === 'contract_complete'
        ? { priority: 'urgent' as const }
        : {}),
    });
    const alertCreatedAt = Date.now() + (result.replyText ? 20 : 0);
    const alertBody =
      reason === 'contract_complete'
        ? '🚨 El cliente completó los datos del contrato por WhatsApp. Prioridad: revisar, avisar al equipo si aplica y contactar al cliente. La IA quedó en pausa.'
        : reason === 'stuck_loop'
          ? '⚠️ Escalación automática: el cliente llevaba varios turnos sin avanzar; se ofreció asesor humano. Revisar y contactar. La IA quedó en pausa.'
          : reason === 'pets_exceed_limit'
            ? '🐾 El cliente declaró más de 3 mascotas. Evaluar condiciones especiales (aseo extra, fincas con espacio, depósito ajustado). La IA quedó en pausa.'
            : reason === 'catalog_no_results'
              ? '🚨 Catálogo vacío para los filtros del cliente. Revisar requisitos (cupo / evento / zona) y proponer opciones manualmente. La IA quedó en pausa.'
              : reason === 'event_after_catalog'
                ? '🎉 Evento confirmado: cliente recibió el catálogo. Confirmar precio y condiciones del evento (logística + capacidad). La IA quedó en pausa.'
                : reason === 'media_post_catalog'
                  ? '📎 Cliente envió archivo/foto en fase post-catálogo. Revisar (cédula, comprobante, doc). La IA quedó en pausa.'
                  : reason === 'client_requested'
                    ? '📣 El cliente pidió hablar con un experto. Revisar conversación y contactar. La IA quedó en pausa.'
                    : reason === 'stage1_catalog_pick'
                      ? '🏡 Etapa 1 — el cliente eligió una finca del catálogo. Validar disponibilidad y ampliar información. La IA quedó en pausa.'
                      : 'ℹ️ Conversación pasada a asesor humano. La IA quedó en pausa.';
    await ctx.runMutation(deps.internal.messages.insertSystemMessage, {
      conversationId,
      content: alertBody,
      createdAt: alertCreatedAt,
      metadata: {
        kind: 'inbox_escalation_alert',
        escalationReason: reason ?? 'generic',
      },
    });
  }

  // POST-PROCESADO de escalación implícita: la IA, cuando no sabe una
  // respuesta o ante frustración, naturalmente cae a frases tipo "te conecto
  // con un experto" / "déjame confirmarlo con un experto" / "un experto te
  // contacta en breve". Si el FSM NO devolvió `escalate_human` (la mayoría de
  // los casos donde la IA hace esto vía `contextualLlmReply`), antes el
  // sistema seguía con el bot y el cliente quedaba esperando un asesor que
  // NUNCA llegaba (bug reportado por Adriana). Ahora honramos la promesa:
  // si el reply menciona handoff y el FSM no escaló, escalamos de oficio.
  //
  // Las rutas que YA escalan (wantsHuman, pasadia, cedula, payment,
  // catalog_no_results, contract_question, event_after_catalog, etc.) hacen
  // `return` antes de llegar acá, así que NO se duplica la escalación.
  if (
    action.type !== 'escalate_human' &&
    result.replyText &&
    botPromisedHandoff(result.replyText)
  ) {
    await ctx.runMutation(deps.internal.conversations.escalate, {
      conversationId,
      assignedUserId:
        process.env.CHATBOT_AUTO_ASSIGN_ADVISOR_ID?.trim() || undefined,
    });
    await ctx.runMutation(deps.internal.messages.insertSystemMessage, {
      conversationId,
      content:
        '🤖→👤 La IA prometió pasar al cliente con un experto en su respuesta. Escalación automática para honrar la promesa — revisar conversación y contactar. La IA quedó en pausa.',
      createdAt: Date.now(),
      metadata: {
        kind: 'inbox_escalation_alert',
        escalationReason: 'bot_promised_handoff',
      },
    });
  }

  await ctx.runMutation(deps.internal.conversations.updateLastMessageAt, {
    conversationId,
  });
}
