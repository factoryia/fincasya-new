/**
 * Catálogo de plantillas WhatsApp (Meta) del flujo de check-in / llegadas-salidas.
 *
 * Cada momento del timeline de la semana (spec §3) es UNA plantilla preaprobada.
 * Aquí viven:
 *   1) la definición para REGISTRARLAS en YCloud/Meta (payload create), y
 *   2) el orden de variables `{{1}}`, `{{2}}`… para ENVIARLAS.
 *
 * El cuerpo (`bodyText`) usa placeholders posicionales Meta. `exampleParams`
 * son los valores de ejemplo que Meta exige al aprobar la plantilla. Mantén
 * `paramKeys`, los `{{n}}` del cuerpo y `exampleParams` siempre alineados.
 */

export type TemplateCategory = "UTILITY" | "MARKETING" | "AUTHENTICATION";

/** Clave lógica de cada momento del timeline (estable, usada por el motor). */
export type CheckinTemplateKey =
  | "owner_week_reminder"
  | "tourist_checkin_start"
  | "tourist_checkin_pending"
  | "tourist_travel_tomorrow"
  | "owner_arrival_tomorrow"
  | "tourist_departure";

export type TemplateDef = {
  /** Clave lógica interna. */
  key: CheckinTemplateKey;
  /** Nombre EXACTO aprobado en Meta (snake_case, sin mayúsculas). */
  name: string;
  language: string;
  category: TemplateCategory;
  /** Nombres lógicos de las variables, en orden `{{1}}…{{n}}`. */
  paramKeys: string[];
  /** Texto del cuerpo con placeholders `{{1}}`. */
  bodyText: string;
  /** Encabezado fijo opcional (texto, sin variables). */
  header?: string;
  footer?: string;
  /** Valores de ejemplo (uno por `paramKey`) para la aprobación de Meta. */
  exampleParams: string[];
};

export const CHECKIN_TEMPLATES: Record<CheckinTemplateKey, TemplateDef> = {
  owner_week_reminder: {
    key: "owner_week_reminder",
    name: "recordatorio_propietario_semana",
    language: "es",
    category: "UTILITY",
    paramKeys: ["nombrePropietario", "nombreFinca"],
    bodyText:
      "Hola {{1}} 👋 Te recordamos que esta semana tenemos alquiler en tu finca {{2}}. Quedamos atentos a cualquier coordinación.",
    footer: "FincasYa",
    exampleParams: ["Hernán", "Villa del Lago"],
  },
  tourist_checkin_start: {
    key: "tourist_checkin_start",
    name: "inicio_checkin_turista",
    language: "es",
    category: "UTILITY",
    paramKeys: ["nombreTurista", "nombreFinca", "linkCheckin"],
    bodyText:
      "Hola {{1}}, estamos próximos a tu check-in en {{2}} 🏡 Para agilizar tu ingreso, ingresa tu lista de invitados y confirma tus servicios aquí: {{3}} Recuerda: sin check-in no hay ingreso.",
    footer: "FincasYa",
    exampleParams: [
      "Camilo",
      "Villa del Lago",
      "https://fincasya.com/checkin/CR-1234",
    ],
  },
  tourist_checkin_pending: {
    key: "tourist_checkin_pending",
    name: "recordatorio_checkin_pendiente",
    language: "es",
    category: "UTILITY",
    paramKeys: ["nombreTurista", "nombreFinca", "linkCheckin"],
    bodyText:
      "Hola {{1}}, aún tienes pendiente tu check-in para tu viaje a {{2}}. Complétalo aquí para asegurar tu ingreso: {{3}} ¡Gracias!",
    footer: "FincasYa",
    exampleParams: [
      "Camilo",
      "Villa del Lago",
      "https://fincasya.com/checkin/CR-1234",
    ],
  },
  tourist_travel_tomorrow: {
    key: "tourist_travel_tomorrow",
    name: "recordatorio_viaje_manana",
    language: "es",
    category: "UTILITY",
    paramKeys: ["nombreTurista", "nombreFinca"],
    bodyText:
      "Hola {{1}}, mañana es tu viaje a {{2}} 🎉 No olvides completar tu check-in si aún no lo has hecho. ¡Te esperamos!",
    footer: "FincasYa",
    exampleParams: ["Camilo", "Villa del Lago"],
  },
  owner_arrival_tomorrow: {
    key: "owner_arrival_tomorrow",
    name: "aviso_llegada_propietario",
    language: "es",
    category: "UTILITY",
    paramKeys: ["nombrePropietario", "nombreFinca"],
    bodyText:
      "Hola {{1}}, mañana estarán viajando nuestros turistas a tu finca {{2}}. Todo listo para recibirlos.",
    footer: "FincasYa",
    exampleParams: ["Hernán", "Villa del Lago"],
  },
  tourist_departure: {
    key: "tourist_departure",
    name: "mensaje_salida_turista",
    language: "es",
    category: "UTILITY",
    paramKeys: ["nombreTurista", "nombreFinca", "horaSalida"],
    bodyText:
      "Hola {{1}}, hoy es tu día de salida de {{2}}. Te recordamos que la hora de salida es a las {{3}}. ¡Gracias por elegirnos!",
    footer: "FincasYa",
    exampleParams: ["Camilo", "Villa del Lago", "11:00 AM"],
  },
};

export const ALL_TEMPLATE_KEYS = Object.keys(
  CHECKIN_TEMPLATES,
) as CheckinTemplateKey[];

export function getTemplateDef(key: string): TemplateDef | undefined {
  return (CHECKIN_TEMPLATES as Record<string, TemplateDef>)[key];
}

/**
 * Rellena los `paramKeys` con un mapa de valores y devuelve el array ordenado
 * para `sendTemplateToYcloud({ bodyParams })`. Las variables faltantes quedan
 * como cadena vacía (Meta rechaza placeholders sin valor → mejor vacío visible).
 */
export function buildBodyParams(
  def: TemplateDef,
  values: Record<string, string | number | undefined | null>,
): string[] {
  return def.paramKeys.map((k) => {
    const v = values[k];
    return v === undefined || v === null ? "" : String(v);
  });
}

/**
 * Construye el payload de creación para la API de templates de YCloud
 * (mismo shape que `whatsappTemplateSheet.buildPayloadFromKeyValue`).
 */
export function buildRegisterPayload(
  def: TemplateDef,
  wabaId: string,
): Record<string, unknown> {
  const components: Array<Record<string, unknown>> = [];
  if (def.header) {
    components.push({ type: "HEADER", format: "TEXT", text: def.header });
  }
  const bodyComponent: Record<string, unknown> = {
    type: "BODY",
    text: def.bodyText,
  };
  if (def.exampleParams.length > 0) {
    // Meta exige ejemplos cuando el cuerpo tiene variables posicionales.
    bodyComponent.example = { body_text: [def.exampleParams] };
  }
  components.push(bodyComponent);
  if (def.footer) {
    components.push({ type: "FOOTER", text: def.footer });
  }
  return {
    wabaId,
    name: def.name,
    language: def.language,
    category: def.category,
    components,
  };
}

/** Render del cuerpo con variables aplicadas (para logear en inbox lo enviado). */
export function renderTemplateBody(
  def: TemplateDef,
  bodyParams: string[],
): string {
  let out = def.bodyText;
  bodyParams.forEach((val, i) => {
    out = out.replaceAll(`{{${i + 1}}}`, val);
  });
  return out;
}
