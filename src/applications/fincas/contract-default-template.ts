import { promises as fs } from 'fs';
import * as path from 'path';

/** Plantilla Word maestra (formato QUINTA OLAYA): solo cambian {{placeholders}}, no estilos. */
export const DEFAULT_CONTRACT_TEMPLATE_FILENAME =
  'default-contract-template.docx';

function candidatePaths(): string[] {
  const cwd = process.cwd();
  const envPath = process.env.DEFAULT_CONTRACT_DOCX_PATH?.trim();
  const list = [
    envPath,
    path.join(cwd, 'assets', 'contracts', DEFAULT_CONTRACT_TEMPLATE_FILENAME),
    path.join(cwd, 'docs', 'QUINTA OLAYA.docx'),
    path.join(cwd, '..', 'fincasya-new', 'docs', 'QUINTA OLAYA.docx'),
    path.join(cwd, '..', 'FincasYaWeb', 'public', 'docs', 'QUINTA OLAYA.docx'),
  ].filter((p): p is string => Boolean(p?.trim()));
  return list;
}

/** Carga la plantilla .docx por defecto si existe en disco. */
export async function loadDefaultContractTemplateBytes(): Promise<Buffer | null> {
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
