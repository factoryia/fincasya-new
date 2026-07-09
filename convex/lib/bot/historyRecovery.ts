/**
 * Recupera fechas desde el historial de mensajes del usuario cuando el extractor
 * no las re-emite en un turno corto ("no sé", "recomiéndame", etc.).
 */

import {
  bogotaWallClockNoon,
  toYmdColombia,
} from "../colombiaPublicHolidays";

const MONTHS: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function bogotaYmdParts(ms: number): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .formatToParts(new Date(ms))
    .reduce<Record<string, string>>((acc, p) => {
      if (p.type !== "literal") acc[p.type] = p.value;
      return acc;
    }, {});
  return {
    y: parseInt(parts.year ?? "2026", 10),
    m: parseInt(parts.month ?? "1", 10),
    d: parseInt(parts.day ?? "1", 10),
  };
}

function toYmd(y: number, month: number, day: number): string {
  return `${y}-${pad(month)}-${pad(day)}`;
}

/**
 * Busca en mensajes del usuario (más reciente primero) un rango tipo
 * "del 17 al 18 de mayo" / "17 al 18 de mayo".
 */
export function recoverDatesFromUserHistory(
  history: Array<{ role: string; content: string }>,
  refMs: number,
): { checkIn?: string; checkOut?: string } {
  const ref = bogotaYmdParts(refMs);
  const userMsgs = [...history].reverse().filter((m) => m.role === "user");

  const re =
    /(?:del\s*)?(\d{1,2})\s*al\s*(\d{1,2})\s*de\s*(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)/i;
  const reSlashRange =
    /(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\s*[-–]\s*(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/;

  for (const m of userMsgs) {
    const t = String(m.content ?? "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{M}/gu, "");

    const slash = t.match(reSlashRange);
    if (slash) {
      const d1 = parseInt(slash[1], 10);
      const m1 = parseInt(slash[2], 10);
      const y1 = parseInt(slash[3], 10);
      const d2 = parseInt(slash[4], 10);
      const m2 = parseInt(slash[5], 10);
      const y2 = parseInt(slash[6], 10);
      if (
        d1 >= 1 &&
        d1 <= 31 &&
        d2 >= 1 &&
        d2 <= 31 &&
        m1 >= 1 &&
        m1 <= 12 &&
        m2 >= 1 &&
        m2 <= 12
      ) {
        const checkIn = toYmd(y1, m1, d1);
        const checkOut = toYmd(y2, m2, d2);
        if (new Date(checkIn) < new Date(checkOut)) {
          return { checkIn, checkOut };
        }
      }
    }

    const match = t.match(re);
    if (!match) continue;

    const d1 = parseInt(match[1], 10);
    const d2 = parseInt(match[2], 10);
    const month = MONTHS[match[3].toLowerCase()];
    if (!month || d1 < 1 || d1 > 31 || d2 < 1 || d2 > 31) continue;

    let year = ref.y;
    if (month < ref.m || (month === ref.m && d1 < ref.d)) {
      year += 1;
    }

    const checkIn = toYmd(year, month, d1);
    const checkOut = toYmd(year, month, d2);
    if (new Date(checkIn) >= new Date(checkOut)) continue;

    return { checkIn, checkOut };
  }

  return {};
}

const WEEKDAY_INDEX: Record<string, number> = {
  domingo: 0,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  miércoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
  sábado: 6,
};

function weekdayIndexFromMs(ms: number): number {
  const short = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Bogota",
    weekday: "short",
  }).format(new Date(ms));
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return map[short] ?? 0;
}

function ymdToMs(ymd: string): number {
  const [y, m, d] = ymd.split("-").map((x) => parseInt(x, 10));
  return bogotaWallClockNoon(y, m, d).getTime();
}

function ymdAddDays(ymd: string, days: number): string {
  return toYmdColombia(ymdToMs(ymd) + days * 86_400_000);
}

/** Próximo día de la semana (check-in mínimo mañana en calendario Bogotá). */
function nextWeekdayYmd(refMs: number, targetWd: number): string {
  const todayYmd = toYmdColombia(refMs);
  for (let add = 1; add <= 14; add++) {
    const ymd = ymdAddDays(todayYmd, add);
    if (weekdayIndexFromMs(ymdToMs(ymd)) === targetWd) return ymd;
  }
  return ymdAddDays(todayYmd, 7);
}

function resolveCheckOutAfterCheckIn(checkIn: string, targetOutWd: number): string {
  const checkInWd = weekdayIndexFromMs(ymdToMs(checkIn));
  let days = (targetOutWd - checkInWd + 7) % 7;
  if (days === 0) days = 7;
  return ymdAddDays(checkIn, days);
}

/**
 * Interpreta fechas relativas coloquiales ("este fin de semana", "entrando el
 * sábado y saliendo el lunes") en zona horaria Colombia.
 */
export function recoverRelativeDatesFromText(
  text: string,
  refMs: number,
): { checkIn?: string; checkOut?: string } {
  const t = String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");

  if (
    /este finde|este fin de semana|para este fin de semana|este finde semana/.test(
      t,
    )
  ) {
    const checkIn = nextWeekdayYmd(refMs, 6);
    return { checkIn, checkOut: ymdAddDays(checkIn, 1) };
  }

  const inOut = t.match(
    /entrando?\s+(?:el\s+)?(lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo).*?(?:saliendo?|salida|salir)\s+(?:el\s+)?(lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo)/,
  );
  if (inOut) {
    const wIn = WEEKDAY_INDEX[inOut[1]];
    const wOut = WEEKDAY_INDEX[inOut[2]];
    if (wIn != null && wOut != null) {
      const checkIn = nextWeekdayYmd(refMs, wIn);
      const checkOut = resolveCheckOutAfterCheckIn(checkIn, wOut);
      return { checkIn, checkOut };
    }
  }

  const rangeWd = t.match(
    /(?:el\s+)?(lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo)\s+(?:al|y|hasta)\s+(?:el\s+)?(lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo)/,
  );
  if (rangeWd) {
    const wIn = WEEKDAY_INDEX[rangeWd[1]];
    const wOut = WEEKDAY_INDEX[rangeWd[2]];
    if (wIn != null && wOut != null) {
      const checkIn = nextWeekdayYmd(refMs, wIn);
      const checkOut = resolveCheckOutAfterCheckIn(checkIn, wOut);
      return { checkIn, checkOut };
    }
  }

  const soloSabado = t.match(/\b(?:este\s+)?(?:el\s+)?(sabado|sábado)\b/);
  if (soloSabado && !inOut && !rangeWd) {
    const checkIn = nextWeekdayYmd(refMs, 6);
    return { checkIn, checkOut: ymdAddDays(checkIn, 1) };
  }

  return {};
}

/** Busca fechas relativas en mensajes recientes del cliente (más nuevo primero). */
export function recoverRelativeDatesFromUserHistory(
  history: Array<{ role: string; content: string }>,
  refMs: number,
): { checkIn?: string; checkOut?: string } {
  for (const m of [...history].reverse()) {
    if (m.role !== "user") continue;
    const found = recoverRelativeDatesFromText(m.content, refMs);
    if (found.checkIn && found.checkOut) return found;
  }
  return {};
}
