/**
 * Convex serializes query return values to JSON. Lone UTF-16 surrogates (e.g.
 * after slicing text mid-emoji) break that round-trip with "unexpected end of
 * hex escape". Strip/repair surrogates before returning user-generated strings.
 */
export function jsonSafeString(input: string | undefined | null): string {
  if (!input) return "";
  let out = "";
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = input.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += input[i] + input[i + 1];
        i++;
      }
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) continue;
    out += input[i];
  }
  return out;
}

/** Truncate without splitting a surrogate pair at the cut point. */
export function truncateJsonSafe(text: string, maxLen: number, suffix = "…"): string {
  const safe = jsonSafeString(text);
  if (safe.length <= maxLen) return safe;
  let end = maxLen;
  const prev = safe.charCodeAt(end - 1);
  if (prev >= 0xd800 && prev <= 0xdbff) end--;
  const atEnd = safe.charCodeAt(end);
  if (atEnd >= 0xdc00 && atEnd <= 0xdfff) end--;
  return safe.slice(0, Math.max(0, end)) + suffix;
}
