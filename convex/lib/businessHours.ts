/**
 * Horario laboral del equipo comercial / soporte. Usado por el bot para:
 *   - Anexar un acuse cuando el cliente escribe FUERA de horario.
 *   - Saltar el aviso para emergencias (que sí se atienden 24/7).
 *
 * Horario oficial FincasYa (confirmado jul 2026):
 *   Lunes–Viernes 7:00 AM – 5:00 PM
 *   Sábados 7:00 AM – 3:00 PM
 *   Domingos cerrado
 * Zona: America/Bogota.
 *
 * Env vars (opcionales; los defaults ya reflejan el horario oficial):
 *   BUSINESS_HOURS_START       ej. "07:00"  (Lun–Vie)
 *   BUSINESS_HOURS_END         ej. "17:00"  (Lun–Vie)
 *   BUSINESS_HOURS_SAT_END     ej. "15:00"  (Sáb)
 *   BUSINESS_HOURS_DAYS        ej. "Mon,Tue,Wed,Thu,Fri,Sat"
 *   BUSINESS_HOURS_TZ          ej. "America/Bogota"
 */

const DEFAULT_WEEKDAY_START = "07:00";
const DEFAULT_WEEKDAY_END = "17:00";
const DEFAULT_SAT_END = "15:00";
const DEFAULT_DAYS = "Mon,Tue,Wed,Thu,Fri,Sat";
const DEFAULT_TZ = "America/Bogota";

/** Texto corto del horario — usar en copys del bot (continuidad asesor, stage1, etc.). */
export const BUSINESS_HOURS_SCHEDULE_SHORT =
  "L-V 7:00 AM–5:00 PM, Sáb 7:00 AM–3:00 PM";

/** Acuse cuando hay asesor activo o la conversación espera humano (horario laboral). */
export const ADVISOR_CONTINUITY_WITHIN_HOURS = [
  "¡Hola! Gracias por escribirnos 😊",
  "Ya hemos recibido y atendido tu mensaje ✅",
  "En un momento un asesor de *Fincas Ya* estará contigo.",
  "Esto puede tomar unos minutos, pero en breve recibirás atención personalizada.",
  "Muchas gracias por esperar 🤝",
  "Somos *Fincas Ya* — con gusto te acompañamos.",
].join(" ");

/** Acuse fuera de horario cuando hay asesor activo o la conversación espera humano. */
export const ADVISOR_CONTINUITY_AFTER_HOURS = [
  "¡Hola! Gracias por escribirnos 😊",
  "Ya hemos recibido tu mensaje ✅",
  `En este momento estamos fuera de nuestro horario de atención (${BUSINESS_HOURS_SCHEDULE_SHORT}).`,
  "Tu solicitud quedó registrada y un asesor de *Fincas Ya* continuará contigo al iniciar el próximo horario laboral.",
  "Muchas gracias por esperar 🤝",
  "Somos *Fincas Ya* — con gusto te acompañamos.",
].join(" ");

/** Cierre al finalizar flujo con mensaje temporal activo. */
export const TEMPORAL_MESSAGE_CLOSING =
  "Uno de nuestros asesores de Fincas Ya se comunicará contigo en horario laboral para continuar con tu proceso. Muchas gracias por tu paciencia 🤝";

export const STAGE1_CATALOG_PICK_HANDOFF_MSG = [
  "¡Excelente elección! 🤩 Gracias por elegir con FincasYa 🏡",
  "Vamos a validar la disponibilidad de esta opción para tus fechas y uno de nuestros asesores te ampliará toda la información ✅",
  `Nuestro horario de atención es ${BUSINESS_HOURS_SCHEDULE_SHORT} 🤝 Quedamos muy atentos.`,
].join(" ");

const DAY_MAP: Record<string, number> = {
  sun: 0,
  sunday: 0,
  dom: 0,
  mon: 1,
  monday: 1,
  lun: 1,
  tue: 2,
  tuesday: 2,
  mar: 2,
  wed: 3,
  wednesday: 3,
  mie: 3,
  thu: 4,
  thursday: 4,
  jue: 4,
  fri: 5,
  friday: 5,
  vie: 5,
  sat: 6,
  saturday: 6,
  sab: 6,
};

function parseHHMM(s: string): { h: number; m: number } | null {
  const m = s.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (!Number.isFinite(h) || !Number.isFinite(mm)) return null;
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return { h, m: mm };
}

function parseDays(csv: string): Set<number> {
  const out = new Set<number>();
  for (const raw of csv.split(",")) {
    const key = raw.trim().toLowerCase();
    if (key in DAY_MAP) out.add(DAY_MAP[key]);
  }
  return out;
}

function bogotaLocalParts(nowMs: number): { dayNum: number; hour: number; minute: number } | null {
  const tz = process.env.BUSINESS_HOURS_TZ ?? DEFAULT_TZ;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(nowMs));
  const wd = String(parts.find((p) => p.type === "weekday")?.value ?? "")
    .toLowerCase()
    .slice(0, 3);
  const hourStr = String(parts.find((p) => p.type === "hour")?.value ?? "00");
  const minStr = String(parts.find((p) => p.type === "minute")?.value ?? "00");
  const dayNum = DAY_MAP[wd];
  if (dayNum === undefined) return null;
  return {
    dayNum,
    hour: parseInt(hourStr, 10),
    minute: parseInt(minStr, 10),
  };
}

/**
 * ¿Es horario laboral ahora mismo (en la zona horaria configurada)? Si las
 * env vars están mal formadas se cae a los defaults oficiales (L-V 7-17,
 * Sáb 7-15 Bogotá).
 */
export function isWithinBusinessHours(nowMs: number): boolean {
  const start =
    parseHHMM(process.env.BUSINESS_HOURS_START ?? DEFAULT_WEEKDAY_START) ??
    parseHHMM(DEFAULT_WEEKDAY_START)!;
  const weekdayEnd =
    parseHHMM(process.env.BUSINESS_HOURS_END ?? DEFAULT_WEEKDAY_END) ??
    parseHHMM(DEFAULT_WEEKDAY_END)!;
  const satEnd =
    parseHHMM(process.env.BUSINESS_HOURS_SAT_END ?? DEFAULT_SAT_END) ??
    parseHHMM(DEFAULT_SAT_END)!;
  const days = parseDays(process.env.BUSINESS_HOURS_DAYS ?? DEFAULT_DAYS);

  const local = bogotaLocalParts(nowMs);
  if (!local) return true;
  if (!days.has(local.dayNum)) return false;

  const end = local.dayNum === 6 ? satEnd : weekdayEnd;
  const nowMinutes = local.hour * 60 + local.minute;
  const startMinutes = start.h * 60 + start.m;
  const endMinutes = end.h * 60 + end.m;
  return nowMinutes >= startMinutes && nowMinutes < endMinutes;
}

/**
 * Texto de acuse para anexar al final del primer reply del bot cuando el
 * cliente escribe fuera de horario y NO es una emergencia. La idea es que el
 * cliente sepa que su mensaje fue recibido y cuándo esperar atención.
 *
 * ⚠️ EVITA frases del tipo "un asesor te <verbo>" / "te conecto con asesor" /
 * "déjame confirmarlo con asesor" — porque el post-procesado de
 * `botPromisedHandoff` en `inbound.ts` interpreta esas como promesas de
 * handoff explícito y escala la conversación a humano. Eso convertía este
 * aviso (que es solo informativo) en un escalado de oficio. Por eso usamos
 * 1ª persona del plural ("te respondemos", "te atendemos") sin nombrar al
 * asesor como sujeto de la acción.
 */
export const AFTER_HOURS_NOTICE = [
  "",
  "",
  `📅 Nuestro horario de atención es de Lunes a Viernes, de 7:00 AM a 5:00 PM, y Sábados de 7:00 AM a 3:00 PM (hora Colombia).`,
  "",
  "Si nos escribes fuera de este horario, tu mensaje seguirá siendo recibido con normalidad 🙌",
  "Puedes continuar enviando la información de tu viaje o reserva para ir avanzando en el proceso.",
  "",
  "✨ Apenas iniciemos atención, uno de nuestros asesores continuará contigo para:",
  "📝 Gestionar la reserva",
  "💳 Compartir contrato y opciones de pago",
  "",
  "⚡ Si tu caso es urgente, escribe la palabra URGENTE y un asesor on-call te contactará lo antes posible.",
].join("\n");

/**
 * ¿El cliente marcó su mensaje como URGENTE (vía la keyword en el copy de
 * fuera-de-horario, o por iniciativa propia)?
 */
export function clientFlaggedUrgent(text: string): boolean {
  const t = String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  return /\b(urgente|urgencia|importante\s+ya|ya\s+mismo|es\s+urgente)\b/.test(
    t,
  );
}
