/**
 * Recupera fechas desde el historial de mensajes del usuario cuando el extractor
 * no las re-emite en un turno corto ("no sé", "recomiéndame", etc.).
 */

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

  for (const m of userMsgs) {
    const t = String(m.content ?? "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{M}/gu, "");
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
