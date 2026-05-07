/**
 * Prompt por defecto del consultor (n8n / internal page) y constantes compartidas.
 * Vive en `src/lib` (no en `convex/`) porque Nest usa `fs` y Convex no empaqueta Node ahí.
 *
 * El texto largo está en `scripts/n8n-workflows/fincasya-n8n-consultant-system-prompt.txt`.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/** Debe coincidir con el `pageId` usado en Convex `internalPages` para el prompt editable. */
export const PROMPT_INTERNAL_PAGE_ID = 'consultant-system-prompt';

const MARK_START = '<!-- CONTRACT_SENT_AUTOMATIC_START -->';
const MARK_END = '<!-- CONTRACT_SENT_AUTOMATIC_END -->';

function resolvePackagedPromptPath(): string | null {
  const candidates = [
    join(__dirname, '../../scripts/n8n-workflows/fincasya-n8n-consultant-system-prompt.txt'),
    join(__dirname, '../../../scripts/n8n-workflows/fincasya-n8n-consultant-system-prompt.txt'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

function loadDefaultConsultantPromptText(): string {
  const path = resolvePackagedPromptPath();
  if (!path) {
    return '';
  }
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

export const DEFAULT_CONSULTANT_SYSTEM_PROMPT = loadDefaultConsultantPromptText();

/**
 * Si el prompt en BD o el default incluyen el bloque marcado, devuelve el texto para el mensaje
 * automático tras enviar el contrato desde la API. Si no hay marcas, devuelve null (el caller usa su fallback).
 */
export function extractContractSentAutomaticMessage(prompt: string): string | null {
  if (!prompt || typeof prompt !== 'string') return null;
  const s = prompt.indexOf(MARK_START);
  const e = prompt.indexOf(MARK_END);
  if (s === -1 || e === -1 || e <= s) return null;
  const inner = prompt.slice(s + MARK_START.length, e).trim();
  return inner.length > 0 ? inner : null;
}
