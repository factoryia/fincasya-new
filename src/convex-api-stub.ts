/**
 * Stub para que el build de Nest no arrastre la carpeta convex/ (y sus deps como @convex-dev/better-auth).
 * En runtime se carga el API real desde convex/_generated/api.
 */
import * as path from 'path';

const generatedPath = path.join(__dirname, '../convex/_generated/api');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const generated = require(generatedPath);
export const api = generated.api ?? generated;
