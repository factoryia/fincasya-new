/**
 * Festivos Colombia (calendario civil) en YYYY-MM-DD, zona America/Bogota.
 * Se usa para no enviar catálogo con solo 1 noche sáb→dom cuando el lunes siguiente es festivo (puente).
 * Actualizar anualmente desde fuente oficial (ej. festivos.com.co).
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

function userMentionsFestiveOrBridge(lowerMerged: string): boolean {
  return /\b(festivo|festivos|puente|puentes|feriado|feriados|d[ií]a\s+festivo|puente\s+festivo|festividad)\b/i.test(
    lowerMerged,
  );
}

/**
 * 1 noche sábado→domingo con lunes festivo en Colombia, o el usuario indica festivo/puente:
 * no mostrar catálogo hasta alargar estadía (mín. 2 noches en esos fines de semana).
 */
export function shouldBlockCatalogForPuenteOneNightSatSun(
  fechaEntrada: number,
  fechaSalida: number,
  mergedUserText: string,
): boolean {
  const nights = countCatalogNights(fechaEntrada, fechaSalida);
  if (nights !== 1) return false;
  if (!isSaturdayCheckInSundayCheckOutBogota(fechaEntrada, fechaSalida)) return false;

  const lower = mergedUserText.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  if (userMentionsFestiveOrBridge(lower)) return true;

  const monYmd = mondayAfterCheckoutSundayYmd(fechaSalida);
  if (monYmd && isColombiaPublicHolidayYmd(monYmd)) return true;

  return false;
}

export const PUENTE_ONE_NIGHT_CATALOG_NOTICE_ES = `Antes de enviarte el catálogo: ese fin de semana cae en **puente o día festivo** y, por política de FincasYa, en esas fechas la estadía mínima es de **2 noches** (no alcanza solo del sábado al domingo).

Indícame por favor **entrada y salida con al menos 2 noches** (por ejemplo del sábado 16 al lunes 18 de mayo) y te comparto opciones con disponibilidad y precio acordes a tus fechas. ✅`;
