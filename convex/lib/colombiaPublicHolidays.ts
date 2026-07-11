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

// ─────────────────────────────────────────────────────────────────────────────
// Resolver de referencias tipo "segundo puente de agosto" → fechas concretas
// ─────────────────────────────────────────────────────────────────────────────

const MONTH_NAMES_ES: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

/** "primer/segundo/tercer/cuarto/ultimo" → índice 1..4 (o -1 para último). */
const ORDINAL_MAP: Record<string, number> = {
  primer: 1,
  primero: 1,
  primera: 1,
  "1": 1,
  "1er": 1,
  "1ro": 1,
  "1ra": 1,
  segundo: 2,
  segunda: 2,
  "2": 2,
  "2do": 2,
  "2da": 2,
  tercer: 3,
  tercero: 3,
  tercera: 3,
  "3": 3,
  "3er": 3,
  "3ro": 3,
  "3ra": 3,
  cuarto: 4,
  cuarta: 4,
  "4": 4,
  "4to": 4,
  "4ta": 4,
  ultimo: -1,
  ultima: -1,
};

/** Festivos del calendario que caen en un mes/año dado, en orden ascendente. */
function holidaysInMonth(year: number, month: number): string[] {
  const out: string[] = [];
  for (const ymd of CO_PUBLIC_HOLIDAYS) {
    const [y, m] = ymd.split("-").map((x) => parseInt(x, 10));
    if (y === year && m === month) out.push(ymd);
  }
  return out.sort();
}

/**
 * Dado un festivo (YMD), calcula el rango del PUENTE que genera:
 *  - Festivo en lunes  → puente Sáb-Dom-Lun: entrada sábado, salida lunes (2 noches).
 *  - Festivo en viernes → puente Vie-Sáb-Dom: entrada viernes, salida domingo (2 noches).
 *  - Festivo en otro día → no genera puente estándar → null.
 */
function puenteRangeForHoliday(
  ymd: string,
): { checkIn: string; checkOut: string } | null {
  const [y, m, d] = ymd.split("-").map((x) => parseInt(x, 10));
  const holidayMs = bogotaWallClockNoon(y, m, d).getTime();
  const weekday = bogotaWeekdayShort(holidayMs);
  if (weekday === "Mon") {
    const sat = new Date(holidayMs);
    sat.setDate(sat.getDate() - 2);
    return { checkIn: toYmdColombia(sat.getTime()), checkOut: ymd };
  }
  if (weekday === "Fri") {
    const sun = new Date(holidayMs);
    sun.setDate(sun.getDate() + 2);
    return { checkIn: ymd, checkOut: toYmdColombia(sun.getTime()) };
  }
  return null;
}

/**
 * Resuelve "el N-ésimo puente de [mes] [año]" a un rango de fechas concreto.
 * Devuelve null si no hay tal puente (mes sin festivos que generen puente,
 * u ordinal fuera de rango).
 */
export function resolvePuenteRangeForMonth(
  year: number,
  month: number,
  ordinal: number,
): { checkIn: string; checkOut: string } | null {
  const holidays = holidaysInMonth(year, month);
  const puentes: Array<{ checkIn: string; checkOut: string }> = [];
  for (const h of holidays) {
    const range = puenteRangeForHoliday(h);
    if (range) puentes.push(range);
  }
  if (puentes.length === 0) return null;
  const idx = ordinal === -1 ? puentes.length - 1 : ordinal - 1;
  if (idx < 0 || idx >= puentes.length) return null;
  return puentes[idx];
}

/**
 * Detecta en el texto del cliente una referencia tipo "segundo puente de
 * agosto" / "el primer puente de octubre" / "puente de junio" (sin ordinal →
 * asume el primero) y la resuelve a fechas concretas usando el calendario.
 *
 * `nowMs`: timestamp actual (para decidir el año — si el mes pedido ya pasó
 * este año, se asume el próximo).
 *
 * Devuelve `{ checkIn, checkOut }` en YMD, o null si no detecta nada o no
 * hay puente.
 */
export function detectPuenteReference(
  text: string,
  nowMs: number,
): { checkIn: string; checkOut: string } | null {
  const t = String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  // "(ordinal)? puente (de|del)? (mes)" — acepta también las abreviaturas
  // "pte" / "pt" que los clientes usan al escribir rápido por WhatsApp
  // (ej. "segundo pt de agosto"). El \b a ambos lados de la abreviatura
  // evita falsos positivos dentro de otra palabra (ej. "sept").
  const m = t.match(
    /\b(primer[oa]?|segund[oa]|tercer[oa]?|cuart[oa]|ultim[oa]|1er|1ro|1ra|2do|2da|3er|3ro|3ra|4to|4ta|[1-4])?\s*\b(?:puentes?|ptes?|pts?)\b\s+(?:de\s+|del\s+)?(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b/,
  );
  if (!m) return null;
  const ordinalRaw = (m[1] ?? "primer").trim();
  const monthRaw = m[2];
  const ordinal = ORDINAL_MAP[ordinalRaw] ?? 1;
  const month = MONTH_NAMES_ES[monthRaw];
  if (!month) return null;

  // Año: si el mes pedido ya pasó (o es el mes actual), asumir el próximo año.
  const nowYmd = toYmdColombia(nowMs);
  const [nowY, nowM] = nowYmd.split("-").map((x) => parseInt(x, 10));
  let year = nowY;
  if (month < nowM) year = nowY + 1;

  let range = resolvePuenteRangeForMonth(year, month, ordinal);
  // Si para el año calculado no hay calendario (o el puente ya pasó), probar
  // el siguiente año.
  if (!range) {
    range = resolvePuenteRangeForMonth(year + 1, month, ordinal);
  }
  return range;
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

const WEEKDAYS_ES = [
  "domingo",
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
  "sábado",
];
const MONTHS_LABEL_ES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

/** "2026-06-15" → "lunes 15 de junio" (día de la semana en calendario Bogotá). */
function ymdToHumanLongEs(ymd: string): string {
  const [y, m, d] = ymd.split("-").map((x) => parseInt(x, 10));
  if (!y || !m || !d) return ymd;
  const ms = bogotaWallClockNoon(y, m, d).getTime();
  const wdIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
    bogotaWeekdayShort(ms),
  );
  const wd = wdIndex >= 0 ? WEEKDAYS_ES[wdIndex] : "";
  const month = MONTHS_LABEL_ES[m - 1] ?? "";
  return `${wd} ${d} de ${month}`.trim();
}

/**
 * Busca el festivo dentro de la ventana del puente — el conjunto
 * `{checkIn-1, checkIn, checkOut, checkOut+1}` — para poder nombrarlo en los
 * mensajes. Devuelve el YMD del festivo, o `null` si no encuentra ninguno
 * (caso de festivo regional / mención explícita sin festivo del calendario).
 */
function findHolidayInPuenteWindow(
  checkIn: string,
  checkOut: string,
): string | null {
  const ONE_DAY_MS = 86_400_000;
  const seen = new Set<string>();
  for (const ymd of [checkIn, checkOut]) {
    const [y, m, d] = ymd.split("-").map((x) => parseInt(x, 10));
    if (!y || !m || !d) continue;
    const base = bogotaWallClockNoon(y, m, d).getTime();
    for (const cand of [
      toYmdColombia(base - ONE_DAY_MS),
      ymd,
      toYmdColombia(base + ONE_DAY_MS),
    ]) {
      if (seen.has(cand)) continue;
      seen.add(cand);
      if (isColombiaPublicHolidayYmd(cand)) return cand;
    }
  }
  return null;
}

/**
 * Primer aviso (puente / 1 noche). Mensaje AUTOEXPLICATIVO: nombra la fecha
 * festiva concreta y explica qué es un "puente" — así el cliente entiende de
 * una sin tener que preguntar "¿cómo así que un puente festivo?".
 *
 * Antes el copy decía "corresponden a un fin de semana con puente festivo" de
 * forma genérica; era confuso (un festivo en lunes NO es "fin de semana") y no
 * decía cuál fecha era el festivo.
 */
export function buildPuenteShortNoticeEs(
  checkIn: string,
  checkOut: string,
): string {
  const holidayYmd = findHolidayInPuenteWindow(checkIn, checkOut);
  const dateLine = holidayYmd
    ? `📅 El *${ymdToHumanLongEs(holidayYmd)}* es festivo en Colombia, así que esas fechas corresponden a un *puente festivo*.`
    : "📅 Las fechas que elegiste corresponden a un *puente festivo*.";
  return [
    "¡Con mucho gusto te ayudamos! 😊",
    "",
    dateLine,
    "",
    "Para los puentes festivos, la estancia mínima de reserva es de *2 noches* ✅",
    "",
    "📅 Cuéntanos qué *fecha de salida* prefieres para completar las 2 noches y te compartimos el catálogo con las mejores opciones 🏡✨",
  ].join("\n");
}

/**
 * Explicación cuando el cliente pregunta literalmente "¿cómo así que un puente
 * festivo?" / "¿qué es eso?". Mismo fondo que el aviso corto pero redactado
 * como respuesta a una duda (más conversacional).
 */
export function buildPuenteExplanationEs(
  checkIn: string,
  checkOut: string,
): string {
  const holidayYmd = findHolidayInPuenteWindow(checkIn, checkOut);
  const dateLine = holidayYmd
    ? `📅 El *${ymdToHumanLongEs(holidayYmd)}* es *festivo* en Colombia.`
    : "📅 Las fechas que elegiste incluyen un *día festivo* en Colombia.";
  return [
    "¡Claro, con gusto te explicamos! 😊",
    "",
    dateLine,
    "Cuando un festivo cae junto al fin de semana se forma un *puente festivo*.",
    "",
    "Para los puentes festivos, la estancia mínima de reserva es de *2 noches* ✅",
    "",
    "📅 Indícanos una *fecha de salida* que sume al menos 2 noches y te compartimos las mejores opciones 🏡✨",
  ].join("\n");
}

/**
 * Seguimiento cuando el cliente insiste en 1 noche u otras fechas (mismo tema,
 * otro redactado). Nombra el festivo concreto si lo encuentra en la ventana.
 */
export function buildPuenteFollowUpConversationEs(
  checkIn: string,
  checkOut: string,
): string {
  const holidayYmd = findHolidayInPuenteWindow(checkIn, checkOut);
  const ref = holidayYmd
    ? ` (el *${ymdToHumanLongEs(holidayYmd)}* es festivo)`
    : "";
  return (
    `¡Claro que sí! 😊 Para *una sola noche*${ref} te recomendamos fechas entre semana ` +
    "o un fin de semana regular. Cuéntanos qué *fechas* prefieres y con gusto te compartimos las opciones 📅🏡"
  );
}

/**
 * Recordatorio CORTO de puente: se emite a partir del 2º turno con el bloqueo
 * activo (el cliente ya vio el aviso completo y aún no extendió las fechas).
 * Evita repetir el aviso largo pero MANTIENE el bloqueo duro — el FSM no
 * progresa al catálogo hasta que las fechas sumen 2+ noches.
 */
export function buildPuenteShortReminderEs(
  checkIn: string,
  checkOut: string,
): string {
  const holidayYmd = findHolidayInPuenteWindow(checkIn, checkOut);
  const ref = holidayYmd
    ? `el *${ymdToHumanLongEs(holidayYmd)}* es festivo`
    : "esas fechas corresponden a puente festivo";
  return [
    `Ten presente que ${ref} y la estancia mínima en puente es de *2 noches* ✅`,
    "",
    "📅 Indícanos una *fecha de salida* que sume al menos 2 noches y te compartimos el catálogo 🏡✨",
  ].join("\n");
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
