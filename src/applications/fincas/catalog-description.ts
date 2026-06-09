/** Característica para descripción de catálogo Meta/WhatsApp. */
export type CatalogFeatureInput = {
  name?: string;
  label?: string;
  emoji?: string | null;
  quantity?: number;
  /** Zona/sección a la que pertenece (ej. "GENERAL", "HABITACIÓN 01"). */
  zone?: string | null;
};

const DEFAULT_ZONE = 'General';

function featureZone(f: unknown): string {
  if (!f || typeof f !== 'object') return DEFAULT_ZONE;
  const z = (f as CatalogFeatureInput).zone;
  return typeof z === 'string' && z.trim() ? z.trim() : DEFAULT_ZONE;
}

const DEFAULT_FEATURE_EMOJI = '✅';
/** Lista 1. PISCINA — no confundir con montos COP ($300.000). */
const NUMBERED_ITEM = /^\d+\.\s*([A-Za-zÁÉÍÓÚÜÑáéíóúüñ].*)$/;
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

/** Separa listas numeradas pegadas: "1. PISCINA2. JACUZZI" → líneas (no rompe $300.000). */
export function expandDenseNumberedList(text: string): string {
  if (!/\d+\.\s*[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(text)) return text;
  return text.replace(
    /([^\n])(?=\d+\.\s*[A-Za-zÁÉÍÓÚÜÑáéíóúüñ])/g,
    '$1\n',
  );
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

/** Quita prefijo numérico (01–99) y sufijo «(xN)» del nombre guardado. */
function featureNameWithoutQuantity(name: string): string {
  let text = name.trim();
  const suffix = text.match(/^(.+?)\s*\([×x]\s*(\d+)\)\s*$/i);
  if (suffix) text = suffix[1].trim();
  const leading = text.match(/^(\d{1,2})\s+(.+)$/);
  if (leading) {
    const n = parseInt(leading[1], 10);
    if (n >= 1 && n <= 99) return leading[2].trim();
  }
  return text;
}

/**
 * Lista vertical con emoji. Si cantidad > 1, antepone el número con dos dígitos
 * (ej. "04 HABITACIONES"), igual que el detalle de la web — en vez de "(x4)".
 */
export function formatFincaFeaturesForCatalog(features: unknown[]): string {
  const items = aggregateFeaturesForCatalog(features);
  if (!items.length) return '';

  return items
    .map(({ name, count, emoji }) => {
      const base = featureNameWithoutQuantity(name);
      const label = count > 1 ? `${String(count).padStart(2, '0')} ${base}` : base;
      return `${emoji} ${label}`;
    })
    .join('\n');
}

/**
 * Lista agrupada por zona/habitación, respetando `zoneOrder`. Cada zona lleva
 * encabezado y debajo sus amenidades (igual que el detalle de la web).
 */
export function formatFincaFeaturesByZone(
  features: unknown[],
  zoneOrder?: string[],
): string {
  if (!features?.length) return '';

  // Agrupar features por zona.
  const byZone = new Map<string, unknown[]>();
  for (const f of features) {
    if (!featureName(f)) continue;
    const zone = featureZone(f);
    const list = byZone.get(zone);
    if (list) list.push(f);
    else byZone.set(zone, [f]);
  }
  if (byZone.size === 0) return '';

  // Si solo hay una zona y es la General, no ponemos encabezado (lista simple).
  if (byZone.size === 1 && byZone.has(DEFAULT_ZONE)) {
    return formatFincaFeaturesForCatalog(byZone.get(DEFAULT_ZONE)!);
  }

  // Ordenar zonas: primero zoneOrder, luego General arriba del resto, resto alfabético.
  const present = Array.from(byZone.keys());
  const ordered: string[] = [];
  for (const z of zoneOrder ?? []) {
    if (byZone.has(z) && !ordered.includes(z)) ordered.push(z);
  }
  const rest = present
    .filter((z) => !ordered.includes(z))
    .sort((a, b) => {
      if (a === DEFAULT_ZONE) return -1;
      if (b === DEFAULT_ZONE) return 1;
      return a.localeCompare(b, 'es');
    });
  const finalZones = [...ordered, ...rest];

  const blocks: string[] = [];
  for (const zone of finalZones) {
    const lines = formatFincaFeaturesForCatalog(byZone.get(zone) ?? []);
    if (!lines) continue;
    blocks.push(`*${zone.toUpperCase()}*\n${lines}`);
  }
  return blocks.join('\n\n');
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
      const base = featureNameWithoutQuantity(name);
      const label = count > 1 ? `${String(count).padStart(2, '0')} ${base}` : base;
      return `${emoji} ${label}`;
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
  zoneOrder?: string[],
): string {
  const { text: base, extractedNames } = stripNumberedListFromDescription(
    description ?? '',
  );

  // Agrupado por zona/habitación (igual que el detalle de la web).
  let featuresBlock = formatFincaFeaturesByZone(features ?? [], zoneOrder);
  if (!featuresBlock && extractedNames.length > 0) {
    featuresBlock = formatExtractedFeatureLines(extractedNames);
  }

  if (!featuresBlock) return base;
  if (!base) return featuresBlock;
  return `${base}\n\n${featuresBlock}`;
}
