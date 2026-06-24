import { promises as fs } from 'fs';
import * as path from 'path';

/** Plantilla Word maestra de confirmación de reserva (formato VILLA TRIANA). */
export const DEFAULT_CONFIRMATION_TEMPLATE_FILENAME =
  'default-confirmation-template.docx';

/** Ejemplo histórico usado como plantilla base antes de normalizar placeholders. */
export const LEGACY_CONFIRMATION_SAMPLE_FILENAMES = [
  'CR 2454 SANDRA PATRICIA SÁNCHEZ, VILLA TRIANA 02 ABRIL 25.docx',
  '2454 SANDRA PATRICIA SÁNCHEZ, VILLA TRIANA 02 ABRIL 25.docx',
];

function candidatePaths(): string[] {
  const cwd = process.cwd();
  const envPath = process.env.DEFAULT_CONFIRMATION_DOCX_PATH?.trim();
  const contractsDir = path.join(cwd, 'assets', 'contracts');
  const legacyPaths = LEGACY_CONFIRMATION_SAMPLE_FILENAMES.map((name) =>
    path.join(contractsDir, name),
  );
  return [
    envPath,
    path.join(contractsDir, DEFAULT_CONFIRMATION_TEMPLATE_FILENAME),
    ...legacyPaths,
    path.join(cwd, 'docs', DEFAULT_CONFIRMATION_TEMPLATE_FILENAME),
  ].filter((p): p is string => Boolean(p?.trim()));
}

/** Carga la plantilla .docx de confirmación si existe en disco. */
export async function loadDefaultConfirmationTemplateBytes(): Promise<Buffer | null> {
  for (const filePath of candidatePaths()) {
    try {
      const buf = await fs.readFile(filePath);
      if (buf.length >= 4 && buf.slice(0, 2).toString() === 'PK') {
        return buf;
      }
    } catch {
      // siguiente candidato
    }
  }
  return null;
}
