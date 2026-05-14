/**
 * Personas usadas para comparar el cupo del cliente vs la finca en catálogo / búsquedas.
 *   - Descanso (o sin flag de evento): `capacity` (hospedaje).
 *   - Evento: si la finca NO está explícitamente bloqueada para eventos
 *     (`allowsEventsContent !== false`) Y tiene `eventCapacity > 0`, devuelve
 *     `max(capacity, eventCapacity)`. Esto deja pasar fincas con menos camas
 *     pero gran salón de eventos, incluso si el flag `allowsEventsContent`
 *     no está marcado explícitamente como `true` en BD (caso común cuando se
 *     configura `eventCapacity` sin tocar el toggle).
 *
 * Notas:
 * - `matchesEvento` (en `whatsappCatalogs.ts`) sigue descartando fincas con
 *   `allowsEventsContent === false`, así que aquí no necesitamos volver a
 *   filtrar — solo usar la capacidad correcta.
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
  if (clientWantsEvento !== true) return base;
  if (p.allowsEventsContent === false) return base;
  const ev = p.eventCapacity;
  if (ev == null || !Number.isFinite(Number(ev)) || Number(ev) <= 0) return base;
  return Math.max(base, Number(ev));
}
