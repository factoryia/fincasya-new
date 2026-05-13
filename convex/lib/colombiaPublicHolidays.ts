/**
 * Festivos Colombia (calendario civil) en YYYY-MM-DD, zona America/Bogota.
 *
 * Uso: evitar catálogo con **1 sola noche** en fines de semana “tipo puente”:
 * - Entrada sábado → salida domingo, si el **lunes siguiente** es festivo.
 * - Entrada domingo → salida lunes, si ese **lunes** es festivo.
 *
 * Una noche entre semana o fin de semana **sin** lunes festivo en ese patrón puede seguir el flujo normal.
 * Calendario cargado: **18 festivos/año** para 2025, 2026 y 2027 (traslados Ley Emiliani).
 * Revisar al inicio de cada año frente a fuente oficial (Presidencia / MinTrabajo).
 */
const CO_PUBLIC_HOLIDAYS = new Set<string>([
  // 2025
  "2025-01-01",
  "2025-01-06",
  "2025-03-24",
  "2025-03-30",
  "2025-04-17",
  "2025-04-18",
  "2025-05-01",
  "2025-06-02",
  "2025-06-23",
  "2025-06-30",
  "2025-07-20",
  "2025-08-07",
  "2025-08-18",
  "2025-10-13",
  "2025-11-03",
  "2025-11-17",
  "2025-12-08",
  "2025-12-25",
  // 2026
  "2026-01-01",
  "2026-01-12",
  "2026-03-23",
  "2026-04-02",
  "2026-04-03",
  "2026-05-01",
  "2026-05-18",
  "2026-06-08",
  "2026-06-15",
  "2026-06-29",
  "2026-07-20",
  "2026-08-07",
  "2026-08-17",
  "2026-10-12",
  "2026-11-02",
  "2026-11-16",
  "2026-12-08",
  "2026-12-25",
  // 2027
  "2027-01-01",
  "2027-01-11",
  "2027-03-22",
  "2027-03-29",
  "2027-04-01",
  "2027-04-02",
  "2027-05-01",
  "2027-05-17",
  "2027-06-07",
  "2027-06-14",
  "2027-06-21",
  "2027-07-05",
  "2027-07-20",
  "2027-08-07",
  "2027-08-16",
  "2027-10-18",
  "2027-11-01",
  "2027-11-15",
  "2027-12-08",
  "2027-12-25",
]);

export function toYmdColombia(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

export function isColombiaPublicHolidayYmd(ymd: string): boolean {
  return CO_PUBLIC_HOLIDAYS.has(ymd);
}

/** Mediodía en calendario Colombia (sin DST). `calendarMonth` 1–12. */
export function bogotaWallClockNoon(y: number, calendarMonth: number, da: number): Date {
  return new Date(
    `${y}-${String(calendarMonth).padStart(2, "0")}-${String(da).padStart(2, "0")}T12:00:00-05:00`,
  );
}

/** Igual que `new Date(y, jsMonth, day)` pero el día civil es el de Bogotá (Convex suele correr en UTC). */
export function bogotaCalendarDateNoonMs(
  year: number,
  jsMonthZeroIndexed: number,
  day: number,
): number {
  return bogotaWallClockNoon(year, jsMonthZeroIndexed + 1, day).getTime();
}

function bogotaWeekdayShort(ms: number): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Bogota",
    weekday: "short",
  }).format(new Date(ms));
}

/** Lunes inmediatamente posterior al domingo de check-out (en calendario Bogotá). */
export function mondayAfterCheckoutSundayYmd(checkOutMs: number): string | null {
  const ymd = toYmdColombia(checkOutMs);
  const [y, m, d] = ymd.split("-").map((x) => parseInt(x, 10));
  if (bogotaWeekdayShort(bogotaWallClockNoon(y, m, d).getTime()) !== "Sun") return null;
  const next = bogotaWallClockNoon(y, m, d);
  next.setDate(next.getDate() + 1);
  return toYmdColombia(next.getTime());
}

export function countCatalogNights(fechaEntrada: number, fechaSalida: number): number {
  if (!Number.isFinite(fechaEntrada) || !Number.isFinite(fechaSalida) || fechaSalida <= fechaEntrada)
    return 0;
  return Math.max(0, Math.round((fechaSalida - fechaEntrada) / 86_400_000));
}

function isSaturdayCheckInSundayCheckOutBogota(
  fechaEntrada: number,
  fechaSalida: number,
): boolean {
  return bogotaWeekdayShort(fechaEntrada) === "Sat" && bogotaWeekdayShort(fechaSalida) === "Sun";
}

function isSundayCheckInMondayCheckOutBogota(
  fechaEntrada: number,
  fechaSalida: number,
): boolean {
  return bogotaWeekdayShort(fechaEntrada) === "Sun" && bogotaWeekdayShort(fechaSalida) === "Mon";
}

function userMentionsFestiveOrBridge(lowerMerged: string): boolean {
  return /\b(festivo|festivos|puente|puentes|feriado|feriados|d[ií]a\s+festivo|puente\s+festivo|festividad)\b/i.test(
    lowerMerged,
  );
}

/**
 * 1 noche en patrón puente festivo (Colombia): no enviar catálogo hasta alargar
 * estadía (mín. 2 noches).
 *
 * Regla general: la noche reservada cuenta como **puente** si dentro del conjunto
 * `{checkIn-1, checkIn, checkOut, checkOut+1}` hay un festivo del calendario
 * colombiano. Cubre:
 *   - Viernes festivo → Sábado (ej. 7-8 ago = Batalla de Boyacá).
 *   - Jueves → Viernes festivo (ej. 2 abr Jueves Santo → 3 abr Viernes Santo).
 *   - Sábado → Domingo + Lunes festivo (puente Emiliani clásico).
 *   - Domingo → Lunes festivo.
 *   - Sábado festivo → Domingo (festivos en sábado).
 *   - Cualquier "víspera de festivo" en 1 noche.
 *
 * Si el cliente menciona explícitamente "festivo" / "puente" / "feriado" y solo
 * pide 1 noche, también se bloquea (cubre festivos regionales no listados o
 * desfases del calendario).
 */
export function shouldBlockCatalogForPuenteOneNightSatSun(
  fechaEntrada: number,
  fechaSalida: number,
  mergedUserText: string,
): boolean {
  const nights = countCatalogNights(fechaEntrada, fechaSalida);
  if (nights !== 1) return false;

  const ONE_DAY_MS = 86_400_000;
  const checkInYmd = toYmdColombia(fechaEntrada);
  const checkInPrevYmd = toYmdColombia(fechaEntrada - ONE_DAY_MS);
  const checkOutYmd = toYmdColombia(fechaSalida);
  const checkOutNextYmd = toYmdColombia(fechaSalida + ONE_DAY_MS);

  const hasHolidayInWindow =
    isColombiaPublicHolidayYmd(checkInPrevYmd) ||
    isColombiaPublicHolidayYmd(checkInYmd) ||
    isColombiaPublicHolidayYmd(checkOutYmd) ||
    isColombiaPublicHolidayYmd(checkOutNextYmd);

  if (hasHolidayInWindow) return true;

  // Festivo no listado o regional: si el cliente lo nombra explícitamente
  // y solo pide 1 noche en patrón Sáb→Dom o Dom→Lun, también bloquear.
  const lower = mergedUserText.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  if (userMentionsFestiveOrBridge(lower)) {
    if (
      isSaturdayCheckInSundayCheckOutBogota(fechaEntrada, fechaSalida) ||
      isSundayCheckInMondayCheckOutBogota(fechaEntrada, fechaSalida)
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Primer aviso (puente / 1 noche): copy comercial fijo.
 * `checkIn` / `checkOut` se mantienen en la firma por compatibilidad con llamadas existentes.
 */
export function buildPuenteShortNoticeEs(_checkIn: string, _checkOut: string): string {
  return [
    "Las fechas que seleccionaste corresponden a un fin de semana con puente festivo, y para esas fechas manejamos una estadía mínima de 2 noches.",
    "",
    "Si deseas reservar solo una noche, con gusto podemos ofrecer disponibilidad en fines de semana sin puente festivo o entre semana ✨",
  ].join("\n");
}

/**
 * Seguimiento cuando el cliente insiste en 1 noche u otras fechas (mismo tema, otro redactado).
 */
export function buildPuenteFollowUpConversationEs(_checkIn: string, _checkOut: string): string {
  return (
    "Claro que sí 😊 Si deseas realizar una cotización por el mínimo de una noche, podrías contemplar entre semana o fines de semana; " +
    "sin puente festivo nos reconfirmas por favor fecha de entrada y salida 📅"
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Temporadas especiales con mínimo de noches propio
// (Navidad / Fin de año / Reyes en Colombia)
// ─────────────────────────────────────────────────────────────────────────────

export type SpecialSeasonName = "navidad" | "fin_de_ano" | "reyes";

export type SpecialSeasonInfo = {
  name: SpecialSeasonName;
  /** Texto humano-legible para mostrar al cliente. */
  label: string;
  emoji: string;
  /** Mínimo de noches que se exige para reservar dentro de esta temporada. */
  minNights: number;
};

const NAVIDAD: SpecialSeasonInfo = {
  name: "navidad",
  label: "Navidad",
  emoji: "🎅🏻",
  minNights: 3,
};
const FIN_DE_ANO: SpecialSeasonInfo = {
  name: "fin_de_ano",
  label: "Fin de año",
  emoji: "☃️",
  minNights: 6,
};
const REYES: SpecialSeasonInfo = {
  name: "reyes",
  label: "Reyes",
  emoji: "🤴",
  minNights: 2,
};

function ymdToBogotaNoonMsLocal(ymd: string): number {
  const [y, m, d] = ymd.split("-").map((x) => parseInt(x, 10));
  return bogotaWallClockNoon(y, m, d).getTime();
}

/** Día (en calendario Bogotá) que cae dentro del rango Navidad 20-26 dic. */
function isInNavidadWindow(ymd: string): boolean {
  const mmdd = ymd.slice(5); // "12-23"
  return mmdd >= "12-20" && mmdd <= "12-26";
}

/** Día que cae en rango Fin de año 27 dic - 02 ene (wraparound de año). */
function isInFinDeAnoWindow(ymd: string): boolean {
  const mmdd = ymd.slice(5);
  return mmdd >= "12-27" || mmdd <= "01-02";
}

/**
 * Día que cae en "puente de Reyes": los 3 días anteriores al festivo trasladado
 * de los Reyes Magos (típicamente el segundo lunes de enero por Ley Emiliani),
 * inclusive el festivo mismo. Busca dinámicamente el primer festivo de enero
 * en `CO_PUBLIC_HOLIDAYS` para el año del `ymd` dado.
 */
function isInReyesWindow(ymd: string): boolean {
  const [yStr, mStr] = ymd.split("-");
  const y = parseInt(yStr, 10);
  const m = parseInt(mStr, 10);
  if (m !== 1) return false;
  for (let day = 1; day <= 31; day++) {
    const candidate = `${y}-01-${String(day).padStart(2, "0")}`;
    if (CO_PUBLIC_HOLIDAYS.has(candidate)) {
      const reyesMs = ymdToBogotaNoonMsLocal(candidate);
      const dayMs = ymdToBogotaNoonMsLocal(ymd);
      // ventana: 3 días antes hasta el festivo inclusive
      return dayMs >= reyesMs - 3 * 86_400_000 && dayMs <= reyesMs;
    }
  }
  return false;
}

/**
 * Detecta si el rango [checkIn, checkOut) toca alguna temporada especial.
 * Itera día por día (Bogotá). Prioridad cuando hay solape:
 *   Fin de año > Navidad > Reyes (en ese orden por restricción de mínimo).
 */
export function detectSpecialSeasonForRange(
  checkInMs: number,
  checkOutMs: number,
): SpecialSeasonInfo | null {
  const ONE_DAY = 86_400_000;
  if (!Number.isFinite(checkInMs) || !Number.isFinite(checkOutMs)) return null;
  if (checkOutMs <= checkInMs) return null;

  let touchesFinDeAno = false;
  let touchesNavidad = false;
  let touchesReyes = false;

  // Iteramos los días dormidos (desde checkIn hasta checkOut - 1 día inclusive).
  for (let ms = checkInMs; ms < checkOutMs; ms += ONE_DAY) {
    const ymd = toYmdColombia(ms);
    if (isInFinDeAnoWindow(ymd)) touchesFinDeAno = true;
    else if (isInNavidadWindow(ymd)) touchesNavidad = true;
    else if (isInReyesWindow(ymd)) touchesReyes = true;
  }

  if (touchesFinDeAno) return FIN_DE_ANO;
  if (touchesNavidad) return NAVIDAD;
  if (touchesReyes) return REYES;
  return null;
}

/**
 * Si el rango cae en una temporada especial Y las noches son menores al mínimo,
 * devuelve `{ season, currentNights }`. Si cumple el mínimo o no es temporada
 * especial, devuelve null. El bot usa esto para enviar un mensaje específico
 * pidiendo al cliente que extienda las fechas.
 */
export function shouldBlockCatalogForSpecialSeason(
  checkInMs: number,
  checkOutMs: number,
): { season: SpecialSeasonInfo; currentNights: number } | null {
  const season = detectSpecialSeasonForRange(checkInMs, checkOutMs);
  if (!season) return null;
  const nights = countCatalogNights(checkInMs, checkOutMs);
  if (nights >= season.minNights) return null;
  return { season, currentNights: nights };
}

/**
 * Mensaje cuando el cliente pidió fechas dentro de Navidad / Fin de año / Reyes
 * pero con menos noches que el mínimo de esa temporada.
 *
 * Alineado con el copy comercial: explica TODOS los mínimos (para que el cliente
 * vea las tres opciones) y resalta la que aplica a sus fechas.
 */
export function buildSpecialSeasonNoticeEs(
  season: SpecialSeasonInfo,
  currentNights: number,
): string {
  const nochesActual = currentNights === 1 ? "1 noche" : `${currentNights} noches`;
  return [
    "Hola buen día, gusto saludarte 👋🏻",
    "",
    `Por favor ten presente que en temporadas especiales como *Fin de año*, *Navidad* y *puente de Reyes*, los costos y condiciones de alquiler son distintos ☝️🎄`,
    "",
    "🏡 Las propiedades tienen una *estancia mínima de noches*, que varía según la fecha:",
    "",
    "• *Navidad:* 3 a 4 noches mínimo 🎅🏻",
    "• *Fin de año:* 6 a 7 noches mínimo ☃️",
    "• *Reyes:* 2 a 3 noches mínimo 🤴",
    "",
    `Tus fechas caen en *${season.label}* ${season.emoji} y por ahora marcaste *${nochesActual}*. Para esa temporada necesitamos *mínimo ${season.minNights} noches*.`,
    "",
    "Por favor ajusta las fechas y con gusto te compartimos las opciones disponibles 🙌",
  ].join("\n");
}

/**
 * Recordatorio CORTO de temporada especial: se emite a partir del 2º turno
 * con el bloqueo activo (cuando el cliente ya vio el aviso largo y aún no
 * ajustó las fechas). Evita repetir el bloque grande pero mantiene el
 * bloqueo del flujo del FSM hasta que las fechas cumplan el mínimo.
 */
export function buildSpecialSeasonShortReminderEs(
  season: SpecialSeasonInfo,
  currentNights: number,
): string {
  const nochesActual = currentNights === 1 ? "1 noche" : `${currentNights} noches`;
  const sufijo = currentNights === 1 ? "" : "s";
  return [
    `Recuerda: para *${season.label}* ${season.emoji} necesitamos *mínimo ${season.minNights} noches*. Por ahora tienes *${nochesActual}* seleccionada${sufijo}.`,
    "",
    `📅 Por favor envíame las *nuevas fechas* (entrada y salida) con al menos ${season.minNights} noches y te comparto las opciones disponibles 🙌`,
  ].join("\n");
}
