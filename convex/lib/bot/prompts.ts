/**
 * Bot v2 — Prompts modulares por fase.
 *
 * Cada sección es una función que devuelve un string.
 * El orquestador los concatena según la fase actual.
 * Nada de esto vive en la BD ni es editable desde el frontend.
 */

import type { BotEntities, BotPhase } from "./types";
import { countNights, normalizePlanType } from "./entities";

/**
 * Cuando faltan 2+ campos simultáneamente, agrupa las preguntas en UN solo mensaje.
 * Si solo falta uno, devuelve null (usar `missingFieldQuestion`).
 */
export function missingFieldsBundle(e: BotEntities): string | null {
  const missing: string[] = [];

  if (!e.location) missing.push("📍 *Municipio o zona* de preferencia (o te recomiendo yo)");
  if (!e.checkIn || !e.checkOut) missing.push("📅 *Fecha de entrada y salida*");
  if (e.cupo === undefined || e.cupo <= 0) missing.push("👥 *Cuántas personas* van (niños desde 2 años cuentan)");
  if (!normalizePlanType(e.planType)) missing.push("🏡 *Tipo de grupo*: familiar, amigos o empresarial");
  if (e.isEvento === undefined) missing.push("🎉 ¿*Solo descanso* o habrá evento/celebración?");

  if (missing.length <= 1) return null;
  return `Para mostrarte las mejores opciones me faltan algunos datos 😊\n\n${missing.map((m) => `• ${m}`).join("\n")}`;
}

/** Lista keys de los campos del catálogo que aún faltan, en orden. */
function listMissingCatalogFields(e: BotEntities): Array<keyof BotEntities> {
  const out: Array<keyof BotEntities> = [];
  if (!e.location) out.push("location");
  if (!e.checkIn) out.push("checkIn");
  if (!e.checkOut) out.push("checkOut");
  if (e.cupo === undefined || e.cupo <= 0) out.push("cupo");
  if (!normalizePlanType(e.planType)) out.push("planType");
  if (e.isEvento === undefined) out.push("isEvento");
  if (e.isEvento === true) {
    if (e.eventPeopleCount === undefined || e.eventPeopleCount <= 0)
      out.push("eventPeopleCount");
    if (!e.eventLogistics) out.push("eventLogistics");
  }
  return out;
}

/**
 * Cuando faltan EXACTAMENTE 2 campos del catálogo, devuelve UNA pregunta natural
 * que combina ambas. Más conversacional que el bundle con bullets.
 * Si no aplica, devuelve null y se usa el bundle con bullets / la pregunta única.
 *
 * El caso más típico: faltan los dos últimos (`planType` + `isEvento`).
 */
export function combinedQuestionForMissing(e: BotEntities): string | null {
  const missing = listMissingCatalogFields(e);
  // Tratar checkIn+checkOut como un solo "campo fechas".
  const datesMissing = missing.includes("checkIn") || missing.includes("checkOut");
  const slotKeys = new Set<string>(
    missing.filter((m) => m !== "checkIn" && m !== "checkOut"),
  );
  if (datesMissing) slotKeys.add("dates");

  if (slotKeys.size !== 2) return null;

  const has = (k: string) => slotKeys.has(k);

  // planType + isEvento (los 2 últimos)
  if (has("planType") && has("isEvento")) {
    return (
      `¿Van en plan *familiar*, con *amigos* o *empresarial*? ` +
      `Y cuéntame: ¿es *solo descanso* o también con *evento/celebración* en la finca? 🏡🎉`
    );
  }

  // eventPeopleCount + eventLogistics (cuando el cliente confirma evento por primera vez)
  if (has("eventPeopleCount") && has("eventLogistics")) {
    return [
      "¡Genial, evento confirmado! 🎉 Para enviarte las mejores opciones necesito un par de datos:",
      "",
      "👥 *Personas*: ¿cuántas van en total? (Dormir + pasadía)",
      "",
      "🎵 *Logística*: ¿llevarás algo de esto?",
      "  🎧 Sonido profesional / DJ / iluminación",
      "  🎸 Banda en vivo o grupos musicales (mariachis, etc.)",
      "  🏡 O solo el sonido básico de la finca",
      "",
      "Cuéntame y te comparto las opciones disponibles 🤝",
    ].join("\n");
  }

  // cupo + planType
  if (has("cupo") && has("planType")) {
    return (
      `¿Cuántas *personas* van en total? (niños desde 2 años cuentan) ` +
      `Y cuéntame: ¿van en plan *familiar*, con *amigos* o *empresarial*? 👥🏡`
    );
  }

  // cupo + isEvento
  if (has("cupo") && has("isEvento")) {
    return (
      `¿Cuántas *personas* van en total? (niños desde 2 años cuentan) ` +
      `Y cuéntame: ¿es *solo descanso* o también con *evento/celebración*? 👥🎉`
    );
  }

  // location + planType
  if (has("location") && has("planType")) {
    return (
      `¿A qué *municipio o zona* quieren ir? (o te recomiendo yo). ` +
      `Y cuéntame: ¿el plan es *familiar*, con *amigos* o *empresarial*? 📍🏡`
    );
  }

  // location + isEvento
  if (has("location") && has("isEvento")) {
    return (
      `¿A qué *municipio o zona* quieren ir? (o te recomiendo yo). ` +
      `Y cuéntame: ¿es *solo descanso* o también con *evento/celebración*? 📍🎉`
    );
  }

  // location + dates
  if (has("location") && has("dates")) {
    return (
      `¿A qué *municipio o zona* quieren ir? (o te recomiendo yo). ` +
      `Y cuéntame: ¿qué *fechas* tienes en mente (entrada y salida)? 📍📅`
    );
  }

  // dates + cupo
  if (has("dates") && has("cupo")) {
    return (
      `¿Qué *fechas* tienes en mente (entrada y salida)? ` +
      `Y cuéntame: ¿cuántas *personas* van en total? 📅👥`
    );
  }

  // dates + planType
  if (has("dates") && has("planType")) {
    return (
      `¿Qué *fechas* tienes en mente (entrada y salida)? ` +
      `Y cuéntame: ¿el plan es *familiar*, con *amigos* o *empresarial*? 📅🏡`
    );
  }

  // dates + isEvento
  if (has("dates") && has("isEvento")) {
    return (
      `¿Qué *fechas* tienes en mente (entrada y salida)? ` +
      `Y cuéntame: ¿es *solo descanso* o también con *evento/celebración*? 📅🎉`
    );
  }

  return null;
}

/** Fragmentos muy cortos o poco claros (después del saludo inicial). */
export function isVagueShortMessage(raw: string): boolean {
  const t = String(raw ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");

  if (t.length === 0 || t.length > 120) return false;

  if (
    /^(\?|¿|¡|!|\.{2,}|…|mmmm?|mmm|uhm|emm|emm+|mm+|ok+|oka+y?|dale|dalee+|listo|si|sí|no|aje|aja|ajá|epa|eso|mmmm|vale|👍|🙏|👀)(\?|!|\.)*$/i.test(
      t,
    )
  ) {
    return true;
  }

  if (/^(solo|nah|mmm|mhmm|hum)\W*$/i.test(t)) return true;

  if (/\b(qu[eé]|qu[eé]{2,})\b/i.test(t) && t.length < 28) return true;

  return false;
}

function formatYmdForDisplay(iso?: string): string | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso.trim())) return null;
  const [y, m, d] = iso.trim().slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function hasPartialCatalogInfo(e: BotEntities): boolean {
  return !!(
    e.location ||
    e.checkIn ||
    e.checkOut ||
    e.planType ||
    e.cupo !== undefined ||
    e.isEvento !== undefined
  );
}

/**
 * Cuando ya hubo bienvenida y el cliente solo saluda o escribe algo poco claro:
 * resume lo que sí tenemos y pide cerrar/completar lo que falta.
 */
export function followUpCollectingRecapMessage(
  entities: BotEntities,
  missingField: keyof BotEntities | undefined,
): string {
  const lines: string[] = [];

  if (!hasPartialCatalogInfo(entities)) {
    lines.push(
      `Para mostrarte fincas 🏡 y validar las opciones disponibles ✅, ¿nos puedes confirmar los datos que te pedimos anteriormente? 📋✨`,
    );
    return lines.filter(Boolean).join("\n");
  }

  const di = formatYmdForDisplay(entities.checkIn);
  const doOut = formatYmdForDisplay(entities.checkOut);
  if (di && doOut) lines.push(`📅 Entrada ${di}, salida ${doOut}`);
  else if (di) lines.push(`📅 Entrada ${di} (confirmemos salida si falta)`);
  else lines.push(`📅 Fechas: aún pendientes`);

  if (entities.cupo !== undefined) lines.push(`👥 Cupo: *${entities.cupo} personas*`);
  else lines.push(`👥 Cupo: pendiente`);

  if (entities.location) {
    const locLabel = entities.location === "RECOMENDADAS" ? "recomendadas por nosotros" : entities.location;
    lines.push(`📍 Municipio/zona: *${locLabel}*`);
  } else lines.push(`📍 Municipio/zona: pendiente`);

  if (entities.planType)
    lines.push(`👨‍👩‍👧‍👦 Tipo de grupo: *${entities.planType}*`);
  else lines.push(`👨‍👩‍👧‍👦 Tipo de grupo (familiar / amigos / empresarial): pendiente`);

  if (entities.isEvento !== undefined)
    lines.push(entities.isEvento ? `🎉 Con evento o celebración` : `🏖️ Solo descanso (sin evento)`);
  else lines.push(`🎉 ¿Solo descanso o con evento/celebración?: pendiente`);

  lines.push("");
  const ask =
    missingField === "location"
      ? `Para validar *opciones reales disponibles*, dime el municipio o si prefieres que te sugiera zonas 😉`
      : missingField === "checkIn"
        ? `¿Me confirmas las *fechas de entrada y salida*? 📅`
        : missingField === "checkOut"
          ? `¿Cuál sería tu *fecha de salida*? 📅`
          : missingField === "cupo"
            ? `¿Cuántas *personas* van en total? 👨‍👩‍👧‍👦`
            : missingField === "planType"
              ? `¿Van en plan *familiar*, con *amigos* o es un grupo *empresarial*? 👨‍👩‍👧‍👦`
              : missingField === "isEvento"
                ? `¿Van *solo de descanso* o también *evento/celebración* en la finca? 🎊`
                : `¿Puedes *confirmar todo lo de arriba* o indicarme qué falta cambiar? ✨`;

  lines.push(ask);

  return lines.join("\n");
}

/** Ya se envió catálogo pero el cliente saluda sin elegir finca. */
export function followUpCatalogSentVagueMessage(): string {
  return (
    `¡Hola de nuevo! 👋 Ya te mandé algunas opciones en el chat 📲\n\n` +
    `Dime *cuál finca te interesa más* 🏡 o si quieres *otras fechas/zona*, lo afinamos 😉`
  ).trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Identidad y reglas globales
// ─────────────────────────────────────────────────────────────────────────────

export const IDENTITY = `
Eres Hernán, asesor comercial de FincasYa.com — plataforma de alquiler de fincas y casas campestres en Colombia.
Tono: amable, cálido, profesional. Nunca robótico. Usa emojis con moderación.
Idioma: español colombiano.
Nunca inventes precios ni información técnica que no tengas en el contexto.
`.trim();

export const GLOBAL_RULES = `
REGLAS GLOBALES:
- Sé breve. Máximo 3-4 líneas por respuesta salvo que el cliente pida detalles.
- No repitas preguntas que el cliente ya respondió.
- No menciones campos técnicos como "isEvento", "checkIn", "cupo".
- Si el cliente pregunta algo fuera de tema (fútbol, política, etc.), redirige amablemente.
- Nunca muestres JSON, IDs internos, ni términos técnicos al cliente.
`.trim();

/**
 * Conocimiento canónico sobre mascotas (política, cargos y reglas de convivencia).
 * Es info verificada — el bot SÍ puede responder con esto cuando el cliente pregunte
 * (no debe decir "déjame confirmarlo con un asesor" para temas listados aquí).
 *
 * Source: copy oficial validado por Santiago/FincasYa (2026-05-08).
 */
export const PET_RULES_KNOWLEDGE = `
POLÍTICA Y REGLAS DE MASCOTAS (info verificada — RESPONDER usando estos datos):

Tus mascotas son bienvenidas en la mayoría de nuestras opciones de alojamiento. Algunas fincas no las permiten.

CARGOS:
- Depósito reembolsable: $100.000 por cada mascota.
- Tarifa de ingreso: $30.000 a partir de la 3ª mascota.
- Limpieza adicional: si el cliente viaja con 3 o más mascotas, $70.000 (cargo único de aseo).

RECOMENDACIONES / REGLAS DE CONVIVENCIA (qué pueden y qué NO pueden hacer):
- 🚫 No ingresar las mascotas a la piscina.
- 🐾 Evitar orina o pelaje en zonas interiores.
- 🛋️ No subirlas a muebles ni camas.
- 🦴 Cuidar que no muerdan implementos de la casa.
- 💩 Recoger sus necesidades constantemente.

El incumplimiento de estas recomendaciones puede generar descuentos en el depósito.

INSTRUCCIONES PARA EL ASISTENTE AL HABLAR DE MASCOTAS:
- Si el cliente pregunta si su mascota PUEDE hacer X (entrar a la piscina, subir a muebles, etc.),
  responde con la regla concreta de arriba — NO digas "déjame confirmarlo".
- Si pregunta cuánto cuesta, cita los valores exactos. NO redondees ni inventes.
- Si pregunta algo NO listado (tamaño máximo, raza específica, paseo, comida, etc.),
  ahí sí responde "Déjame confirmarlo con un asesor para no darte un dato incorrecto."
- Sé breve: 2-3 líneas con los datos pertinentes y luego retoma el siguiente paso del flujo.
`.trim();

/**
 * Reglas anti-alucinación: el bot NUNCA debe inventar datos.
 * Se inyectan en todos los system prompts del LLM.
 */
export const ANTI_HALLUCINATION_RULES = `
REGLAS ANTI-INVENCIÓN (CRÍTICAS):
- NO inventes precios. Solo cita precios que aparecen explícitos en este contexto.
- NO inventes ubicación exacta de la finca. Solo confirma municipio. La dirección exacta se entrega después de firmar contrato y abonar 50%.
- NO prometas servicios (jacuzzi, BBQ, internet, transporte, parqueadero, etc.) si no aparecen explícitamente en este contexto.
- NO inventes capacidad, número de habitaciones, baños, ni cualquier detalle de la finca que no esté listado abajo.
- NO listes ni numeres fincas usando nombres genéricos como "Finca A", "Finca B", "Opción 1", "Opción 2", etc. Las fichas reales del catálogo viajan por WhatsApp como tarjetas interactivas — el cliente las ve aparte. JAMÁS escribas una lista enumerada de fincas en texto.
- Si el cliente pregunta algo cuya respuesta NO está en este contexto, responde literalmente: "Déjame confirmarlo con un asesor para no darte un dato incorrecto." y luego retoma el siguiente paso del proceso.
- NO reenvíes bloques largos que ya enviamos en mensajes anteriores. Si el cliente solo saluda o no responde el dato pedido, reformula brevemente la pregunta puntual del dato que falta — máximo 2 líneas.
- NO digas "un momento", "déjame revisar", "te respondo en breve", "voy a procesar". El bot solo responde cuando el cliente escribe; si dices que harás algo después, el cliente queda esperando.
- NO prometas enviar nada (catálogo, contrato, fotos) más tarde. Si lo necesitas ahora, pídelo en el mismo mensaje.
- Tono cálido, breve, en español colombiano.
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
// Resumen humano-legible de las entidades (para inyectar en el system del LLM).
// ─────────────────────────────────────────────────────────────────────────────

function fmtYmd(iso?: string): string | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso.trim())) return null;
  const [y, m, d] = iso.trim().slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/** Texto humano de lo que ya se sabe del cliente. Vacío si no hay nada. */
export function entitiesSummaryHuman(e: BotEntities): string {
  const lines: string[] = [];
  const di = fmtYmd(e.checkIn);
  const doOut = fmtYmd(e.checkOut);
  if (di && doOut) lines.push(`- Fechas: ${di} → ${doOut}`);
  else if (di) lines.push(`- Fecha de entrada: ${di} (falta salida)`);
  if (e.cupo !== undefined) lines.push(`- Personas: ${e.cupo}`);
  if (e.location)
    lines.push(
      `- Municipio/zona: ${e.location === "RECOMENDADAS" ? "sin preferencia (recomendar)" : e.location}`,
    );
  if (e.planType) lines.push(`- Tipo de grupo: ${e.planType}`);
  if (e.isEvento !== undefined)
    lines.push(`- Plan: ${e.isEvento ? "evento/celebración" : "solo descanso"}`);
  if (e.isEvento === true && e.eventPeopleCount !== undefined)
    lines.push(`- Personas del evento (total): ${e.eventPeopleCount}`);
  if (e.isEvento === true && e.eventLogistics)
    lines.push(
      `- Logística del evento: ${e.eventLogistics === "extra" ? "lleva sonido pro / banda / DJ" : "solo sonido básico de la finca"}`,
    );
  if (e.selectedPropertyName) lines.push(`- Finca elegida: ${e.selectedPropertyName}`);
  if (e.hasPets !== undefined) {
    if (e.hasPets) lines.push(`- Mascotas: sí (${e.petCount ?? 1})`);
    else lines.push(`- Mascotas: no`);
  }
  if (e.contractName) lines.push(`- Nombre: ${e.contractName}`);
  if (e.contractCedula) lines.push(`- Cédula: ${e.contractCedula}`);
  if (e.contractEmail) lines.push(`- Correo: ${e.contractEmail}`);
  if (e.contractPhone) lines.push(`- Teléfono: ${e.contractPhone}`);
  if (e.contractAddress) lines.push(`- Dirección: ${e.contractAddress}`);
  return lines.join("\n");
}

/** Texto del dato puntual que está faltando para avanzar el FSM. */
function nextStepHint(phase: BotPhase, e: BotEntities): string {
  if (phase === "welcome" || phase === "collecting") {
    if (!e.location) return "Falta el municipio (o decir que recomendamos).";
    if (!e.checkIn || !e.checkOut) return "Faltan las fechas de entrada y salida.";
    if (e.cupo === undefined || e.cupo <= 0) return "Falta cuántas personas van.";
    if (!e.planType) return "Falta el tipo de grupo (familiar/amigos/empresarial).";
    if (e.isEvento === undefined) return "Falta saber si es solo descanso o con evento.";
    if (e.isEvento === true && (e.eventPeopleCount === undefined || e.eventPeopleCount <= 0))
      return "Falta cuántas personas van al evento (dormir + pasadía).";
    if (e.isEvento === true && !e.eventLogistics)
      return "Falta la logística del evento (sonido pro/DJ, banda en vivo o solo sonido básico).";
    return "Ya tenemos todos los datos: enviar catálogo en el siguiente turno.";
  }
  if (phase === "catalog_sent") {
    return "El catálogo ya se envió. El cliente debe elegir una finca de las opciones que recibió.";
  }
  if (phase === "property_selected" || phase === "pet_check") {
    if (e.hasPets === undefined) return "Falta confirmar si lleva mascotas y cuántas.";
    if (
      e.hasPets === true &&
      (e.petCount === undefined || e.petCount <= 0)
    ) {
      return "Falta saber cuántas mascotas.";
    }
    return "Mascotas confirmadas; ahora mostramos las reglas y pedimos confirmación.";
  }
  if (phase === "pet_rules_shown") {
    return "Cliente vio las reglas de mascotas. Esperando que confirme para mostrar el resumen con totales.";
  }
  if (phase === "contract") {
    const missing: string[] = [];
    if (!e.contractName) missing.push("nombre completo");
    if (!e.contractCedula) missing.push("cédula (número + ciudad de expedición + foto)");
    if (!e.contractEmail) missing.push("correo electrónico");
    if (!e.contractPhone && !e.contractAddress) missing.push("teléfono o dirección");
    if (missing.length === 0) return "Datos completos: el contrato está listo para procesar.";
    return `Faltan estos datos del contrato: ${missing.join(", ")}.`;
  }
  if (phase === "done") return "Reserva en proceso, escalada a un asesor humano.";
  return "";
}

const PHASE_GOAL: Record<BotPhase, string> = {
  welcome: "Saludar y empezar a recolectar datos para mostrar fincas disponibles.",
  collecting: "Recolectar municipio, fechas, personas, tipo de grupo y si hay evento.",
  catalog_sent: "El cliente debe elegir una de las fincas que recibió por catálogo.",
  property_selected: "Confirmar mascotas para la finca elegida.",
  pet_check: "Confirmar si lleva mascotas y cuántas.",
  pet_rules_shown:
    "Se mostraron las reglas de mascotas; esperar confirmación del cliente para mostrar el resumen con totales.",
  quote_shown:
    "Se mostró el resumen con el total; esperar confirmación del cliente para pedir los datos del contrato.",
  contract: "Recolectar nombre, cédula, correo, teléfono y dirección para el contrato.",
  done: "Cliente entregó datos del contrato; esperando que un asesor humano lo contacte.",
};

export interface ContextSystemPromptOpts {
  /** Bloque de cotización ya calculado (alojamiento + mascotas), si existe. */
  stayQuoteBlock?: string | null;
  /** Texto adicional con datos verificados de la propiedad (capacidad, mascotas permitidas, etc.). */
  propertyContext?: string | null;
  /** Turnos consecutivos en esta misma fase. Si > 3, refuerza la instrucción anti-repetición. */
  samePhaseTurnCount?: number;
  /**
   * Resultado de búsqueda en el RAG de FAQs (`searchFaqForBot`). Texto plano con
   * los fragmentos más relevantes para la pregunta del cliente. Se inyecta como
   * "info verificada — usar para responder" y tiene prioridad sobre lo que el
   * modelo "crea saber".
   */
  ragContext?: string | null;
}

/**
 * System prompt enriquecido para fallback inteligente.
 * Se usa cuando el cliente sale del guion (preguntas, dudas, frustración, saludo repetido).
 * Trae todo el estado del FSM + datos verificados + reglas anti-invención.
 */
export function buildContextSystemPrompt(
  phase: BotPhase,
  entities: BotEntities,
  opts: ContextSystemPromptOpts = {},
): string {
  const summary = entitiesSummaryHuman(entities);
  const hint = nextStepHint(phase, entities);
  const stuck = (opts.samePhaseTurnCount ?? 0) >= 2;

  const sections: string[] = [
    IDENTITY,
    "",
    GLOBAL_RULES,
    "",
    ANTI_HALLUCINATION_RULES,
    "",
    "ESTADO ACTUAL DE LA CONVERSACIÓN:",
    `- Fase del proceso: ${phase}`,
    `- Objetivo de esta fase: ${PHASE_GOAL[phase] ?? ""}`,
  ];

  if (summary) {
    sections.push("", "DATOS YA CONFIRMADOS POR EL CLIENTE:", summary);
  } else {
    sections.push("", "DATOS YA CONFIRMADOS: ninguno todavía.");
  }

  if (hint) {
    sections.push("", `SIGUIENTE PASO: ${hint}`);
  }

  if (opts.propertyContext && opts.propertyContext.trim()) {
    sections.push("", "DATOS VERIFICADOS DE LA FINCA SELECCIONADA:", opts.propertyContext.trim());
  }

  if (opts.stayQuoteBlock && opts.stayQuoteBlock.trim()) {
    sections.push("", "COTIZACIÓN VIGENTE:", opts.stayQuoteBlock.trim());
  }

  if (opts.ragContext && opts.ragContext.trim()) {
    sections.push(
      "",
      "INFO VERIFICADA DESDE LA BASE DE CONOCIMIENTO (RAG) — RESPONDER usando estos fragmentos cuando el cliente pregunte sobre estos temas. NO inventar más allá de lo que dice aquí:",
      opts.ragContext.trim(),
    );
  }

  sections.push(
    "",
    "REGLAS DE NEGOCIO FIJAS (úsalas cuando el cliente pregunte):",
    "- Reserva: el cliente abona 50% para asegurar la fecha; el resto se paga según el contrato.",
    "- Respaldo legal: RNT 163658, FincasYa.com.",
    "- Ubicación exacta de la finca: solo se entrega después de firmar contrato y pagar el abono.",
    "- Fechas: se trabajan en formato día/mes/año en el chat.",
    "",
    PET_RULES_KNOWLEDGE,
    "",
    "INSTRUCCIONES PARA TU RESPUESTA:",
    "- Responde primero al mensaje del cliente (resolver duda, aclarar, reconocer cambio de plan).",
    "- Cierra recordando brevemente el siguiente paso del proceso (lo de SIGUIENTE PASO de arriba), en una sola frase corta.",
    "- Máximo 3 líneas. Tono natural, no robótico.",
    "- Si el cliente saluda o repite algo, NO reenvíes los bloques largos que ya enviamos antes; solo recuerda el siguiente paso de forma breve.",
  );

  if (stuck) {
    sections.push(
      "- ⚠️ El cliente lleva varios turnos sin avanzar. Sé MUY breve, pregunta solo el dato puntual que falta y, si no lo da en el siguiente turno, ofrece pasarlo con un asesor humano.",
    );
  }

  return sections.join("\n");
}

/** Mensaje cuando se detecta bucle de repetición y se ofrece humano. */
export const LOOP_OFFER_HUMAN_MESSAGE =
  `Veo que estamos dando vueltas 🙏 ¿Prefieres que te conecte con un asesor humano para terminar esto más rápido? Solo responde *sí* y te paso con alguien del equipo ✨`;

/**
 * Mensaje cuando el cliente declara más mascotas de las que el bot maneja
 * automáticamente (ver `MAX_PETS_AUTO_HANDLING` en `entities.ts`). El bot NO
 * calcula costo ni avanza al contrato: deja que un asesor evalúe condiciones
 * especiales (aseo extra, finca con espacio suficiente, depósito ajustado).
 */
export function petsExceedLimitMessage(petCount: number): string {
  const n = Math.max(0, Math.floor(petCount));
  return [
    `Para *${n} mascota${n === 1 ? "" : "s"}* necesito que un asesor te confirme las condiciones especiales 🤝`,
    "",
    "Nuestro bot maneja hasta *3 mascotas* automáticamente. Para grupos más grandes evaluamos caso por caso: aseo extra, disponibilidad de fincas con espacio suficiente, depósito ajustado, etc.",
    "",
    "Un agente te escribirá en breve para terminar tu reserva ✨",
  ].join("\n");
}

/**
 * Pregunta corta y natural de "siguiente paso" según la fase del FSM.
 * Se usa para cerrar respuestas literales del RAG (cuando bypaseamos el LLM)
 * sin perder el hilo del flujo comercial.
 *
 * Ejemplo: el cliente pregunta horarios en `pet_check` → respondemos con el
 * texto del RAG literal + `"¿Me confirmas si llevas mascotas y cuántas?"`.
 */
export function nextStepFriendlyQuestion(
  phase: BotPhase,
  entities: BotEntities,
  missingField?: keyof BotEntities,
): string {
  // pet_check / property_selected → preguntar mascotas si aún no respondió.
  if (phase === "pet_check" || phase === "property_selected") {
    if (entities.hasPets === undefined) {
      return `¿Me confirmas si llevas *mascotas* (y cuántas) o sin ellas? 🐾`;
    }
    if (entities.hasPets === true && (entities.petCount === undefined || entities.petCount <= 0)) {
      return `¿*Cuántas mascotas* en total? (Solo el número) 🐾`;
    }
    return `¿Avanzamos con los datos del contrato? 📋`;
  }

  // pet_rules_shown → esperando confirmación sí/no.
  if (phase === "pet_rules_shown") {
    return `¿Estás de acuerdo con las condiciones de mascotas? Responde *sí* y te paso el resumen 🤝`;
  }

  // contract → recordar que faltan datos del contrato.
  if (phase === "contract") {
    const missing: string[] = [];
    if (!entities.contractName) missing.push("nombre completo");
    if (!entities.contractCedula) missing.push("cédula");
    if (!entities.contractEmail) missing.push("correo");
    if (!entities.contractPhone && !entities.contractAddress)
      missing.push("teléfono o dirección");
    if (missing.length === 0) {
      return `¿Confirmamos para enviarte el contrato? ✨`;
    }
    if (missing.length === 1) {
      return `¿Me compartes tu *${missing[0]}* para avanzar con el contrato? 📋`;
    }
    return `¿Me compartes tus *datos del contrato* (${missing.join(", ")}) para terminar la reserva? 📋`;
  }

  // catalog_sent → ya enviamos catálogo, pedir elección.
  if (phase === "catalog_sent") {
    return `¿Cuál de las opciones que te envié te llamó la atención? 🏡`;
  }

  // collecting / welcome → pedir el dato puntual que falta.
  if (phase === "collecting" || phase === "welcome") {
    if (missingField) return missingFieldQuestion(missingField, entities);
    return `¡Listo! Te comparto las opciones disponibles 🏡✨`;
  }

  // done / quote_shown → cierre amable.
  return `¿Continuamos con tu reserva? ✨`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mensajes estáticos (sin LLM)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extrae el primer nombre "saludable" del contactName que YCloud nos pasa
 * (suele venir del perfil de WhatsApp del cliente). Devuelve `null` cuando el
 * valor no es usable como saludo personalizado, para que el copy caiga al
 * "¡Hola!" genérico sin romperse.
 *
 * Reglas:
 *   - Trim + descartar vacío.
 *   - Descartar si parece teléfono o solo dígitos/símbolos (`+57 321...`).
 *   - Limpiar caracteres no alfabéticos (emojis, comillas raras) preservando
 *     tildes, ñ, apóstrofes y guiones (D'Costa, José-María).
 *   - Tomar SOLO el primer token (los apellidos no se usan en saludo).
 *   - Capitalizar (Adriana, José, María) con locale `es-CO`.
 *   - Longitud útil: 2..20 caracteres. Fuera de eso → null (probable basura).
 */
export function firstNameForGreeting(rawName?: string | null): string | null {
  const raw = String(rawName ?? "").trim();
  if (!raw) return null;
  // Teléfonos o cadenas sin letras → descartar.
  if (/^[\d+\-\s()]+$/.test(raw)) return null;
  const cleaned = raw
    .replace(/[^\p{L}\p{N}\s'\-.]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  const firstWord = cleaned.split(" ")[0];
  if (firstWord.length < 2 || firstWord.length > 20) return null;
  return (
    firstWord.charAt(0).toLocaleUpperCase("es-CO") +
    firstWord.slice(1).toLocaleLowerCase("es-CO")
  );
}

/**
 * Construye el mensaje de bienvenida, personalizado con el primer nombre del
 * cliente cuando es usable. Si no hay nombre o no es válido, cae al saludo
 * genérico ("¡Hola!").
 *
 * Mantenemos `WELCOME_MESSAGE` (sin nombre) como alias para el chequeo de
 * anti-repetición y para call sites legacy.
 */
export function buildWelcomeMessage(contactName?: string | null): string {
  const first = firstNameForGreeting(contactName);
  const opener = first
    ? `¡Hola ${first}! Es un gusto saludarte. Te escribe Hernán de FincasYa.com 🏡✨`
    : `¡Hola! Es un gusto saludarte. Te escribe Hernán de FincasYa.com 🏡✨`;
  return `${opener}

Tenemos opciones espectaculares de fincas listas para ti 🤩 y quiero ayudarte a encontrar la ideal según tu plan.

Compárteme por favor:
📅 Fechas: entrada y salida
👨‍👩‍👧‍👦 Cupo: número de personas (desde los 2 años)
🏡 Tipo de grupo: familiar, amigos o empresarial
📍 Ubicación: municipio o zona de preferencia (si ya tienes una en mente)

Con esto te envío opciones disponibles, fotos, precios y promociones ajustadas a lo que buscas 🔥

Estoy atento para ayudarte a reservar tu finca perfecta ✨
`;
}

/** Alias genérico (sin nombre). Usado para chequeos de anti-repetición. */
export const WELCOME_MESSAGE = buildWelcomeMessage();

/**
 * Saludo corto que se prepende al "first turn has content" (cuando el cliente
 * dio datos útiles en su primer mensaje y saltamos el welcome largo).
 */
export function buildShortGreeting(contactName?: string | null): string {
  const first = firstNameForGreeting(contactName);
  return first
    ? `🙋‍♂️ ¡Hola ${first}! Te saluda *Hernán* de FincasYa.com.`
    : `🙋‍♂️ ¡Hola! Te saluda *Hernán* de FincasYa.com.`;
}

/** Pregunta específica según qué campo falta. */
export function missingFieldQuestion(
  field: keyof BotEntities,
  entities: BotEntities,
): string {
  switch (field) {
    case "location":
      return "¿A qué municipio o zona de Colombia quieres ir? (Melgar, Girardot, Anapoima, etc.) Si no tienes preferencia, te recomiendo yo 😊";
    case "checkIn":
      return "¿Qué fechas tienes en mente? Dime la fecha de *entrada* y *salida* 📅";
    case "checkOut":
      return `Ya tengo tu fecha de entrada (${entities.checkIn}). ¿Y cuándo sería la salida? 📅`;
    case "cupo":
      return "¿Cuántas personas van en total? (niños de 2 años en adelante cuentan) 👨‍👩‍👧‍👦";
    case "planType":
      return "¿Su plan es *familiar*, con *amigos* o *empresarial*? (Así te muestro fincas que mejor encajan) 👨‍👩‍👧‍👦";
    case "isEvento":
      return "¿Van *solo de descanso* o también tendrán *evento o celebración* en la finca? (cumpleaños, fiesta, reunión, etc.) 🎉";
    case "eventPeopleCount":
      return "Cuéntame del evento: ¿*cuántas personas en total* van? (Las que se quedan a dormir + las que van solo por el día/pasadía) 🎉👥";
    case "eventLogistics":
      return [
        "Para el evento, ¿qué tipo de logística vas a tener? 🎵",
        "",
        "🎧 *Sonido profesional / DJ / iluminación*",
        "🎸 *Banda en vivo* o grupos musicales (mariachis, etc.)",
        "🏡 O solo el *sonido básico de la finca* (departir tranquilos)",
        "",
        "Dime cuál opción es la que aplica 🤝",
      ].join("\n");
    default:
      return "¿Puedes completar el dato que me falta para buscarte las mejores fincas? 😊";
  }
}

export function datesIncoherentMessage(entities: BotEntities): string {
  return `Parece que la fecha de salida (${entities.checkOut}) es antes de la de entrada (${entities.checkIn}) 😅 ¿Me confirmas las fechas correctas?`;
}

/** Texto breve ANTES de enviar el catálogo (sin repetir fechas, cupo ni municipio).
 *  Va seguido de las fichas reales de WhatsApp (catálogo interactivo), NO
 *  enumera ni inventa nombres de fincas: las tarjetas son la fuente de verdad. */
export function preCatalogText(_entities?: BotEntities): string {
  void _entities;
  return [
    "Te comparto las opciones disponibles 🏡✨",
    "",
    "💰 Cada tarjeta muestra el valor *por noche* en temporada actual.",
    "👉 Cuéntame *cuál te llama la atención* y te ayudo con la reserva 🤝",
  ].join("\n");
}

/** Pregunta de mascotas. */
export function petCheckMessage(propertyName: string): string {
  return `¡Excelente elección con *${propertyName}*! 🐾 Antes de continuar: ¿vas a llevar mascotas? (perros/gatos)

Ten en cuenta que la mayoría de fincas cobran un adicional por mascota y algunas no las permiten.`;
}

/**
 * Bloque oficial de respuesta rápida para mascotas.
 *
 * Se concatena en el paquete que se envía tras `pet_check` cuando el cliente
 * confirma que SÍ lleva mascotas (`hasPets === true`). Cuando dice que no
 * (`hasPets === false`), devuelve cadena vacía y el flujo sigue sin este bloque.
 *
 * **NO editar sin consultar con FincasYa** — está alineado con la respuesta
 * rápida oficial del equipo. Misma versión que `PET_RULES_KNOWLEDGE` (system)
 * y que el seed `faq:mascotas-politica` (RAG) para consistencia total.
 */
export function petFeesSummaryForQuote(entities: BotEntities): string {
  if (!entities.hasPets) return "";
  return [
    "✨🐶 Tus mascotas son bienvenidas en la mayoría de nuestras opciones de alojamiento 🐾",
    "",
    "💰 Depósito reembolsable: $100.000 por cada mascota.",
    "✅️ Tarifa de ingreso: $30.000 a partir de la 3ª mascota.",
    "",
    "🧹 Limpieza adicional: si viajas con 3 o más mascotas, se cobrará una tarifa de aseo de $70.000.",
    "",
    "📌 Recomendaciones importantes:",
    "• 🚫 No ingresar las mascotas a la piscina.",
    "• 🐾 Evitar orina o pelaje en zonas interiores.",
    "• 🛋️ No subirlas a muebles ni camas.",
    "• 🦴 Cuidar que no muerdan implementos de la casa.",
    "• 💩 Recoger sus necesidades constantemente.",
    "",
    "❗ Recuerda: el incumplimiento de estas recomendaciones puede generar descuentos en el depósito. Confiamos en tu especial cuidado para que disfrutes tu estadía al máximo junto a tus peluditos. 💚",
  ].join("\n");
}

/** Mensaje de cotización. */
export function quoteMessage(
  entities: BotEntities,
  pricePerNight: number,
  season: string,
): string {
  const noches = countNights(entities.checkIn!, entities.checkOut!);
  const totalAlojamiento = pricePerNight * noches;
  const petExtra = entities.hasPets
    ? (entities.petCount ?? 1) * 80_000 * noches
    : 0;
  const total = totalAlojamiento + petExtra;

  const fmt = (n: number) =>
    new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(n);

  return [
    `🏡 *${entities.selectedPropertyName}*`,
    `📅 ${entities.checkIn} → ${entities.checkOut} (${noches} ${noches === 1 ? "noche" : "noches"})`,
    `👥 ${entities.cupo} personas | Temporada: ${season}`,
    `💰 ${fmt(pricePerNight)}/noche × ${noches} = *${fmt(totalAlojamiento)}*`,
    entities.hasPets
      ? `🐾 Adicional mascotas: ${fmt(80_000)}/mascota/noche × ${entities.petCount ?? 1} × ${noches} = ${fmt(petExtra)}`
      : "",
    `━━━━━━━━━━━━━━━━━━━`,
    `*Total: ${fmt(total)}*`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Mensaje solicitando datos del contrato. */
export const CONTRACT_REQUEST_MESSAGE = `¡Excelente elección! ✨ Para formalizar tu *contrato de arrendamiento* y asegurar la fecha, necesito los datos de quien firmará como responsable:

📋 *Datos necesarios*
• Nombre completo
• Cédula: número, ciudad de expedición y foto del frente
• Correo electrónico
• Teléfono de contacto
• Dirección de residencia

🔐 *Proceso*
1. Te enviamos el contrato para revisión 📄
2. Realizas el abono del *50%* para separar la fecha 💰
3. Recibes el soporte oficial con ubicación y detalles 📍

🛡️ RNT *163658* — tu reserva va con respaldo legal en FincasYa.com 🤝✨`;

// ─────────────────────────────────────────────────────────────────────────────
// Prompts de sistema para respuestas generadas con LLM
// ─────────────────────────────────────────────────────────────────────────────

/** System prompt para respuestas en fase `collecting` (aclaraciones, ambigüedades). */
export function collectingSystemPrompt(entities: BotEntities, missingField?: keyof BotEntities): string {
  return [
    IDENTITY,
    "",
    GLOBAL_RULES,
    "",
    "FASE ACTUAL: Recolectando datos para buscar fincas.",
    missingField
      ? `DATO QUE FALTA: ${missingField}. Tu respuesta debe pedir SOLO ese dato, de forma natural.`
      : "Ya tienes todos los datos. Confirma al cliente que vas a buscarle las fincas.",
    "",
    "Datos ya recolectados:",
    JSON.stringify(entities, null, 2),
    "",
    "PROHIBIDO: mencionar municipios técnicos, IDs, o campos JSON.",
  ].join("\n");
}

/** System prompt para respuestas en fase `catalog_sent`. */
export const CATALOG_SENT_SYSTEM = [
  IDENTITY,
  "",
  GLOBAL_RULES,
  "",
  "FASE ACTUAL: El catálogo de fincas ya fue enviado.",
  "El cliente debe elegir una finca. Si pregunta por detalles de una opción, responde breve y concreto.",
  "PROHIBIDO: preguntar si quiere ayuda con la reserva o si quiere continuar cuando ya mostró interés por una finca o ya dio fechas: es redundante.",
  "No envíes el catálogo de nuevo.",
].join("\n");

/** System prompt para fase `contract`. */
export function contractSystemPrompt(entities: BotEntities): string {
  const missing = contractMissingFields(entities);
  return [
    IDENTITY,
    "",
    GLOBAL_RULES,
    "",
    "FASE ACTUAL: Recolectando datos del contrato.",
    missing.length > 0
      ? `Datos que aún faltan: ${missing.join(", ")}. Pídelos de forma amable, uno por uno si es posible.`
      : "Ya tienes todos los datos del contrato. Agradece y confirma que procesarás la reserva.",
    "",
    "Datos del contrato recolectados hasta ahora:",
    JSON.stringify(
      {
        nombre: entities.contractName,
        cedula: entities.contractCedula,
        email: entities.contractEmail,
        telefono: entities.contractPhone,
        direccion: entities.contractAddress,
      },
      null,
      2,
    ),
  ].join("\n");
}

function contractMissingFields(e: BotEntities): string[] {
  const fields: string[] = [];
  if (!e.contractName) fields.push("nombre completo");
  if (!e.contractCedula) fields.push("cédula (número + ciudad de expedición + foto)");
  if (!e.contractEmail) fields.push("correo electrónico");
  if (!e.contractPhone && !e.contractAddress) fields.push("teléfono o dirección");
  return fields;
}
