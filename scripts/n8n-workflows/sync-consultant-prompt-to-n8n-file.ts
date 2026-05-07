// @ts-nocheck — script ejecutado con Bun; fuera del include principal de tsc.
/**
 * Regenera el prompt para n8n desde el default del repo:
 * - `fincasya-n8n-consultant-system-prompt.txt` (legible / diff)
 * - `fincasya-n8n-consultant-system-prompt.json` ({ "prompt": "..." }) — lo importa el workflow.js
 *
 * Ejecutar tras cambiar src/lib/consultantPrompt.ts antes de publicar el workflow a n8n.
 */
import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { DEFAULT_CONSULTANT_SYSTEM_PROMPT } from '../../src/lib/consultantPrompt';

const dir = dirname(fileURLToPath(import.meta.url));
const txtPath = join(dir, 'fincasya-n8n-consultant-system-prompt.txt');
const jsonPath = join(dir, 'fincasya-n8n-consultant-system-prompt.json');

writeFileSync(txtPath, DEFAULT_CONSULTANT_SYSTEM_PROMPT, 'utf8');
writeFileSync(
  jsonPath,
  JSON.stringify({ prompt: DEFAULT_CONSULTANT_SYSTEM_PROMPT }),
  'utf8',
);
console.log(`Wrote ${txtPath} (${DEFAULT_CONSULTANT_SYSTEM_PROMPT.length} chars)`);
console.log(`Wrote ${jsonPath} (${JSON.stringify({ prompt: DEFAULT_CONSULTANT_SYSTEM_PROMPT }).length} bytes JSON)`);
