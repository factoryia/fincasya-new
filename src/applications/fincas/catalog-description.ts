/** Característica para descripción de catálogo Meta/WhatsApp. */
export type CatalogFeatureInput = {
  name?: string;
  label?: string;
  emoji?: string | null;
  quantity?: number;
};

const DEFAULT_FEATURE_EMOJI = '✅';
const NUMBERED_ITEM = /^\d+\.\s*(.+)$/;
const CATALOG_URL_LINE =
  /^\s*https?:\/\/[^\s]*(?:fincasya\.com|fincasya\.cloud)[^\s]*\s*$/i;

/** Palabras clave → emoji cuando la iconografía no tiene emoji asignado. */
const FEATURE_EMOJI_KEYWORDS: Array<[RegExp, string]> = [
  [/\bPISCINA\b/, '🏊'],
  [/\bJACUZZI\b/, '🛁'],
  [/\bBAÑO\b|\bBANO\b|\bBAÑOS\b|\bBANOS\b/, '🚽'],
  [/\bHABITACION\b|\bHABITACIÓN\b|\bDORMITORIO\b/, '🛏️'],
  [/\bCAMA\b/, '🛏️'],
  [/\bPARQUEADERO\b|\bGARAGE\b|\bESTACIONAMIENTO\b/, '🅿️'],
  [/\bASADOR\b|\bBBQ\b|\bPARRILLA\b|\bASADO\b/, '🥩'],
  [/\bCOCINA\b/, '🍽️'],
  [/\bZONAS?\s+VERDES?\b|\bJARDIN\b|\bJARDÍN\b/, '🌳'],
  [/\bBILLAR\b/, '🎱'],
  [/\bAIRE\s+ACONDICIONADO\b|\bA\/C\b/, '❄️'],
  [/\bVENTILADOR\b/, '💨'],
  [/\bTV\b|\bTELEVISOR\b|\bSMART\s*TV\b/, '📺'],
  [/\bWIFI\b|\bWI-?FI\b/, '📶'],
  [/\bCANCHA\b|\bFUTBOL\b|\bFÚTBOL\b/, '⚽'],
  [/\bFUTBOLIN\b|\bFUTBOLÍN\b|\bTENIS\s+DE\s+MESA\b|\bPING\s+PONG\b/, '🏓'],
  [/\bCHIMENEA\b/, '🔥'],
  [/\bHORNO\b/, '🍕'],
  [/\bSALA\b|\bCOMEDOR\b/, '🛋️'],
  [/\bSONIDO\b|\bBOSE\b|\bAUDIO\b/, '🔊'],
  [/\bEVENTO\b|\bFIESTA\b/, '🎉'],
  [/\bMASCOTA\b|\bPET\b/, '🐾'],
];

export function inferEmojiForFeatureName(name: string): string {
  const upper = name.toUpperCase();
  for (const [pattern, emoji] of FEATURE_EMOJI_KEYWORDS) {
    if (pattern.test(upper)) return emoji;
  }
  return DEFAULT_FEATURE_EMOJI;
}

/** Separa listas numeradas pegadas: "1. A2. B" → líneas distintas. */
export function expandDenseNumberedList(text: string): string {
  if (!/\d+\.\s*/.test(text)) return text;
  return text.replace(/([^\n])(?=\d+\.\s*)/g, '$1\n');
}

function featureName(f: unknown): string {
  if (typeof f === 'string') return f.trim();
  const o = f as CatalogFeatureInput;
  return (o.name ?? o.label ?? '').trim();
}

function featureEmoji(f: unknown): string | null {
  if (!f || typeof f !== 'object') return null;
  const e = (f as CatalogFeatureInput).emoji;
  return typeof e === 'string' && e.trim() ? e.trim() : null;
}

function featureQuantity(f: unknown): number {
  if (!f || typeof f !== 'object') return 1;
  const q = (f as CatalogFeatureInput).quantity;
  return q != null ? Math.max(1, Number(q) || 1) : 1;
}

function parseQuantitySuffix(text: string): { name: string; count: number } {
  const m = text.match(/^(.+?)\s*\(x(\d+)\)\s*$/i);
  if (m) {
    return { name: m[1].trim(), count: Math.max(1, parseInt(m[2], 10) || 1) };
  }
  const leading = text.match(/^(\d{1,2})\s+(.+)$/);
  if (leading) {
    const n = parseInt(leading[1], 10);
    if (n >= 2 && n <= 99) {
      return { name: leading[2].trim(), count: n };
    }
  }
  return { name: text.trim(), count: 1 };
}

export function aggregateFeaturesForCatalog(
  features: unknown[],
): Array<{ name: string; count: number; emoji: string }> {
  if (!features?.length) return [];

  const map = new Map<string, { name: string; count: number; emoji: string }>();

  for (const f of features) {
    const raw = featureName(f);
    if (!raw) continue;
    const key = raw.toUpperCase();
    const qty = featureQuantity(f);
    const emoji =
      featureEmoji(f) ?? inferEmojiForFeatureName(raw);
    const prev = map.get(key);
    if (prev) {
      prev.count += qty;
      if (prev.emoji === DEFAULT_FEATURE_EMOJI && emoji !== DEFAULT_FEATURE_EMOJI) {
        prev.emoji = emoji;
      }
    } else {
      map.set(key, { name: raw, count: qty, emoji });
    }
  }

  return Array.from(map.values());
}

/** Lista vertical solo con emoji (sin números). */
export function formatFincaFeaturesForCatalog(features: unknown[]): string {
  const items = aggregateFeaturesForCatalog(features);
  if (!items.length) return '';

  return items
    .map(({ name, count, emoji }) => {
      const suffix = count > 1 ? ` (x${count})` : '';
      return `${emoji} ${name}${suffix}`;
    })
    .join('\n');
}

function formatExtractedFeatureLines(names: string[]): string {
  if (!names.length) return '';
  const map = new Map<string, { name: string; count: number; emoji: string }>();

  for (const raw of names) {
    const { name, count } = parseQuantitySuffix(raw);
    if (!name) continue;
    const key = name.toUpperCase();
    const emoji = inferEmojiForFeatureName(name);
    const prev = map.get(key);
    if (prev) {
      prev.count += count;
    } else {
      map.set(key, { name, count, emoji });
    }
  }

  return Array.from(map.values())
    .map(({ name, count, emoji }) => {
      const suffix = count > 1 ? ` (x${count})` : '';
      return `${emoji} ${name}${suffix}`;
    })
    .join('\n');
}

export function stripNumberedListFromDescription(description: string): {
  text: string;
  extractedNames: string[];
} {
  const normalized = expandDenseNumberedList(
    (description ?? '').replace(/<[^>]*>/g, ''),
  );
  const lines = normalized.replace(/\r\n?/g, '\n').split('\n');
  const extractedNames: string[] = [];
  const kept: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      kept.push(line);
      continue;
    }
    if (CATALOG_URL_LINE.test(trimmed)) {
      continue;
    }
    const numbered = trimmed.match(NUMBERED_ITEM);
    if (numbered) {
      extractedNames.push(numbered[1].trim());
      continue;
    }
    kept.push(line);
  }

  const text = kept
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();

  return { text, extractedNames };
}

export function stripEmbeddedFeaturesBlock(description: string): string {
  return stripNumberedListFromDescription(description).text;
}

export function buildCatalogProductDescription(
  description: string | undefined,
  features: unknown[] | undefined,
): string {
  const { text: base, extractedNames } = stripNumberedListFromDescription(
    description ?? '',
  );

  let featuresBlock = formatFincaFeaturesForCatalog(features ?? []);
  if (!featuresBlock && extractedNames.length > 0) {
    featuresBlock = formatExtractedFeatureLines(extractedNames);
  }

  if (!featuresBlock) return base;
  if (!base) return featuresBlock;
  return `${base}\n\n${featuresBlock}`;
}
