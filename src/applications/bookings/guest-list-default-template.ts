import { promises as fs } from 'fs';
import * as path from 'path';

export const DEFAULT_GUEST_LIST_TEMPLATE_FILENAME =
  'default-guest-list-template.docx';

function candidatePaths(): string[] {
  const cwd = process.cwd();
  const envPath = process.env.DEFAULT_GUEST_LIST_DOCX_PATH?.trim();
  const contractsDir = path.join(cwd, 'assets', 'contracts');
  return [
    envPath,
    path.join(contractsDir, DEFAULT_GUEST_LIST_TEMPLATE_FILENAME),
    path.join(contractsDir, 'Doc1.docx'),
    path.join(cwd, 'docs', DEFAULT_GUEST_LIST_TEMPLATE_FILENAME),
  ].filter((p): p is string => Boolean(p?.trim()));
}

/** Carga la plantilla Word de lista de invitados (logo + encabezado de Doc1). */
export async function loadDefaultGuestListTemplateBytes(): Promise<Buffer | null> {
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
