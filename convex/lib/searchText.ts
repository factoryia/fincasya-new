/** Minúsculas sin diacríticos para búsqueda insensible a tildes. */
export function normalizeSearchText(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ñ/g, 'n')
    .replace(/\u00a0/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Comparación `includes` insensible a mayúsculas y tildes. */
export function normalizedIncludes(haystack: string, query: string): boolean {
  const h = normalizeSearchText(haystack);
  const q = normalizeSearchText(query);
  if (!q) return true;
  return h.includes(q);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function containsWholeSearchToken(
  haystack: string,
  token: string,
): boolean {
  if (!token) return false;
  const pattern = new RegExp(
    `(?:^|[^a-z0-9])${escapeRegex(token)}(?:$|[^a-z0-9])`,
    'i',
  );
  return pattern.test(` ${haystack} `);
}

function haystackMatchesNormalizedQuery(haystack: string, q: string): boolean {
  if (!haystack || !q) return false;
  if (haystack.includes(q)) return true;
  if (q.length >= 3) {
    return haystack.split(/\s+/).some((word) => word.startsWith(q));
  }
  return false;
}

export function textMatchesSearchTerm(haystack: string, term: string): boolean {
  const h = normalizeSearchText(haystack);
  const t = normalizeSearchText(term);
  if (!t) return false;
  if (haystackMatchesNormalizedQuery(h, t)) return true;
  return containsWholeSearchToken(h, t);
}

/** Extrae números de cupo de la consulta (ej. "15", "15 pax", "tocaima 15 personas"). */
export function parseCapacitySearchParts(query: string): {
  capacityTargets: number[];
  textTerms: string[];
} {
  const input = normalizeSearchText(query).replace(/[^a-z0-9\s]/g, ' ');

  const capacityTargets: number[] = [];
  let remaining = ` ${input.replace(/\s+/g, ' ').trim()} `;

  const labeledPatterns = [
    /\s(\d{1,3})\s*pax\s/gi,
    /\s(\d{1,3})\s*personas?\s/gi,
  ];
  for (const pattern of labeledPatterns) {
    remaining = remaining.replace(pattern, (_match, digits: string) => {
      const n = Number.parseInt(digits, 10);
      if (Number.isFinite(n) && n > 0) capacityTargets.push(n);
      return ' ';
    });
  }

  const textTerms: string[] = [];
  for (const word of remaining.trim().split(/\s+/).filter(Boolean)) {
    if (/^\d{1,3}$/.test(word)) {
      const n = Number.parseInt(word, 10);
      if (Number.isFinite(n) && n > 0) capacityTargets.push(n);
      continue;
    }
    if (word.length >= 2) textTerms.push(word);
  }

  return {
    capacityTargets: [...new Set(capacityTargets)],
    textTerms,
  };
}

export function propertyMatchesCapacitySearch(
  property: { capacity: number; eventCapacity?: number | null },
  target: number,
): boolean {
  if (property.capacity === target) return true;
  if (property.eventCapacity != null && property.eventCapacity === target) {
    return true;
  }
  return false;
}

export function propertySearchRelevanceScore(
  fields: { title: string; description?: string; location: string; code?: string },
  query: string,
): number {
  const q = normalizeSearchText(query);
  if (!q) return 0;

  const title = normalizeSearchText(fields.title);
  const location = normalizeSearchText(fields.location);
  const code = normalizeSearchText(fields.code ?? '');
  const description = normalizeSearchText(fields.description ?? '');

  let score = 0;

  if (title === q) score += 1000;
  else if (title.startsWith(q)) score += 500;
  else if (title.includes(q)) {
    score += 200 + Math.max(0, 80 - title.indexOf(q));
  }

  if (q.length >= 3) {
    for (const word of title.split(/\s+/)) {
      if (word.startsWith(q)) score += 350;
    }
  }

  const tokens = q.split(/\s+/).filter((w) => w.length >= 2);
  const terms = tokens.length > 0 ? tokens : [q];

  for (const term of terms) {
    if (title.includes(term)) {
      score += 50;
      if (containsWholeSearchToken(title, term)) score += 120;
    }
    if (location.includes(term)) {
      score += 20;
      if (containsWholeSearchToken(location, term)) score += 40;
    }
    if (code.includes(term)) score += 30;
    if (description.includes(term)) score += 5;
  }

  return score;
}
