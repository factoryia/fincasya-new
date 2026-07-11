/**
 * Bot v2 — Prompts modulares por fase.
 *
 * Cada sección es una función que devuelve un string.
 * El orquestador los concatena según la fase actual.
 * Nada de esto vive en la BD ni es editable desde el frontend.
 */

import type { BotEntities, BotPhase, ConversationTagFlags } from './types';
import { countNights, normalizePlanType } from './entities';
import { WELCOME_BUSINESS_HOURS_BLOCK } from '../businessHours';

/**
 * Cuando faltan 2+ campos simultáneamente, agrupa las preguntas en UN solo mensaje.
 * Si solo falta uno, devuelve null (usar `missingFieldQuestion`).
 */
export function missingFieldsBundle(e: BotEntities): string | null {
  const missing: string[] = [];

  if (!e.location)
    missing.push('📍 *Municipio o zona* de preferencia (o te recomiendo yo)');
  if (!e.checkIn || !e.checkOut) missing.push('📅 *Fecha de entrada y salida*');
  if (e.cupo === undefined || e.cupo <= 0)
    missing.push('👥 *Cuántas personas* van en total');
  if (!normalizePlanType(e.planType))
    missing.push('🏡 *Tipo de grupo*: familiar, amigos o empresarial');
  if (e.isEvento === undefined)
    missing.push('🎉 ¿*Solo descanso* o habrá evento/celebración?');

  if (missing.length <= 1) return null;
  return `Para mostrarte las mejores opciones me faltan algunos datos 😊\n\n${missing.map((m) => `• ${m}`).join('\n')}`;
}

/**
 * Lista LEGIBLE (frases naturales) de los datos que aún faltan. La usa el LLM
 * para pedir esos datos con el TONO del equipo (en vez del bloque estático de
 * viñetas). El FSM sigue decidiendo QUÉ falta; esto solo describe los campos.
 */
export function missingFieldsHuman(e: BotEntities): string[] {
  const out: string[] = [];
  if (!e.location)
    out.push(
      'a qué municipio o zona quieren ir (o si prefieren que tú les recomiendes)',
    );
  if (!e.checkIn || !e.checkOut) out.push('las fechas de entrada y salida');
  if (e.cupo === undefined || e.cupo <= 0)
    out.push('cuántas personas van en total');
  if (!normalizePlanType(e.planType))
    out.push('si el plan es familiar, con amigos o empresarial');
  if (e.isEvento === undefined)
    out.push('si es solo descanso o si habrá un evento o celebración');
  if (e.isEvento === true) {
    if (e.eventPeopleCount === undefined || e.eventPeopleCount <= 0)
      out.push('cuántas personas van al evento (dormir + pasadía)');
    if (!e.eventLogistics)
      out.push(
        'la logística del evento (sonido/DJ, banda en vivo, o solo el sonido básico de la finca)',
      );
  }
  return out;
}

/** Lista keys de los campos del catálogo que aún faltan, en orden. */
function listMissingCatalogFields(e: BotEntities): Array<keyof BotEntities> {
  const out: Array<keyof BotEntities> = [];
  if (!e.location) out.push('location');
  if (!e.checkIn) out.push('checkIn');
  if (!e.checkOut) out.push('checkOut');
  if (e.cupo === undefined || e.cupo <= 0) out.push('cupo');
  if (!normalizePlanType(e.planType)) out.push('planType');
  if (e.isEvento === undefined) out.push('isEvento');
  if (e.isEvento === true) {
    if (e.eventPeopleCount === undefined || e.eventPeopleCount <= 0)
      out.push('eventPeopleCount');
    if (!e.eventLogistics) out.push('eventLogistics');
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
  const datesMissing =
    missing.includes('checkIn') || missing.includes('checkOut');
  const slotKeys = new Set<string>(
    missing.filter((m) => m !== 'checkIn' && m !== 'checkOut'),
  );
  if (datesMissing) slotKeys.add('dates');

  if (slotKeys.size !== 2) return null;

  const has = (k: string) => slotKeys.has(k);

  // planType + isEvento (los 2 últimos)
  if (has('planType') && has('isEvento')) {
    return (
      `¿Van en plan *familiar*, con *amigos* o *empresarial*? ` +
      `Y cuéntame: ¿es *solo descanso* o también con *evento/celebración* en la finca? 🏡🎉`
    );
  }

  // eventPeopleCount + eventLogistics (cuando el cliente confirma evento por primera vez)
  if (has('eventPeopleCount') && has('eventLogistics')) {
    return [
      '¡Genial, evento confirmado! 🎉 Para enviarte las mejores opciones necesito un par de datos:',
      '',
      '👥 *Personas*: ¿cuántas van en total? (Dormir + pasadía)',
      '',
      '🎵 *Logística*: ¿llevarás algo de esto?',
      '  🎧 Sonido profesional / DJ / iluminación',
      '  🎸 Banda en vivo o grupos musicales (mariachis, etc.)',
      '  🏡 O solo el sonido básico de la finca',
      '',
      'Cuéntame y te comparto las opciones disponibles 🤝',
    ].join('\n');
  }

  // cupo + planType
  if (has('cupo') && has('planType')) {
    return (
      `¿Cuántas *personas* van en total? ` +
      `Y cuéntanos: ¿van en plan *familiar*, con *amigos* o *empresarial*? 👥🏡`
    );
  }

  // cupo + isEvento
  if (has('cupo') && has('isEvento')) {
    return (
      `¿Cuántas *personas* van en total? ` +
      `Y cuéntanos: ¿es *solo descanso* o también con *evento/celebración*? 👥🎉`
    );
  }

  // location + planType
  if (has('location') && has('planType')) {
    return (
      `¿A qué *municipio o zona* quieren ir? (o te recomiendo yo). ` +
      `Y cuéntame: ¿el plan es *familiar*, con *amigos* o *empresarial*? 📍🏡`
    );
  }

  // location + isEvento
  if (has('location') && has('isEvento')) {
    return (
      `¿A qué *municipio o zona* quieren ir? (o te recomiendo yo). ` +
      `Y cuéntame: ¿es *solo descanso* o también con *evento/celebración*? 📍🎉`
    );
  }

  // location + dates
  if (has('location') && has('dates')) {
    return (
      `¿A qué *municipio o zona* quieren ir? (o te recomiendo yo). ` +
      `Y cuéntame: ¿qué *fechas* tienes en mente (entrada y salida)? 📍📅`
    );
  }

  // dates + cupo
  if (has('dates') && has('cupo')) {
    return (
      `¿Qué *fechas* tienes en mente (entrada y salida)? ` +
      `Y cuéntame: ¿cuántas *personas* van en total? 📅👥`
    );
  }

  // dates + planType
  if (has('dates') && has('planType')) {
    return (
      `¿Qué *fechas* tienes en mente (entrada y salida)? ` +
      `Y cuéntame: ¿el plan es *familiar*, con *amigos* o *empresarial*? 📅🏡`
    );
  }

  // dates + isEvento
  if (has('dates') && has('isEvento')) {
    return (
      `¿Qué *fechas* tienes en mente (entrada y salida)? ` +
      `Y cuéntame: ¿es *solo descanso* o también con *evento/celebración*? 📅🎉`
    );
  }

  return null;
}

/** Fragmentos muy cortos o poco claros (después del saludo inicial). */
export function isVagueShortMessage(raw: string): boolean {
  const t = String(raw ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');

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
  const [y, m, d] = iso.trim().slice(0, 10).split('-');
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
    return lines.filter(Boolean).join('\n');
  }

  const di = formatYmdForDisplay(entities.checkIn);
  const doOut = formatYmdForDisplay(entities.checkOut);
  if (di && doOut) lines.push(`📅 Entrada ${di}, salida ${doOut}`);
  else if (di) lines.push(`📅 Entrada ${di} (confirmemos salida si falta)`);
  else lines.push(`📅 Fechas: aún pendientes`);

  if (entities.cupo !== undefined)
    lines.push(`👥 Cupo: *${entities.cupo} personas*`);
  else lines.push(`👥 Cupo: pendiente`);

  if (entities.location) {
    const locLabel =
      entities.location === 'RECOMENDADAS'
        ? 'recomendadas por nosotros'
        : entities.location;
    lines.push(`📍 Municipio/zona: *${locLabel}*`);
  } else lines.push(`📍 Municipio/zona: pendiente`);

  if (entities.planType) lines.push(`👨‍👩‍👧‍👦 Tipo de grupo: *${entities.planType}*`);
  else
    lines.push(`👨‍👩‍👧‍👦 Tipo de grupo (familiar / amigos / empresarial): pendiente`);

  if (entities.isEvento !== undefined)
    lines.push(
      entities.isEvento
        ? `🎉 Con evento o celebración`
        : `🏖️ Solo descanso (sin evento)`,
    );
  else lines.push(`🎉 ¿Solo descanso o con evento/celebración?: pendiente`);

  lines.push('');
  const ask =
    missingField === 'location'
      ? `Para validar *opciones reales disponibles*, dime el municipio o si prefieres que te sugiera zonas 😉`
      : missingField === 'checkIn'
        ? `¿Me confirmas las *fechas de entrada y salida*? 📅`
        : missingField === 'checkOut'
          ? `¿Cuál sería tu *fecha de salida*? 📅`
          : missingField === 'cupo'
            ? `¿Cuántas *personas* van en total? 👨‍👩‍👧‍👦`
            : missingField === 'planType'
              ? `¿Van en plan *familiar*, con *amigos* o es un grupo *empresarial*? 👨‍👩‍👧‍👦`
              : missingField === 'isEvento'
                ? `¿Van *solo de descanso* o también *evento/celebración* en la finca? 🎊`
                : `¿Puedes *confirmar todo lo de arriba* o indicarme qué falta cambiar? ✨`;

  lines.push(ask);

  return lines.join('\n');
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
Eres el asistente virtual de FincasYa.com — plataforma de alquiler de fincas y casas campestres en Colombia.
NO te presentes con un nombre de persona (no eres "Hernán" ni otro humano); eres el asistente virtual del equipo.
Tono: cercano, cálido y cordial — usa frases como "es un gusto atenderte", "con mucho gusto", "es un placer ayudarte". Nunca seco, frío ni robótico.
Idioma: español colombiano.
Antes de dar una política o restricción, reconoce brevemente lo que el cliente expresó o su situación.
Si hay una limitación, explícala con empatía y ofrece alternativa cuando exista.
Nunca inventes precios ni información técnica que no tengas en el contexto.
`.trim();

/** @deprecated Usar IDENTITY — web y WhatsApp comparten la misma identidad de asistente virtual. */
export const IDENTITY_WEB = IDENTITY;

/** Devuelve la identidad del asistente virtual (igual en web y WhatsApp). */
export function identityForChannel(_channel?: 'whatsapp' | 'web'): string {
  return IDENTITY;
}

export const GLOBAL_RULES = `
REGLAS GLOBALES:
- Sé breve pero humano: 2-4 líneas salvo que el cliente pida detalles.
- Primero demuestra que entendiste lo que el cliente acaba de decir; luego responde o pide el dato.
- Si hay restricción (mínimo de noches, temporada, cupo, etc.), muestra empatía antes de la política y ofrece alternativa si existe.
- No repitas saludos si ya saludaste antes en esta conversación.
- No repitas preguntas que el cliente ya respondió.
- No menciones campos técnicos como "isEvento", "checkIn", "cupo".
- Si el cliente pregunta algo fuera de tema (fútbol, política, etc.), redirige amablemente.
- Nunca muestres JSON, IDs internos, ni términos técnicos al cliente.
- Usa emojis para dar vida al mensaje: acompaña cada punto importante con su emoji relevante (📅, 👥, 💰, ✅, 🏡, 🐕, etc.). No exageres en líneas de texto corrido, pero en listas y secciones SÍ usa un emoji por ítem.
- El equipo de FincasYa son EXPERTOS, no "asesores". NUNCA uses la palabra "asesor" con el cliente: di "experto", "nuestro equipo de expertos" o "el equipo".
- TRATO AL CLIENTE (OBLIGATORIO, en TODOS los mensajes): cuando menciones al cliente por nombre, usa "señor" o "señora" + nombre completo (ej: "señor Juan Pérez", "señora María Gómez"). PROHIBIDO el nombre pelado ("Camilo", "María", "Juan"). SIEMPRE anteponer señor/señora. Cordialidad constante: "es un gusto ayudarlo", "con mucho gusto", "con respeto".
- TRATO CERCANO (TUTEO): háblale al cliente de TÚ, como nuestro equipo real. Ej.: "te comparto", "cuéntame qué fechas tienes", "tu plan", "te ayudamos", "quedamos atentos 🙏". NUNCA de usted: nada de "le ayudo", "su plan", "compártame", "cuéntanos", "¿qué fechas tiene?".
- CORDIALIDAD (OBLIGATORIO): responde siempre con calidez humana. Usa frases como "es un gusto atenderte", "con mucho gusto", "es un placer ayudarte", "¡qué bueno que nos escribes!". NO empieces solo con "Claro", "Ok" o "Listo" — combínalo con calidez: "¡Claro que sí! Es un gusto atenderte…". Nunca suenes seco ni mecánico.
- IDENTIDAD: eres el *asistente virtual* de FincasYa. NUNCA digas que te llamas Hernán ni te presentes como una persona humana del equipo.
- NO abras tus mensajes con "Gracias por la info", "Gracias por confirmar" ni agradecimientos de relleno — el equipo NO da las gracias en cada turno. Entra directo a lo útil (confirma lo entendido o responde). Reserva el "gracias" para cuando el cliente de verdad agradece o al cerrar.
- Habla como EQUIPO de FincasYa (nosotros): "te ayudamos", "te enviamos", "te recomendamos", "quedamos atentos", "tenemos", "manejamos". La 1ª persona ("te comparto") también es natural. Lo esencial: SIEMPRE tuteando al cliente.
`.trim();

/**
 * Conocimiento canónico sobre mascotas (política, cargos y reglas de convivencia).
 * Es info verificada — el bot SÍ puede responder con esto cuando el cliente pregunte
 * (no debe decir "déjame confirmarlo con un experto" para temas listados aquí).
 *
 * Source: copy oficial validado por Santiago/FincasYa (2026-05-08).
 */
export const PET_RULES_KNOWLEDGE = `
POLÍTICA Y REGLAS DE MASCOTAS (info verificada — RESPONDER usando estos datos):

✨🐶 Tus mascotas son bienvenidas en la mayoría de nuestras propiedades. Para garantizar una excelente estancia, ten en cuenta las siguientes condiciones: 🐾

CARGOS:
💰 Depósito reembolsable: $100.000 por cada mascota 🐕
✅️ Tarifas adicionales: A partir de la 3ª mascota, tarifa de ingreso de $30.000 por cada una.
🧹 Limpieza adicional: si viaja con 3 o más mascotas, $70.000 (cargo único de aseo).

📌 RECOMENDACIONES IMPORTANTES:
• 🚫 No ingresar las mascotas a la piscina.
• 🐾 Evitar orina o pelaje en zonas interiores.
• 🛋️ No subirlas a muebles ni camas.
• 🦴 Cuidar que no muerdan implementos de la casa.
• 💩 Recoger sus necesidades constantemente.

❗El incumplimiento de estas normas puede generar descuentos en el depósito de garantía.

INSTRUCCIONES PARA EL ASISTENTE AL HABLAR DE MASCOTAS:
- Si el cliente pregunta si su mascota PUEDE hacer X (entrar a la piscina, subir a muebles, etc.),
  responde con la regla concreta de arriba — NO digas "déjame confirmarlo".
- Si pregunta cuánto cuesta, cita los valores exactos. NO redondees ni inventes.
- Si pregunta algo NO listado (tamaño máximo, raza específica, paseo, comida, etc.),
  ahí sí responde "Déjame confirmarlo con nuestro equipo para no darte un dato incorrecto 😊"
- Usa el formato con emojis de arriba al responder. Sé cálido y breve.
`.trim();

/**
 * Reglas anti-alucinación: el bot NUNCA debe inventar datos.
 * Se inyectan en todos los system prompts del LLM.
 */
export const ANTI_HALLUCINATION_RULES = `
REGLAS ANTI-INVENCIÓN (CRÍTICAS):
- NO inventes precios. Solo cita precios que aparecen explícitos en este contexto. NO calcules abonos / porcentajes / cuotas inventadas (ej. "50% del total = $X"); si el cliente pregunta cómo se paga, di literalmente: "Déjame confirmarlo con un experto para no darte un dato incorrecto." Sin hacer cálculos.
- NO inventes ubicación exacta de la finca. Solo confirma municipio. La dirección exacta se entrega después de firmar contrato y abonar 50%.
- NO prometas servicios (jacuzzi, BBQ, internet, transporte, parqueadero, etc.) si no aparecen explícitamente en este contexto.
- NO inventes capacidad, número de habitaciones, baños, ni cualquier detalle de la finca que no esté listado abajo.
- NO listes ni numeres fincas usando nombres genéricos como "Finca A", "Finca B", "Opción 1", "Opción 2", etc. Las fichas reales del catálogo viajan por WhatsApp como tarjetas interactivas — el cliente las ve aparte. JAMÁS escribas una lista enumerada de fincas en texto.
- Si el cliente pregunta algo cuya respuesta NO está en este contexto, responde literalmente: "Déjame confirmarlo con un experto para darte el dato correcto, un momento por favor 🤝" y NADA más. El sistema se encarga de pasar la conversación al experto automáticamente; NO sigas con el flujo después de esa frase, porque la conversación queda en humano y agregar más texto confunde al cliente.
- NO reenvíes bloques largos que ya enviamos en mensajes anteriores. Si el cliente solo saluda o no responde el dato pedido, reformula brevemente la pregunta puntual del dato que falta — máximo 2 líneas.
- NO digas "un momento", "déjame revisar", "te respondo en breve", "voy a procesar". El bot solo responde cuando el cliente escribe; si dices que harás algo después, el cliente queda esperando.
- NO prometas enviar nada (catálogo, contrato, fotos) más tarde. Si lo necesitas ahora, pídelo en el mismo mensaje.
- **NUNCA preguntes permiso para hacer cosas que el cliente ya pidió implícitamente.** Frases prohibidas: "¿Quieres que te explique cómo seguimos?", "¿Quieres que te envíe los datos?", "¿Quieres que te explique cómo hacer X?". Si el cliente está en fase de contrato y faltan sus datos, PIDE LOS DATOS DIRECTAMENTE (nombre, cédula, email, teléfono, dirección). Si ya entregó algunos, pide solo los que faltan. Sin chains de "¿quieres?".
- **No bucles de confirmación.** Si el cliente dice "sí" / "ok" / "dale" a tu pregunta anterior, EJECUTA lo prometido en ese mensaje (entregar info concreta, pedir datos puntuales). NO respondas con otra "¿quieres…?".
- Tono cálido, breve, en español colombiano.
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
// Resumen humano-legible de las entidades (para inyectar en el system del LLM).
// ─────────────────────────────────────────────────────────────────────────────

function fmtYmd(iso?: string): string | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso.trim())) return null;
  const [y, m, d] = iso.trim().slice(0, 10).split('-');
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
      `- Municipio/zona: ${e.location === 'RECOMENDADAS' ? 'sin preferencia (recomendar)' : e.location}`,
    );
  if (e.planType) lines.push(`- Tipo de grupo: ${e.planType}`);
  if (e.isEvento !== undefined)
    lines.push(
      `- Plan: ${e.isEvento ? 'evento/celebración' : 'solo descanso'}`,
    );
  if (e.isEvento === true && e.eventPeopleCount !== undefined)
    lines.push(`- Personas del evento (total): ${e.eventPeopleCount}`);
  if (e.isEvento === true && e.eventLogistics)
    lines.push(
      `- Logística del evento: ${e.eventLogistics === 'extra' ? 'lleva sonido pro / banda / DJ' : 'solo sonido básico de la finca'}`,
    );
  if (e.selectedPropertyName)
    lines.push(`- Finca elegida: ${e.selectedPropertyName}`);
  if (e.hasPets !== undefined) {
    if (e.hasPets) lines.push(`- Mascotas: sí (${e.petCount ?? 1})`);
    else lines.push(`- Mascotas: no`);
  }
  if (e.contractName) lines.push(`- Nombre: ${e.contractName}`);
  if (e.contractCedula) lines.push(`- Cédula: ${e.contractCedula}`);
  if (e.contractEmail) lines.push(`- Correo: ${e.contractEmail}`);
  if (e.contractPhone) lines.push(`- Teléfono: ${e.contractPhone}`);
  if (e.contractAddress) lines.push(`- Dirección: ${e.contractAddress}`);
  return lines.join('\n');
}

/** Texto del dato puntual que está faltando para avanzar el FSM. */
function nextStepHint(phase: BotPhase, e: BotEntities): string {
  if (phase === 'welcome' || phase === 'collecting') {
    if (!e.location) return 'Falta el municipio (o decir que recomendamos).';
    if (!e.checkIn || !e.checkOut)
      return 'Faltan las fechas de entrada y salida.';
    if (e.cupo === undefined || e.cupo <= 0)
      return 'Falta cuántas personas van.';
    if (!e.planType)
      return 'Falta el tipo de grupo (familiar/amigos/empresarial).';
    if (e.isEvento === undefined)
      return 'Falta saber si es solo descanso o con evento.';
    if (
      e.isEvento === true &&
      (e.eventPeopleCount === undefined || e.eventPeopleCount <= 0)
    )
      return 'Falta cuántas personas van al evento (dormir + pasadía).';
    if (e.isEvento === true && !e.eventLogistics)
      return 'Falta la logística del evento (sonido pro/DJ, banda en vivo o solo sonido básico).';
    return 'Ya tenemos todos los datos: enviar catálogo en el siguiente turno.';
  }
  if (phase === 'catalog_sent') {
    return 'El catálogo ya se envió. El cliente debe elegir una finca de las opciones que recibió.';
  }
  if (phase === 'property_selected' || phase === 'pet_check') {
    if (e.hasPets === undefined)
      return 'Falta confirmar si lleva mascotas y cuántas.';
    if (e.hasPets === true && (e.petCount === undefined || e.petCount <= 0)) {
      return 'Falta saber cuántas mascotas.';
    }
    return 'Mascotas confirmadas; ahora mostramos las reglas y pedimos confirmación.';
  }
  if (phase === 'pet_rules_shown') {
    return 'Cliente vio las reglas de mascotas. Esperando que confirme para mostrar el resumen con totales.';
  }
  if (phase === 'contract') {
    const missing: string[] = [];
    if (!e.contractName) missing.push('nombre completo');
    if (!e.contractCedula)
      missing.push('cédula (número + ciudad de expedición + foto)');
    if (!e.contractEmail) missing.push('correo electrónico');
    if (!e.contractPhone && !e.contractAddress)
      missing.push('teléfono o dirección');
    if (missing.length === 0)
      return 'Datos completos: el contrato está listo para procesar.';
    return `Faltan estos datos del contrato: ${missing.join(', ')}.`;
  }
  if (phase === 'done')
    return 'Reserva en proceso, escalada a un experto humano.';
  return '';
}

const PHASE_GOAL: Record<BotPhase, string> = {
  welcome:
    'Saludar y empezar a recolectar datos para mostrar fincas disponibles.',
  collecting:
    'Recolectar municipio, fechas, personas, tipo de grupo y si hay evento.',
  catalog_sent:
    'El cliente debe elegir una de las fincas que recibió por catálogo.',
  property_selected: 'Confirmar mascotas para la finca elegida.',
  pet_check: 'Confirmar si lleva mascotas y cuántas.',
  pet_rules_shown:
    'Se mostraron las reglas de mascotas; esperar confirmación del cliente para mostrar el resumen con totales.',
  quote_shown:
    'Se mostró el resumen con el total; esperar confirmación del cliente para pedir los datos del contrato.',
  contract:
    'Recolectar nombre, cédula, correo, teléfono y dirección para el contrato.',
  done: 'Cliente entregó datos del contrato; esperando que un experto humano lo contacte.',
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
  /**
   * Ejemplos recuperados del PLAYBOOK DE TONO (`searchPlaybookForBot`). Se
   * inyectan como referencia de ESTILO few-shot: el modelo imita el tono, NO
   * copia texto literal, NO usa datos que aparezcan en ellos y NO cambia el
   * flujo por lo que digan.
   */
  playbookContext?: string | null;
  /**
   * Datos que aún faltan (frases legibles de `missingFieldsHuman`). Cuando
   * vienen, el system prompt le pide al LLM que PIDA esos datos con el tono del
   * equipo (en 1-2 frases naturales, NO como lista de viñetas). El FSM ya
   * decidió QUÉ falta; el LLM solo redacta el CÓMO.
   */
  collectingAsk?: string[] | null;
  /**
   * Etiquetas de negocio activas en el contacto. Cuando vienen, el system
   * prompt añade una sección "ETIQUETAS ACTIVAS" con instrucciones de tono
   * (VIP → personalizado, complicado → cauteloso, recurrente → como conocido).
   */
  tagFlags?: ConversationTagFlags;
  /** Canal (web o WhatsApp): misma identidad de asistente virtual. */
  channel?: 'whatsapp' | 'web';
  /** Si ya hubo saludo del bot en el hilo, no volver a saludar. */
  alreadyGreeted?: boolean;
  /** Nombre del contacto para personalizar el tono. */
  contactName?: string | null;
}

const GREETING_MARKERS =
  /asistente virtual de fincasya|es un gusto atenderte|es un gusto saludarte|soy tu \*?asistente virtual|soy el \*?asistente virtual|^¡?hola\b/i;

/** ¿El bot ya saludó en este hilo? */
export function hasBotGreetedInHistory(
  history: Array<{ role: string; content?: unknown }>,
): boolean {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m.role !== 'assistant') continue;
    const raw = m.content;
    const content =
      typeof raw === 'string'
        ? raw.trim()
        : Array.isArray(raw)
          ? raw
              .map((p) =>
                typeof p === 'object' && p && 'text' in p
                  ? String((p as { text?: string }).text ?? '')
                  : '',
              )
              .join(' ')
              .trim()
          : '';
    if (content && GREETING_MARKERS.test(content)) return true;
  }
  return false;
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
    identityForChannel(opts.channel),
    '',
    GLOBAL_RULES,
    '',
    ANTI_HALLUCINATION_RULES,
    '',
    'ESTADO ACTUAL DE LA CONVERSACIÓN:',
    `- Fase del proceso: ${phase}`,
    `- Objetivo de esta fase: ${PHASE_GOAL[phase] ?? ''}`,
  ];

  if (summary) {
    sections.push('', 'DATOS YA CONFIRMADOS POR EL CLIENTE:', summary);
  } else {
    sections.push('', 'DATOS YA CONFIRMADOS: ninguno todavía.');
  }

  if (hint) {
    sections.push('', `SIGUIENTE PASO: ${hint}`);
  }

  if (opts.propertyContext && opts.propertyContext.trim()) {
    sections.push(
      '',
      'DATOS VERIFICADOS DE LA FINCA SELECCIONADA:',
      opts.propertyContext.trim(),
    );
  }

  if (opts.stayQuoteBlock && opts.stayQuoteBlock.trim()) {
    sections.push('', 'COTIZACIÓN VIGENTE:', opts.stayQuoteBlock.trim());
  }

  if (opts.ragContext && opts.ragContext.trim()) {
    sections.push(
      '',
      'INFO VERIFICADA DESDE LA BASE DE CONOCIMIENTO (RAG) — RESPONDER usando estos fragmentos cuando el cliente pregunte sobre estos temas. NO inventar más allá de lo que dice aquí:',
      opts.ragContext.trim(),
    );
  }

  // EJEMPLOS DE TONO (few-shot recuperado del playbook). Enseñan CÓMO habla el
  // equipo, no QUÉ datos dar ni cómo mover el flujo — de ahí el marco explícito.
  if (opts.playbookContext && opts.playbookContext.trim()) {
    sections.push(
      '',
      'EJEMPLOS DE TONO DEL EQUIPO (few-shot) — imita el ESTILO, el registro y la calidez de estos ejemplos reales. Reglas: (1) NO copies su texto literal; (2) NO uses datos que aparezcan en ellos (precios, nombres, fechas, montos): esos salen solo de las secciones verificadas de arriba; (3) NO cambies el siguiente paso del flujo por lo que digan. Solo aprende CÓMO se dice:',
      opts.playbookContext.trim(),
    );
  }

  // PEDIR DATOS FALTANTES CON TONO: el FSM ya decidió QUÉ falta; aquí el LLM
  // redacta el CÓMO (cálido, sin viñetas). Reemplaza el bloque estático de
  // viñetas cuando el bot debe pedir datos en la fase de recolección.
  if (opts.collectingAsk && opts.collectingAsk.length > 0) {
    sections.push(
      '',
      'TU TAREA ESTE TURNO — PEDIR LOS DATOS QUE FALTAN, TUTEANDO y con el tono cálido del equipo.',
      'Datos que aún faltan para poder mostrar opciones al cliente: ' +
        opts.collectingAsk.join('; ') +
        '.',
      'FORMATO OBLIGATORIO (es WhatsApp — NUNCA un párrafo corrido; usa saltos de línea REALES entre cada dato):',
      '- Línea 1: saludo o reconocimiento cálido y breve.',
      '- Después, UNA LÍNEA APARTE por cada dato que falta, cada una empezando con su emoji: 📍 municipio/zona, 📅 fechas, 👥 personas, 🏡 tipo de plan (familiar/amigos/empresarial), 🎉 evento. JAMÁS pongas dos preguntas en el mismo renglón.',
      '- Última línea: invitación corta a que te cuente.',
      'Ejemplo del FORMATO (adapta el texto pero respeta EXACTAMENTE los saltos de línea):',
      '¡Es un gusto atenderte! Para mostrarte las mejores opciones cuéntame 😊\n📅 ¿Qué fechas tienes en mente (entrada y salida)?\n👥 ¿Cuántas personas van en total?\nCon eso te comparto de una las fincas ideales ✨',
      "- Que suene natural y humano, imitando el tono de los ejemplos de arriba si los hay. NO uses viñetas con '•', NO numeres (1. 2. 3.), NO enumeres fincas.",
      '- NO inventes datos ni des precios. NO vuelvas a pedir datos que ya conoces (ver el resumen de arriba).',
    );
  }

  // ETIQUETAS ACTIVAS DEL CONTACTO — ajustan tono / paciencia / presión de
  // cierre. Las etiquetas que implican handoff duro (cliente-grosero,
  // propietario, reserva-activa) ya las gestionó `inbound.ts`, por eso aquí
  // no aparecen.
  if (opts.tagFlags) {
    const tagLines: string[] = [];
    if (opts.tagFlags.isVip) {
      tagLines.push(
        '- *Cliente IMPORTANTE o ESPECIAL* → trátalo con prioridad: tono cálido y personalizado, evita frases genéricas, sé proactivo, dale el mejor servicio. Si ya tiene datos confirmados, no se los pidas otra vez.',
      );
    }
    if (opts.tagFlags.isDifficult) {
      tagLines.push(
        '- *Cliente COMPLICADO* → tono cauteloso. NO presiones el cierre. Deja más espacio entre preguntas, evita asumir respuestas, sé MUY explícito en confirmaciones ("¿confirmamos X?") antes de avanzar.',
      );
    }
    if (opts.tagFlags.isReturning) {
      tagLines.push(
        '- *Cliente RECURRENTE* → ya nos conoce. Salúdalo como conocido ("¡Hola otra vez!"); NO repitas información que ya te dieron en sesiones previas; si ya tienes contexto (finca, fechas) menciona que lo retomas desde ahí; ve directo al grano sin reexplicar nada.',
      );
    }
    if (tagLines.length > 0) {
      sections.push(
        '',
        'ETIQUETAS ACTIVAS DEL CONTACTO — AJUSTA TU COMPORTAMIENTO:',
        tagLines.join('\n'),
      );
    }
  }

  sections.push(
    '',
    'REGLAS DE NEGOCIO FIJAS (úsalas cuando el cliente pregunte):',
    '- Reserva: el cliente abona 50% para asegurar la fecha; el resto se paga según el contrato.',
    '- Respaldo legal: RNT 163658, FincasYa.com.',
    '- Ubicación exacta de la finca: solo se entrega después de firmar contrato y pagar el abono.',
    '- Fechas: se trabajan en formato día/mes/año en el chat.',
    '',
    PET_RULES_KNOWLEDGE,
    '',
    'INSTRUCCIONES PARA TU RESPUESTA:',
    '- Responde primero al mensaje del cliente (reconoce su situación o inquietud antes de la política).',
    '- Abre con calidez cuando corresponda: "Es un gusto atenderte", "Con mucho gusto", "Es un placer ayudarte" — nunca sueltes solo "Claro" o "Ok".',
    '- Cierra recordando brevemente el siguiente paso del proceso (lo de SIGUIENTE PASO de arriba), en una sola frase corta.',
    '- Máximo 3-4 líneas. Tono natural, cordial y profesional — no plantilla fría.',
    '- Si el cliente saluda o repite algo, NO reenvíes los bloques largos que ya enviamos antes; solo recuerda el siguiente paso de forma breve.',
    '- Si ya informaste que un experto atenderá o continuará el proceso, NO repitas esa idea en turnos siguientes; avanza con el flujo o responde solo lo que preguntó.',
    '- NUNCA uses frases como "aquí estoy para acompañarte mientras tu experto retoma" ni variantes si ya enviaste un acuse de espera en esta conversación.',
    '- Si el cliente está molesto o dice que no entendiste, reconoce su molestia con empatía antes de continuar.',
    '- NUNCA repitas textualmente un mensaje que ya enviaste en los últimos turnos; reformula con tus palabras.',
  );

  if (opts.alreadyGreeted) {
    sections.push(
      '- Ya saludaste a este cliente en esta conversación: NO vuelvas a decir hola ni te presentes de nuevo.',
    );
  }

  const formalName = formalSalutationName(
    opts.contactName,
    entities.clientGender,
  );
  if (formalName) {
    sections.push(
      `- El cliente se llama ${formalName}. SIEMPRE úsalo con "señor" o "señora" + nombre completo — NUNCA solo el primer nombre. PROHIBIDO el nombre pelado. Ejemplo correcto: "${formalName}, ¿qué fechas tienes?". Ejemplo INCORRECTO: "${firstNameForGreeting(opts.contactName)}, ¿qué fechas tienes?". Hazlo en TODOS tus mensajes, no solo en el saludo.`,
    );
  }

  if (stuck) {
    sections.push(
      '- ⚠️ El cliente lleva varios turnos sin avanzar. Sé MUY breve y pregunta SOLO el dato puntual que falta — UNA SOLA pregunta, máximo 1-2 líneas. PROHIBIDO mencionar expertos, handoffs o decir que los conectarás con alguien: eso lo decide el sistema automáticamente si no hay avance.',
    );
  }

  return sections.join('\n');
}

/** Mensaje cuando se detecta bucle de repetición y se ofrece humano. */
export const LOOP_OFFER_HUMAN_MESSAGE = `Veo que estamos dando vueltas 🙏 ¿Prefieres que te conecte con un experto humano para terminar esto más rápido? Solo responde *sí* y te paso con alguien del equipo ✨`;

/**
 * Mensaje cuando el cliente declara más mascotas de las que el bot maneja
 * automáticamente (ver `MAX_PETS_AUTO_HANDLING` en `entities.ts`). El bot NO
 * calcula costo ni avanza al contrato: deja que un experto evalúe condiciones
 * especiales (aseo extra, finca con espacio suficiente, depósito ajustado).
 */
export function petsExceedLimitMessage(petCount: number): string {
  const n = Math.max(0, Math.floor(petCount));
  return [
    `Para *${n} mascota${n === 1 ? '' : 's'}* necesito que un experto te confirme las condiciones especiales 🤝`,
    '',
    'Nuestro bot maneja hasta *3 mascotas* automáticamente. Para grupos más grandes evaluamos caso por caso: aseo extra, disponibilidad de fincas con espacio suficiente, depósito ajustado, etc.',
    '',
    'Un experto te escribirá en breve para terminar tu reserva ✨',
  ].join('\n');
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
  if (phase === 'pet_check' || phase === 'property_selected') {
    if (entities.hasPets === undefined) {
      return `¿Me confirmas si llevas *mascotas* (y cuántas) o sin ellas? 🐾`;
    }
    if (
      entities.hasPets === true &&
      (entities.petCount === undefined || entities.petCount <= 0)
    ) {
      return `¿*Cuántas mascotas* en total? (Solo el número) 🐾`;
    }
    return `¿Avanzamos con los datos del contrato? 📋`;
  }

  // pet_rules_shown → esperando confirmación sí/no.
  if (phase === 'pet_rules_shown') {
    return `¿Estás de acuerdo con las condiciones de mascotas? Responde *sí* y te paso el resumen 🤝`;
  }

  // contract → recordar que faltan datos del contrato.
  if (phase === 'contract') {
    const missing: string[] = [];
    if (!entities.contractName) missing.push('nombre completo');
    if (!entities.contractCedula) missing.push('cédula');
    if (!entities.contractEmail) missing.push('correo');
    if (!entities.contractPhone && !entities.contractAddress)
      missing.push('teléfono o dirección');
    if (missing.length === 0) {
      return `¿Confirmamos para enviarte el contrato? ✨`;
    }
    if (missing.length === 1) {
      return `¿Me compartes tu *${missing[0]}* para avanzar con el contrato? 📋`;
    }
    return `¿Me compartes tus *datos del contrato* (${missing.join(', ')}) para terminar la reserva? 📋`;
  }

  // catalog_sent → ya enviamos catálogo, pedir elección.
  if (phase === 'catalog_sent') {
    return `¿Cuál de las opciones que te envié te llamó la atención? 🏡`;
  }

  // collecting / welcome → pedir el dato puntual que falta.
  if (phase === 'collecting' || phase === 'welcome') {
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
 * Nombre completo usable para saludar (title case). Si solo hay un nombre, se
 * usa ese. Descarta telefonos y basura.
 */
export function fullNameForGreeting(rawName?: string | null): string | null {
  const raw = String(rawName ?? '').trim();
  if (!raw) return null;
  if (/^[\d+\-\s()]+$/.test(raw)) return null;
  const cleaned = raw
    .replace(/[^\p{L}\p{N}\s'\-.]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return null;
  const words = cleaned.split(' ').filter((w) => w.length >= 2);
  if (words.length === 0) return null;
  const firstWord = words[0] ?? '';
  if (firstWord.length < 2 || firstWord.length > 30) return null;
  return words
    .map(
      (w) =>
        w.charAt(0).toLocaleUpperCase('es-CO') +
        w.slice(1).toLocaleLowerCase('es-CO'),
    )
    .join(' ');
}

/** Primer nombre (para heurística de género y compatibilidad). */
export function firstNameForGreeting(rawName?: string | null): string | null {
  const full = fullNameForGreeting(rawName);
  if (!full) return null;
  return full.split(' ')[0] ?? null;
}

/**
 * Heurística de género por terminación del primer nombre (es-CO): -o → hombre,
 * -a → mujer. Nombres ambiguos o atípicos → null.
 */
export function inferGenderFromFirstName(
  first: string,
): 'male' | 'female' | null {
  const f = first.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  const FEMALE = new Set([
    'isabel', 'raquel', 'maribel', 'flor', 'leidy', 'ingrid',
    'yeimmi', 'beatriz', 'luz', 'carmen', 'pilar', 'rocio',
  ]);
  const MALE = new Set([
    'camilo', 'garcia', 'nicolas', 'lucas', 'jonas', 'elias',
    'matias', 'tobias', 'josue', 'noe',
  ]);
  if (FEMALE.has(f)) return 'female';
  if (MALE.has(f)) return 'male';
  if (/[o]$/.test(f) || /(os|el|an|in|on)$/.test(f)) return 'male';
  if (/a$/.test(f)) return 'female';
  return null;
}

/**
 * Trato formal para saludo: "señor Juan Pérez" / "señora María Gómez".
 * SIEMPRE lleva título — nunca nombre pelado.
 */
export function formalSalutationName(
  contactName?: string | null,
  gender?: 'male' | 'female' | null,
): string | null {
  const fullName = fullNameForGreeting(contactName);
  if (!fullName) return null;
  const first = fullName.split(' ')[0] ?? '';
  const effective = gender ?? inferGenderFromFirstName(first);
  const title = effective === 'female' ? 'señora' : 'señor';
  return `${title} ${fullName}`;
}

/** @deprecated Usar formalSalutationName en saludos nuevos. */
export function respectfulGreetingName(
  contactName?: string | null,
  gender?: 'male' | 'female' | null,
): string | null {
  return formalSalutationName(contactName, gender);
}

const BOGOTA_TZ = 'America/Bogota';

type TimeSlot = 'morning' | 'afternoon' | 'night';

function getBogotaHour(now: Date = new Date()): number {
  return Number(
    now.toLocaleString('en-US', {
      timeZone: BOGOTA_TZ,
      hour: 'numeric',
      hour12: false,
    }),
  );
}

function getTimeSlot(hour: number): TimeSlot {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 19) return 'afternoon';
  return 'night';
}

/** Saludo según hora en Colombia: Buenos días / Buenas tardes / Buenas noches. */
export function timeOfDayGreeting(now: Date = new Date()): string {
  const slot = getTimeSlot(getBogotaHour(now));
  if (slot === 'morning') return 'Buenos días';
  if (slot === 'afternoon') return 'Buenas tardes';
  return 'Buenas noches';
}

function timeOfDayCourtesyPhrase(
  slot: TimeSlot,
  gender: 'male' | 'female' | null,
): string {
  if (slot === 'morning') {
    return 'gracias por comunicarse con nosotros. ¿En qué podemos ayudarle?';
  }
  if (slot === 'afternoon') {
    return gender === 'female'
      ? 'es un gusto atenderla.'
      : 'es un gusto atenderlo.';
  }
  return 'gracias por escribirnos. Estamos atentos para ayudarle.';
}

/**
 * Apertura oficial del saludo: "Hola, señor Juan Pérez. Buenos días, ..."
 */
export function buildGreetingOpener(
  contactName?: string | null,
  gender?: 'male' | 'female' | null,
  now: Date = new Date(),
): string {
  const hour = getBogotaHour(now);
  const slot = getTimeSlot(hour);
  const timeGreeting = timeOfDayGreeting(now);
  const fullName = fullNameForGreeting(contactName);
  const first = fullName?.split(' ')[0] ?? '';
  const effectiveGender = gender ?? (first ? inferGenderFromFirstName(first) : null);
  const courtesy = timeOfDayCourtesyPhrase(slot, effectiveGender);

  if (fullName) {
    const title = effectiveGender === 'female' ? 'señora' : 'señor';
    return `Hola, ${title} ${fullName}. ${timeGreeting}, ${courtesy}`;
  }
  return `Hola. ${timeGreeting}, ${courtesy}`;
}

/** Mensaje de bienvenida oficial (verbatim del equipo). */
export function buildWelcomeMessage(
  contactName?: string | null,
  _channel?: 'whatsapp' | 'web',
  gender?: 'male' | 'female' | null,
  now: Date = new Date(),
): string {
  const opener = buildGreetingOpener(contactName, gender, now);
  return `${opener}

En *FINCASYA.COM* ®️ 💻 te brindamos atención personalizada. Para agilizar tu proceso, indícanos por favor la siguiente información:

📅 Fecha probable de ingreso y salida
📍 Municipio o zona de preferencia (o con gusto te recomendamos)
👥 Número de personas entre adultos y niños
🫂 Si es grupo de familia, amigos o empresarial
🪅 Si es evento, fiesta familiar o reunión empresarial
🐕 Indícanos si traes mascotas y cuántas
📄 Si ya tienes un alquiler con nosotros, tu número de *(confirmación de reserva)*
🏡 Si eres propietario y deseas vincular tu propiedad para alquiler o venta${WELCOME_BUSINESS_HOURS_BLOCK}`;
}

/** Alias genérico (sin nombre). Usado para chequeos de anti-repetición. */
export const WELCOME_MESSAGE = buildWelcomeMessage();

/**
 * Saludo corto que se prepende al "first turn has content" (cuando el cliente
 * dio datos útiles en su primer mensaje y saltamos el welcome largo).
 */
export function buildShortGreeting(
  contactName?: string | null,
  _channel?: 'whatsapp' | 'web',
  gender?: 'male' | 'female' | null,
  now: Date = new Date(),
): string {
  return buildGreetingOpener(contactName, gender, now);
}

// ─────────────────────────────────────────────────────────────────────────────
// SALUDO GARANTIZADO POR CÓDIGO (portado de fincasya-prueba, copys.ts).
// Post-procesador determinista sobre el texto final del bot: si el cliente
// saludó en su mensaje y la respuesta no abre devolviendo el saludo, se le
// antepone el opener oficial con franja horaria. No depende del LLM.
// ─────────────────────────────────────────────────────────────────────────────

function normalizeGreetingText(text: string): string {
  return String(text ?? '')
    .trim()
    .replace(/^[¿¡\s]+/g, '')
    .replace(/[!?.…]+\s*$/gu, '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

const TIME_GREETING_RE =
  /^(buen[oa]s?\s*d[ií]as|buenas?\s*tardes|buenas?\s*noches)\b/;

const GREETINGS_RE =
  /^(hola|hoal|holaa+|buenas|buen\s*d[ií]a|buenos|hey|hi|hello|saludos|ola|holi)\W*$/i;

/** Mensaje que incluye un saludo (puro o compuesto: "hola buenos dias"). */
export function isGreetingMessage(text: string): boolean {
  const t = normalizeGreetingText(text);
  if (!t) return false;
  if (GREETINGS_RE.test(t)) return true;
  if (TIME_GREETING_RE.test(t)) return true;
  if (/^(hola|buenas|hey|hi|hello|saludos|ola|holi)\s+/.test(t)) {
    const rest = t.replace(/^(hola|buenas|hey|hi|hello|saludos|ola|holi)\s+/, '');
    if (GREETINGS_RE.test(rest) || TIME_GREETING_RE.test(rest)) return true;
  }
  return false;
}

/**
 * ¿La ráfaga del cliente contiene un saludo? El burst de `inbound.ts` llega
 * unido con '\n' (un mensaje por línea) — se evalúa cada línea por separado,
 * igual que prueba evalúa cada mensaje del burst.
 */
export function burstTextContainsGreeting(incomingText: string): boolean {
  return String(incomingText ?? '')
    .split('\n')
    .some((line) => isGreetingMessage(line));
}

/** Evita duplicar el saludo horario si la respuesta ya lo incluye. */
export function replyAlreadyOpensWithTimeGreeting(reply: string): boolean {
  const head = reply.slice(0, 160).toLowerCase();
  return (
    /buenos\s*d[ií]as|buenas\s*tardes|buenas\s*noches/.test(head) ||
    /^¡?hola,?\s+(señor|señora)/i.test(head)
  );
}

/** Quita un "Hola señor X" / "¡Hola!" generado por el LLM para no duplicar. */
export function stripRedundantHolaPrefix(reply: string): string {
  return reply
    .replace(/^¡?\s*hola,?\s+(don|doña|señor|señora)\s+[^!.\n]+[!.]?\s*/i, '')
    .replace(/^¡?\s*hola!?,?\s*/i, '')
    .trim();
}

/**
 * Antepone el saludo oficial con franja horaria si el cliente saludó en su
 * mensaje y la respuesta aún no lo devuelve. Aplicar SOLO a la primera
 * burbuja del turno.
 *
 * `llmSaysGreeted`: veredicto del extractor LLM (`clientGreeted`) — la IA
 * interpreta el saludo en cualquier forma ("holas", "q hubo", typos). El
 * regex `burstTextContainsGreeting` queda como red de seguridad si el LLM
 * no lo marcó (o falló).
 */
export function prependGreetingIfNeeded(
  reply: string,
  contactName?: string | null,
  incomingText: string = '',
  gender?: 'male' | 'female' | null,
  now: Date = new Date(),
  llmSaysGreeted?: boolean,
): string {
  const greeted =
    llmSaysGreeted === true || burstTextContainsGreeting(incomingText);
  if (!greeted) return reply;
  if (replyAlreadyOpensWithTimeGreeting(reply)) {
    return reply;
  }
  const opener = buildGreetingOpener(contactName, gender, now);
  const body = stripRedundantHolaPrefix(reply);
  return body ? `${opener}\n\n${body}` : opener;
}

/** Pregunta específica según qué campo falta. */
export function missingFieldQuestion(
  field: keyof BotEntities,
  entities: BotEntities,
): string {
  switch (field) {
    case 'location':
      return '¿A qué municipio o zona de Colombia quieres ir? (Melgar, Girardot, Anapoima, etc.) Si no tienes preferencia, te recomiendo yo 😊';
    case 'checkIn':
      return '¿Qué fechas tienes en mente? Dime la fecha de *entrada* y *salida* 📅';
    case 'checkOut':
      return [
        `Ya tengo tu fecha de entrada (${entities.checkIn}) 📅`,
        '',
        '¿Te quedas a *dormir*? Cuéntame la *fecha de salida* (o cuántas noches).',
        'Y si era un plan de *un solo día* sin pernoctar, también dímelo 🙌',
      ].join('\n');
    case 'cupo':
      return '¿Cuántas personas van en total? 👨‍👩‍👧‍👦';
    case 'planType':
      return '¿Su plan es *familiar*, con *amigos* o *empresarial*? (Así te muestro fincas que mejor encajan) 👨‍👩‍👧‍👦';
    case 'isEvento':
      return '¿Van *solo de descanso* o también tendrán *evento o celebración* en la finca? (cumpleaños, fiesta, reunión, etc.) 🎉';
    case 'eventPeopleCount':
      return 'Cuéntame del evento: ¿*cuántas personas en total* van? (Las que se quedan a dormir + las que van solo por el día/pasadía) 🎉👥';
    case 'eventLogistics':
      return [
        'Para el evento, ¿qué tipo de logística vas a tener? 🎵',
        '',
        '🎧 *Sonido profesional / DJ / iluminación*',
        '🎸 *Banda en vivo* o grupos musicales (mariachis, etc.)',
        '🏡 O solo el *sonido básico de la finca* (departir tranquilos)',
        '',
        'Dime cuál opción es la que aplica 🤝',
      ].join('\n');
    default:
      return '¿Puedes completar el dato que me falta para buscarte las mejores fincas? 😊';
  }
}

export function datesIncoherentMessage(entities: BotEntities): string {
  // Caso especial: misma fecha de entrada y salida ("del 15 al 15"). NO es
  // "salida antes de entrada" — el cliente puso el mismo día, normalmente
  // porque le faltó la fecha de salida o piensa en un plan de un solo día.
  // Decir "la salida es antes de la entrada" cuando son iguales confunde.
  if (
    entities.checkIn &&
    entities.checkOut &&
    entities.checkIn === entities.checkOut
  ) {
    return [
      `Veo que pusiste el *mismo día* de entrada y de salida (${entities.checkIn}) 😅`,
      '',
      'Para una reserva de hospedaje necesito al menos *una noche*. ¿Me confirmas la *fecha de salida*? (o dime cuántas noches te quedarías) 🗓️',
    ].join('\n');
  }
  return `Parece que la fecha de salida (${entities.checkOut}) es antes de la de entrada (${entities.checkIn}) 😅 ¿Me confirmas las fechas correctas?`;
}

/**
 * Copy oficial para cuando el cliente da una fecha de entrada que ya pasó O
 * es hoy mismo (no se acepta check-in el mismo día). Usar verbatim.
 */
export function datesInPastMessage(): string {
  return [
    'Claro 😊',
    'Las fechas que mencionas no están disponibles para reservar — la llegada debe ser *a partir de mañana* (no aceptamos ingresos el mismo día ni fechas pasadas).',
    '',
    'Por favor indícanos nuevas fechas de llegada y salida para ayudarte a revisar las opciones disponibles 🏡✨',
  ].join('\n');
}

/** Texto breve ANTES de enviar el catálogo (sin repetir fechas, cupo ni municipio).
 *  Va seguido de las fichas reales de WhatsApp (catálogo interactivo), NO
 *  enumera ni inventa nombres de fincas: las tarjetas son la fuente de verdad. */
export function preCatalogText(_entities?: BotEntities): string {
  void _entities;
  return [
    '¡Con mucho gusto! Estas son algunas de nuestras fincas para tus fechas 🏡✨',
    '',
    '💰 Los valores son *aproximados* por noche y pueden variar según la *temporada*.',
    '👉 Cuéntanos *cuál te llama la atención* y con gusto te ayudamos con la reserva 🤝',
  ].join('\n');
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
  if (!entities.hasPets) return '';
  return [
    '✨🐶 Tus mascotas son bienvenidas en la mayoría de nuestras opciones de alojamiento 🐾',
    '',
    '💰 Depósito reembolsable: $100.000 por cada mascota.',
    '✅️ Tarifa de ingreso: $30.000 a partir de la 3ª mascota.',
    '',
    '🧹 Limpieza adicional: si viajas con 3 o más mascotas, se cobrará una tarifa de aseo de $70.000.',
    '',
    '📌 Recomendaciones importantes:',
    '• 🚫 No ingresar las mascotas a la piscina.',
    '• 🐾 Evitar orina o pelaje en zonas interiores.',
    '• 🛋️ No subirlas a muebles ni camas.',
    '• 🦴 Cuidar que no muerdan implementos de la casa.',
    '• 💩 Recoger sus necesidades constantemente.',
    '',
    '❗ Recuerda: el incumplimiento de estas recomendaciones puede generar descuentos en el depósito. Confiamos en tu especial cuidado para que disfrutes tu estadía al máximo junto a tus peluditos. 💚',
  ].join('\n');
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
    new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    }).format(n);

  return [
    `🏡 *${entities.selectedPropertyName}*`,
    `📅 ${entities.checkIn} → ${entities.checkOut} (${noches} ${noches === 1 ? 'noche' : 'noches'})`,
    `👥 ${entities.cupo} personas | Temporada: ${season}`,
    `💰 ${fmt(pricePerNight)}/noche × ${noches} = *${fmt(totalAlojamiento)}*`,
    entities.hasPets
      ? `🐾 Adicional mascotas: ${fmt(80_000)}/mascota/noche × ${entities.petCount ?? 1} × ${noches} = ${fmt(petExtra)}`
      : '',
    `━━━━━━━━━━━━━━━━━━━`,
    `*Total: ${fmt(total)}*`,
  ]
    .filter(Boolean)
    .join('\n');
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
export function collectingSystemPrompt(
  entities: BotEntities,
  missingField?: keyof BotEntities,
): string {
  return [
    IDENTITY,
    '',
    GLOBAL_RULES,
    '',
    'FASE ACTUAL: Recolectando datos para buscar fincas.',
    missingField
      ? `DATO QUE FALTA: ${missingField}. Tu respuesta debe pedir SOLO ese dato, de forma natural, en 1-2 líneas. PROHIBIDO ABSOLUTAMENTE: mencionar expertos, decir "te conectamos con alguien", ofrecer handoffs o hablar de disponibilidad — eso viene después cuando ya tengas todos los datos.`
      : 'Ya tienes todos los datos. Confirma al cliente que vas a buscarle las fincas.',
    '',
    'Datos ya recolectados:',
    JSON.stringify(entities, null, 2),
    '',
    'PROHIBIDO: mencionar municipios técnicos, IDs, o campos JSON.',
  ].join('\n');
}

/** System prompt para respuestas en fase `catalog_sent`. */
export const CATALOG_SENT_SYSTEM = [
  IDENTITY,
  '',
  GLOBAL_RULES,
  '',
  'FASE ACTUAL: El catálogo de fincas ya fue enviado.',
  'El cliente debe elegir una finca. Si pregunta por detalles de una opción, responde breve y concreto.',
  'PROHIBIDO: preguntar si quiere ayuda con la reserva o si quiere continuar cuando ya mostró interés por una finca o ya dio fechas: es redundante.',
  'No envíes el catálogo de nuevo.',
].join('\n');

/** System prompt para fase `contract`. */
export function contractSystemPrompt(entities: BotEntities): string {
  const missing = contractMissingFields(entities);
  return [
    IDENTITY,
    '',
    GLOBAL_RULES,
    '',
    'FASE ACTUAL: Recolectando datos del contrato.',
    '',
    '🚫 PROHIBIDO ABSOLUTAMENTE EN ESTA FASE:',
    "- NO reenvíes el resumen / la cotización / el desglose de precios. El resumen ya se envió en la fase quote_shown como mensaje estructurado del bot. Si el cliente pide ver el resumen otra vez, responde **literalmente**: 'El resumen ya te lo compartí; el total exacto lo confirmamos al firmar el contrato 📋' y vuelve a pedir los datos del contrato que falten.",
    "- NO calcules nada numérico: alojamiento, depósito, tarifa, total, abono, 50%, IVA. Si el cliente pregunta '¿cuánto sería?' o '¿cuánto es el abono?', responde **literalmente**: 'El total exacto lo confirmamos en el contrato 📋' y NO inventes cifras.",
    "- NO escribas listas tipo 'Alojamiento 2 noches: $X', 'Depósito mascotas: $Y', 'Total: $Z'. Eso lo hizo el bot en su mensaje estructurado de quote_shown; tú **solo** pides datos del contrato.",
    "- NO menciones '50%', 'abono', 'porcentaje', 'cuota'.",
    '',
    missing.length > 0
      ? `Datos que aún faltan: ${missing.join(', ')}. Pídelos de forma amable, uno por uno si es posible. Si el cliente intenta desviarse al resumen / pago, retoma con los datos del contrato.`
      : 'Ya tienes todos los datos del contrato. Agradece y confirma que procesarás la reserva. NO menciones precios.',
    '',
    'Datos del contrato recolectados hasta ahora:',
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
  ].join('\n');
}

function contractMissingFields(e: BotEntities): string[] {
  const fields: string[] = [];
  if (!e.contractName) fields.push('nombre completo');
  if (!e.contractCedula)
    fields.push('cédula (número + ciudad de expedición + foto)');
  if (!e.contractEmail) fields.push('correo electrónico');
  if (!e.contractPhone && !e.contractAddress)
    fields.push('teléfono o dirección');
  return fields;
}
