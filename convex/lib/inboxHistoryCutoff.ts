/** Zona horaria del equipo FincasYa (Colombia, UTC-5 sin DST). */
export const INBOX_HISTORY_TIMEZONE = "America/Bogota";

/**
 * Primera fecha visible en el inbox (YYYY-MM-DD, medianoche Colombia).
 * Mensajes/conversaciones anteriores a esta fecha quedan ocultos.
 */
export const INBOX_VISIBLE_SINCE_YMD = "2026-07-06";

/** Medianoche de hoy en Colombia, en ms UTC. */
export function inboxStartOfTodayMs(now = Date.now()): number {
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: INBOX_HISTORY_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now));
  return new Date(`${ymd}T00:00:00-05:00`).getTime();
}

/** Timestamp desde el cual el inbox muestra historial (6 jul 2026 → adelante). */
export function inboxHistorySinceMs(): number {
  return new Date(`${INBOX_VISIBLE_SINCE_YMD}T00:00:00-05:00`).getTime();
}
