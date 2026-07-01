/** Ventana de edición de la lista de invitados antes de la llegada. */
export const GUEST_LIST_LOCK_HOURS_DEFAULT = 24;
export const GUEST_LIST_LOCK_HOURS_ONE_NIGHT = 12;

const HOUR_MS = 60 * 60 * 1000;
const BOGOTA_OFFSET_MS = 5 * HOUR_MS;

type GuestLike = {
  nombreCompleto?: string;
  cedula?: string;
  tipoDocumento?: string;
  esMenor?: boolean;
};

/** Noches calendario en hora Colombia (UTC-5), ignorando las horas del timestamp. */
export function calendarNights(fechaEntrada: number, fechaSalida: number): number {
  const DAY = 24 * HOUR_MS;
  const dayIndex = (ms: number) =>
    Math.floor((ms - BOGOTA_OFFSET_MS) / DAY);
  return Math.max(1, dayIndex(fechaSalida) - dayIndex(fechaEntrada));
}

/** Horas de anticipación con las que se bloquea la lista (12 h si es de un día a otro). */
export function guestListLockHours(
  fechaEntrada: number,
  fechaSalida: number,
): number {
  return calendarNights(fechaEntrada, fechaSalida) === 1
    ? GUEST_LIST_LOCK_HOURS_ONE_NIGHT
    : GUEST_LIST_LOCK_HOURS_DEFAULT;
}

function parseHourMinute(horaEntrada?: string | null): { h: number; m: number } {
  const raw = String(horaEntrada ?? '').trim();
  if (!raw) return { h: 15, m: 0 };

  const m24 = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (m24) {
    return {
      h: Math.min(23, Math.max(0, parseInt(m24[1], 10))),
      m: Math.min(59, Math.max(0, parseInt(m24[2], 10))),
    };
  }

  const m12 = raw.match(/^(\d{1,2}):(\d{2})\s*(am|pm|a\.?\s*m\.?|p\.?\s*m\.?)$/i);
  if (m12) {
    let h = parseInt(m12[1], 10) % 12;
    if (/p/i.test(m12[3])) h += 12;
    return { h, m: Math.min(59, Math.max(0, parseInt(m12[2], 10))) };
  }

  return { h: 15, m: 0 };
}

/** Timestamp de llegada en ms (fecha + hora de ingreso, zona Bogotá). */
export function arrivalTimestampMs(
  fechaEntrada: number,
  horaEntrada?: string | null,
): number {
  const DAY = 24 * HOUR_MS;
  const dayIndex = Math.floor((fechaEntrada - BOGOTA_OFFSET_MS) / DAY);
  const dayStartUtc = dayIndex * DAY + BOGOTA_OFFSET_MS;
  const { h, m } = parseHourMinute(horaEntrada);
  return dayStartUtc + h * HOUR_MS + m * 60 * 1000;
}

/** Timestamp de salida en ms (fecha + hora de entrega, zona Bogotá). */
export function departureTimestampMs(
  fechaSalida: number,
  horaSalida?: string | null,
): number {
  const DAY = 24 * HOUR_MS;
  const dayIndex = Math.floor((fechaSalida - BOGOTA_OFFSET_MS) / DAY);
  const dayStartUtc = dayIndex * DAY + BOGOTA_OFFSET_MS;
  const raw = String(horaSalida ?? '').trim();
  const { h, m } = raw
    ? parseHourMinute(horaSalida)
    : { h: 16, m: 0 };
  return dayStartUtc + h * HOUR_MS + m * 60 * 1000;
}

/** Tras la hora de salida el portal de check-in ya no admite cambios. */
export function isCheckinPortalClosed(
  fechaSalida: number,
  horaSalida?: string | null,
  now = Date.now(),
): boolean {
  return now >= departureTimestampMs(fechaSalida, horaSalida);
}

export function guestListLockAtMs(
  fechaEntrada: number,
  fechaSalida: number,
  horaEntrada?: string | null,
): number {
  const arrival = arrivalTimestampMs(fechaEntrada, horaEntrada);
  const hours = guestListLockHours(fechaEntrada, fechaSalida);
  return arrival - hours * HOUR_MS;
}

export function isGuestListLocked(
  fechaEntrada: number,
  fechaSalida: number,
  horaEntrada?: string | null,
  now = Date.now(),
): boolean {
  return now >= guestListLockAtMs(fechaEntrada, fechaSalida, horaEntrada);
}

function normalizeGuestKey(g: GuestLike): string {
  const docType = String(g.tipoDocumento ?? 'CC').trim().toUpperCase() || 'CC';
  return [
    String(g.nombreCompleto ?? '').trim().toLowerCase(),
    g.esMenor ? 'menor' : String(g.cedula ?? '').trim(),
    g.esMenor ? '' : docType,
  ].join('|');
}

/** Compara listas ignorando orden y filas vacías. */
export function guestListsEqual(a: GuestLike[], b: GuestLike[]): boolean {
  const norm = (list: GuestLike[]) =>
    list
      .filter((g) => g.nombreCompleto?.trim() || g.cedula?.trim() || g.esMenor)
      .map(normalizeGuestKey)
      .sort();
  const left = norm(a);
  const right = norm(b);
  if (left.length !== right.length) return false;
  return left.every((v, i) => v === right[i]);
}

/**
 * Si la lista ya no puede editarse y los invitados cambiaron, devuelve
 * `guest_list_locked`. Si solo cambian otros campos del check-in, permite.
 */
export function assertGuestListEditable(
  booking: {
    fechaEntrada: number;
    fechaSalida: number;
    horaEntrada?: string | null;
    checkinGuests?: GuestLike[] | null;
    guestListUnlocked?: boolean | null;
  },
  incomingGuests: GuestLike[],
  now = Date.now(),
): 'guest_list_locked' | null {
  // Override manual del equipo: si está desbloqueada, se permite editar.
  if (booking.guestListUnlocked) return null;
  if (
    !isGuestListLocked(
      booking.fechaEntrada,
      booking.fechaSalida,
      booking.horaEntrada,
      now,
    )
  ) {
    return null;
  }
  const existing = (booking.checkinGuests ?? []) as GuestLike[];
  if (guestListsEqual(existing, incomingGuests)) return null;
  return 'guest_list_locked';
}

export function guestListLockInfo(
  fechaEntrada: number,
  fechaSalida: number,
  horaEntrada?: string | null,
  now = Date.now(),
  unlocked?: boolean | null,
) {
  const lockHours = guestListLockHours(fechaEntrada, fechaSalida);
  const lockAt = guestListLockAtMs(fechaEntrada, fechaSalida, horaEntrada);
  return {
    // El override del equipo levanta el bloqueo aunque ya esté en la ventana.
    guestListLocked: !unlocked && now >= lockAt,
    guestListLockHours: lockHours,
    guestListLockAt: lockAt,
  };
}
