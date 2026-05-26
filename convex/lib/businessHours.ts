/**
 * Horario laboral del equipo comercial / soporte. Usado por el bot para:
 *   - Anexar un acuse cuando el cliente escribe FUERA de horario.
 *   - Saltar el aviso para emergencias (que sí se atienden 24/7).
 *
 * Configurable vía env vars; valores por defecto: Lunes-Sábado 8:00 - 18:00
 * hora de Colombia (America/Bogota).
 *
 * Env vars:
 *   BUSINESS_HOURS_START   ej. "08:00"
 *   BUSINESS_HOURS_END     ej. "18:00"
 *   BUSINESS_HOURS_DAYS    ej. "Mon,Tue,Wed,Thu,Fri,Sat" (caso-insensible)
 *   BUSINESS_HOURS_TZ      ej. "America/Bogota"
 */

const DEFAULT_START = "08:00";
const DEFAULT_END = "18:00";
const DEFAULT_DAYS = "Mon,Tue,Wed,Thu,Fri,Sat";
const DEFAULT_TZ = "America/Bogota";

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

/**
 * ¿Es horario laboral ahora mismo (en la zona horaria configurada)? Si las
 * env vars están mal formadas se cae a los defaults (Lun-Sáb 8-18 Bogotá).
 */
export function isWithinBusinessHours(nowMs: number): boolean {
  const start =
    parseHHMM(process.env.BUSINESS_HOURS_START ?? DEFAULT_START) ??
    parseHHMM(DEFAULT_START)!;
  const end =
    parseHHMM(process.env.BUSINESS_HOURS_END ?? DEFAULT_END) ??
    parseHHMM(DEFAULT_END)!;
  const days = parseDays(process.env.BUSINESS_HOURS_DAYS ?? DEFAULT_DAYS);
  const tz = process.env.BUSINESS_HOURS_TZ ?? DEFAULT_TZ;

  // Hora local en la TZ configurada
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
  if (dayNum === undefined) return true; // si algo se rompe, default a "dentro de horario" (no anunciar)
  if (!days.has(dayNum)) return false;

  const h = parseInt(hourStr, 10);
  const m = parseInt(minStr, 10);
  const nowMinutes = h * 60 + m;
  const startMinutes = start.h * 60 + start.m;
  const endMinutes = end.h * 60 + end.m;
  return nowMinutes >= startMinutes && nowMinutes < endMinutes;
}

/**
 * Texto de acuse para anexar al final del primer reply del bot cuando el
 * cliente escribe fuera de horario y NO es una emergencia. La idea es que el
 * cliente sepa que su mensaje fue recibido y cuándo esperar atención.
 */
export const AFTER_HOURS_NOTICE = [
  "",
  "",
  "📅 *Estamos fuera del horario laboral.* Atendemos nuevas conversaciones de *Lunes a Sábado, 8:00 AM a 6:00 PM* (hora Colombia). Recibí tu mensaje y un asesor te responde apenas iniciemos.",
  "",
  "⚡ Si tu caso es *urgente*, escribe la palabra *URGENTE* y un asesor on-call te contacta lo antes posible.",
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
