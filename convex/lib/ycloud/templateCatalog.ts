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

import type { TemplateComponent } from "./senders";

export type TemplateCategory = "UTILITY" | "MARKETING" | "AUTHENTICATION";

/**
 * Botón de la plantilla. `url` = botón "Visitar sitio web" con URL dinámica
 * (`urlBase` + `{{1}}`); al enviar, el sufijo dinámico es la referencia de la
 * reserva. `quick_reply` solo devuelve el texto (no abre links).
 */
export type TemplateButton =
  | {
      type: "url";
      text: string;
      /** Base fija de la URL, termina en "/". Ej: "https://fincasya.com/checkin/". */
      urlBase: string;
      /** Sufijo de ejemplo para la aprobación de Meta. Ej: "CR-1234". */
      exampleSuffix: string;
    }
  | { type: "quick_reply"; text: string };

/** Clave lógica de cada momento del timeline (estable, usada por el motor). */
export type CheckinTemplateKey =
  | "owner_week_reminder"
  | "tourist_checkin_start"
  | "tourist_checkin_pending"
  | "tourist_travel_tomorrow"
  | "owner_arrival_tomorrow"
  | "tourist_departure";

/** Plantillas fuera del timeline de check-in (transaccionales / consentimiento). */
export type ExtraTemplateKey = "data_consent";

/** Cualquier plantilla preaprobada conocida por el código. */
export type TemplateKey = CheckinTemplateKey | ExtraTemplateKey;

export type TemplateDef = {
  /** Clave lógica interna. */
  key: TemplateKey;
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
  /** Botón opcional (URL dinámica o respuesta rápida). */
  button?: TemplateButton;
  /**
   * Botones múltiples (respuestas rápidas). Tiene prioridad sobre `button`.
   * Se usa, por ejemplo, en la plantilla de consentimiento de datos
   * ("Sí, autorizo" / "No autorizo").
   */
  buttons?: TemplateButton[];
  /** Valores de ejemplo (uno por `paramKey`) para la aprobación de Meta. */
  exampleParams: string[];
};

/**
 * Plantillas transaccionales que NO son parte del timeline de check-in
 * (no las agenda el cron ni aparecen en el admin de check-in), pero sí
 * existen aprobadas en Meta y se usan desde el bot / envío manual.
 */
export const EXTRA_TEMPLATES: Record<ExtraTemplateKey, TemplateDef> = {
  data_consent: {
    key: "data_consent",
    name: "tratamiento_de_datos",
    language: "es",
    category: "UTILITY",
    paramKeys: ["nombre"],
    bodyText:
      "¡Hola, {{1}}! Gracias por confiar en FincasYa.com. Para comenzar a buscar la finca ideal para ti y ofrecerte una atención personalizada, necesitamos tu autorización para el tratamiento de tus datos personales, de acuerdo con nuestra política de privacidad.\n\n¿Nos autorizas a continuar?",
    buttons: [
      { type: "quick_reply", text: "Sí, autorizo" },
      { type: "quick_reply", text: "No autorizo" },
    ],
    exampleParams: ["Santiago"],
  },
};

export const CHECKIN_TEMPLATES: Record<CheckinTemplateKey, TemplateDef> = {
  owner_week_reminder: {
    key: "owner_week_reminder",
    name: "recordatorio_propietario_semana",
    language: "es",
    category: "UTILITY",
    paramKeys: ["nombrePropietario", "nombreFinca"],
    bodyText:
      "Hola {{1}}, te recordamos que esta semana tenemos alquiler en tu finca {{2}}. Quedamos atentos a cualquier coordinación.",
    footer: "FincasYa",
    exampleParams: ["Hernán", "Villa del Lago"],
  },
  tourist_checkin_start: {
    key: "tourist_checkin_start",
    // v6: llegada y hora de ingreso en líneas separadas (copy operativo, jun 2026).
    // Hoy se usa para copiar/pegar; si se reactiva el envío Meta debe re-aprobarse.
    name: "inicio_checkin_turista",
    language: "es",
    category: "UTILITY",
    paramKeys: [
      "nombreTurista",
      "nombreFinca",
      "fechaLlegada",
      "horaIngreso",
      "linkCheckin",
    ],
    bodyText:
      "¡Hola, {{1}}! 👋\n🌴 Ya casi llega el momento de disfrutar de {{2}}.\n📅 Llegada: {{3}}\n🕒 Ingreso: {{4}}\n\nPara continuar con tu proceso de ingreso, por favor realiza tu check-in aquí:\n👉 {{5}}\n\n⚠️ Importante: El check-in debe completarse mínimo 36 horas antes de tu llegada. Sin este proceso no podremos autorizar el ingreso a la propiedad.\n\n🏡 FincasYa.com",
    button: {
      type: "url",
      text: "Hacer check-in",
      urlBase: "https://fincasya.com/checkin/",
      exampleSuffix: "CR-1234",
    },
    exampleParams: [
      "Vanessa",
      "MELGAR VILLA PALMA 13PAX MG#008",
      "Sábado 20 de junio de 2026",
      "10:00 AM",
      "https://fincasya.com/checkin/2642",
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
      "Hola {{1}}, mañana es tu viaje a {{2}}. No olvides completar tu check-in si aún no lo has hecho. ¡Te esperamos!",
    footer: "FincasYa",
    exampleParams: ["Camilo", "Villa del Lago"],
  },
  owner_arrival_tomorrow: {
    key: "owner_arrival_tomorrow",
    // v2 (jun 2026): aviso completo con fecha, finca y enlace /anfitrion.
    // Si se reactiva el envío Meta debe re-aprobarse con este cuerpo.
    name: "aviso_llegada_propietario",
    language: "es",
    category: "UTILITY",
    paramKeys: [
      "nombrePropietario",
      "fechaLlegada",
      "nombreFinca",
      "linkAnfitrion",
    ],
    bodyText:
      "🏡 ¡Hola, {{1}}! Un gusto saludarte.\n📅 El {{2}} estarán viajando nuestros turistas a tu finca {{3}}. ✨ Todo está listo para recibirlos.\n📝 Te recordamos que en este enlace podrás consultar la lista de invitados y hacer seguimiento a medida que los turistas vayan completando su registro:\n👉 {{4}}\n🚗 El día del viaje te estaremos informando sobre los tiempos de desplazamiento para que todo esté debidamente coordinado.\n🤝 Si tienes alguna inquietud o se presenta alguna novedad, por favor háznoslo saber. ¡Estaremos atentos para apoyarte!\n✨ Muchas gracias, como siempre, por toda tu colaboración.",
    footer: "FincasYa",
    exampleParams: [
      "señor Hernán",
      "viernes 26 de junio",
      "ANAPOIMA HOME LUXURY HILLS 13PAX AN#003",
      "https://fincasya.com/anfitrion/2656",
    ],
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

/**
 * Mapa combinado de TODAS las plantillas conocidas (check-in + extra). Se usa
 * para resolver una plantilla por su clave lógica desde cualquier flujo (bot,
 * envío manual). El scheduler de check-in sigue usando solo `CHECKIN_TEMPLATES`.
 */
export const ALL_TEMPLATES: Record<TemplateKey, TemplateDef> = {
  ...EXTRA_TEMPLATES,
  ...CHECKIN_TEMPLATES,
};

/** Claves de plantillas que se pueden enviar MANUALMENTE desde el inbox. */
export const MANUAL_TEMPLATE_KEYS = Object.keys(ALL_TEMPLATES) as TemplateKey[];

export function getTemplateDef(key: string): TemplateDef | undefined {
  return (ALL_TEMPLATES as Record<string, TemplateDef>)[key];
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
  const buttonDefs: TemplateButton[] = def.buttons?.length
    ? def.buttons
    : def.button
      ? [def.button]
      : [];
  if (buttonDefs.length > 0) {
    const buttons = buttonDefs.map((b) =>
      b.type === "url"
        ? {
            type: "URL",
            text: b.text,
            url: `${b.urlBase}{{1}}`,
            example: [`${b.urlBase}${b.exampleSuffix}`],
          }
        : { type: "QUICK_REPLY", text: b.text },
    );
    components.push({ type: "BUTTONS", buttons });
  }
  return {
    wabaId,
    name: def.name,
    language: def.language,
    category: def.category,
    components,
  };
}

/**
 * Construye los `components` para ENVIAR una plantilla que tiene botón (cuerpo
 * + botón URL dinámico). El sufijo dinámico del botón se deriva del valor de
 * `linkCheckin` en `bodyParams` (la parte después del último "/").
 *
 * Devuelve `undefined` si la plantilla no tiene botón → el llamador debe usar
 * `bodyParams` como antes.
 */
export function buildSendComponents(
  def: TemplateDef,
  bodyParams: string[],
): TemplateComponent[] | undefined {
  if (!def.button) return undefined;

  const components: TemplateComponent[] = [];
  if (bodyParams.length > 0) {
    components.push({
      type: "body",
      parameters: bodyParams.map((text) => ({ type: "text", text })),
    });
  }

  if (def.button.type === "url") {
    const linkIdx = def.paramKeys.findIndex((k) =>
      k === "linkCheckin" || k === "linkAnfitrion",
    );
    const linkVal = linkIdx >= 0 ? (bodyParams[linkIdx] ?? "") : "";
    const suffix = linkVal.split("/").filter(Boolean).pop() ?? "";
    components.push({
      type: "button",
      sub_type: "url",
      index: "0",
      parameters: [{ type: "text", text: suffix }],
    });
  }

  return components;
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

export function assertBodyParamsCount(
  def: TemplateDef,
  bodyParams: string[],
): void {
  if (bodyParams.length !== def.paramKeys.length) {
    throw new Error(
      `La plantilla "${def.name}" requiere ${def.paramKeys.length} variables (${def.paramKeys.join(", ")}); recibidas: ${bodyParams.length}.`,
    );
  }
}

/** Mensaje legible cuando YCloud/Meta rechaza el envío de plantilla. */
export function formatTemplateSendError(
  err: unknown,
  def: TemplateDef,
): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/not found|does not exist|132001|template name/i.test(raw)) {
    return (
      `La plantilla "${def.name}" no está aprobada en Meta/WhatsApp. ` +
      `Regístrala desde Admin → Reservas → Registrar plantillas (clave: ${def.key}). ` +
      `Detalle: ${raw}`
    );
  }
  if (/132000|number of parameters|param count|expected number of params/i.test(raw)) {
    return (
      `Las variables no coinciden con la plantilla aprobada en Meta ` +
      `(${def.paramKeys.length} esperadas: ${def.paramKeys.join(", ")}). ` +
      `Si acabas de cambiar el texto, vuelve a registrarla en Meta. Detalle: ${raw}`
    );
  }
  if (/132015|132016|132017|template paused|template disabled|quality/i.test(raw)) {
    return `La plantilla "${def.name}" está pausada o deshabilitada en Meta. Detalle: ${raw}`;
  }
  return raw;
}
