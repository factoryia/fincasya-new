/**
 * Personas usadas para comparar el cupo del cliente vs la finca en catálogo / búsquedas.
 * - Descanso (o sin flag de evento): `capacity` (hospedaje).
 * - Evento: si la finca permite eventos y tiene `eventCapacity`, el máximo entre hospedaje y evento;
 *   si no hay `eventCapacity`, sigue siendo solo `capacity`.
 */
export function catalogPeopleCountForFilter(
  p: {
    capacity: number;
    eventCapacity?: number | null;
    allowsEventsContent?: boolean | null;
  },
  clientWantsEvento: boolean | undefined,
): number {
  const base = Math.max(0, Number(p.capacity) || 0);
  if (clientWantsEvento !== true || p.allowsEventsContent !== true) return base;
  const ev = p.eventCapacity;
  if (ev == null || !Number.isFinite(Number(ev)) || Number(ev) <= 0) return base;
  return Math.max(base, Number(ev));
}
