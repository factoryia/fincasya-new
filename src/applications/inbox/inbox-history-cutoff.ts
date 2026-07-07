/** Zona horaria del equipo FincasYa (Colombia, UTC-5 sin DST). */
export const INBOX_HISTORY_TIMEZONE = 'America/Bogota';

export const INBOX_VISIBLE_HISTORY_DAYS = 7;

/** Medianoche de hoy en Colombia, en ms UTC. */
export function inboxStartOfTodayMs(now = Date.now()): number {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: INBOX_HISTORY_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(now));
  return new Date(`${ymd}T00:00:00-05:00`).getTime();
}

export function inboxHistorySinceMs(
  now = Date.now(),
  days = INBOX_VISIBLE_HISTORY_DAYS,
): number {
  const startToday = inboxStartOfTodayMs(now);
  const span = Math.max(1, Math.floor(days));
  return startToday - (span - 1) * 24 * 60 * 60 * 1000;
}
