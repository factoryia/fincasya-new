/**
 * Bot v2 — Prompts modulares por fase.
 *
 * Cada sección es una función que devuelve un string.
 * El orquestador los concatena según la fase actual.
 * Nada de esto vive en la BD ni es editable desde el frontend.
 */

import type { BotEntities } from "./types";
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

// ─────────────────────────────────────────────────────────────────────────────
// Mensajes estáticos (sin LLM)
// ─────────────────────────────────────────────────────────────────────────────

export const WELCOME_MESSAGE = `¡Hola! Es un gusto saludarte. Te escribe Hernán de FincasYa.com 🏡✨

Tenemos opciones espectaculares de fincas listas para ti 🤩 y quiero ayudarte a encontrar la ideal según tu plan.

Compárteme por favor:
📅 Fechas: entrada y salida
👨‍👩‍👧‍👦 Cupo: número de personas (desde los 2 años)
🏡 Tipo de grupo: familiar, amigos o empresarial
📍 Ubicación: municipio o zona de preferencia (si ya tienes una en mente)

Con esto te envío opciones disponibles, fotos, precios y promociones ajustadas a lo que buscas 🔥

Estoy atento para ayudarte a reservar tu finca perfecta ✨
`;

/** Pregunta específica según qué campo falta. */
export function missingFieldQuestion(
  field: keyof BotEntities,
  entities: BotEntities,
): string {
  switch (field) {
    case "location":
      return "¿A qué municipio o zona de Colombia quieres ir? (Melgar, Girardot, Fusagasugá, etc.) Si no tienes preferencia, te recomiendo yo 😊";
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
    default:
      return "¿Puedes completar el dato que me falta para buscarte las mejores fincas? 😊";
  }
}

export function datesIncoherentMessage(entities: BotEntities): string {
  return `Parece que la fecha de salida (${entities.checkOut}) es antes de la de entrada (${entities.checkIn}) 😅 ¿Me confirmas las fechas correctas?`;
}

/** Texto breve ANTES de enviar el catálogo (sin repetir fechas, cupo ni municipio). */
export function preCatalogText(_entities: BotEntities): string {
  return `Te comparto unas opciones 🏡 Cuéntame cuál te llama la atención 😉`;
}

/** Pregunta de mascotas. */
export function petCheckMessage(propertyName: string): string {
  return `¡Excelente elección con *${propertyName}*! 🐾 Antes de continuar: ¿vas a llevar mascotas? (perros/gatos)

Ten en cuenta que la mayoría de fincas cobran un adicional por mascota y algunas no las permiten.`;
}

/** Referencia de cargos por mascotas (política comercial) para el resumen tras elegir finca. */
export function petFeesSummaryForQuote(entities: BotEntities): string {
  if (!entities.hasPets) return "";
  const n = Math.max(1, entities.petCount ?? 1);
  const lines: string[] = [`🐾 *Mascotas (${n})* — referencia de cargos:`];
  lines.push(`• 1ª y 2ª: depósito reembolsable *$100.000* c/u`);
  if (n >= 3) {
    lines.push(`• Desde la 3ª: tarifa de ingreso *$30.000* c/u (no reembolsable)`);
    lines.push(`• Aseo adicional único (3 o más): *$70.000*`);
  }
  lines.push(`Los valores exactos van en tu contrato y confirmación de reserva 📄`);
  return lines.join("\n");
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
