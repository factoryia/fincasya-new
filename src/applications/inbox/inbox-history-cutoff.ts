/** Zona horaria del equipo FincasYa (Colombia, UTC-5 sin DST). */
export const INBOX_HISTORY_TIMEZONE = 'America/Bogota';

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
