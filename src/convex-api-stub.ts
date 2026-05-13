/**
 * Stub para que el build de Nest no arrastre la carpeta convex/ (y sus deps como @convex-dev/better-auth).
 * En runtime se carga el API real desde convex/_generated/api.
 */
import * as path from 'path';

/** Relativo al JS compilado (`dist/`) o fuente (`src/`) para no depender del cwd al arrancar Nest. */
const generatedPath = path.join(__dirname, '..', 'convex', '_generated', 'api');
let generated: any = { api: {} };

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  generated = require(generatedPath);
} catch (e) {
  console.warn(
    `[api] Warning: Could not load Convex API from ${generatedPath}. Runtime queries may fail.`,
  );
}

export const api = generated.api ?? generated;
