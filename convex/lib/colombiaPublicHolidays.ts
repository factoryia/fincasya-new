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
 * 1 noche en patrón fin-de-semana con puente (Colombia): no enviar catálogo hasta alargar estadía (mín. 2 noches).
 *
 * Cubre:
 * - Sábado → domingo, si el **lunes siguiente** es festivo (o el usuario dice festivo/puente).
 * - Domingo → lunes, si ese **lunes** es festivo (o el usuario dice festivo/puente).
 */
export function shouldBlockCatalogForPuenteOneNightSatSun(
  fechaEntrada: number,
  fechaSalida: number,
  mergedUserText: string,
): boolean {
  const nights = countCatalogNights(fechaEntrada, fechaSalida);
  if (nights !== 1) return false;

  const lower = mergedUserText.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");

  if (isSaturdayCheckInSundayCheckOutBogota(fechaEntrada, fechaSalida)) {
    if (userMentionsFestiveOrBridge(lower)) return true;
    const monYmd = mondayAfterCheckoutSundayYmd(fechaSalida);
    if (monYmd && isColombiaPublicHolidayYmd(monYmd)) return true;
    return false;
  }

  if (isSundayCheckInMondayCheckOutBogota(fechaEntrada, fechaSalida)) {
    if (userMentionsFestiveOrBridge(lower)) return true;
    const monYmd = toYmdColombia(fechaSalida);
    if (isColombiaPublicHolidayYmd(monYmd)) return true;
    return false;
  }

  return false;
}

/**
 * Primer aviso (puente / 1 noche): copy comercial fijo.
 * `checkIn` / `checkOut` se mantienen en la firma por compatibilidad con llamadas existentes.
 */
export function buildPuenteShortNoticeEs(_checkIn: string, _checkOut: string): string {
  return [
    "Las fechas que seleccionaste son en puente festivo, para este tipo de fines de semana te brindamos reservar como mínimo 2 noches 🏡",
    "",
    "Si deseas reservar una sola noche puede ser fines de semana sin puentes festivos o entre semana 📅",
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
