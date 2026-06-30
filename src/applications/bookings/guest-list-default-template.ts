import { promises as fs } from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';

export const DEFAULT_GUEST_LIST_TEMPLATE_FILENAME =
  'default-guest-list-template.docx';

export const GUEST_LIST_WATERMARK_FILENAME = 'guest-list-watermark.png';

function candidatePaths(): string[] {
  const cwd = process.cwd();
  const envPath = process.env.DEFAULT_GUEST_LIST_DOCX_PATH?.trim();
  const contractsDir = path.join(cwd, 'assets', 'contracts');
  return [
    envPath,
    path.join(contractsDir, DEFAULT_GUEST_LIST_TEMPLATE_FILENAME),
    path.join(cwd, 'docs', DEFAULT_GUEST_LIST_TEMPLATE_FILENAME),
  ].filter((p): p is string => Boolean(p?.trim()));
}

function watermarkCandidatePaths(): string[] {
  const cwd = process.cwd();
  const contractsDir = path.join(cwd, 'assets', 'contracts');
  return [
    path.join(contractsDir, GUEST_LIST_WATERMARK_FILENAME),
    path.join(cwd, 'docs', GUEST_LIST_WATERMARK_FILENAME),
  ];
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

/** Marca de agua (colibrí) para fallback HTML. */
export async function loadGuestListWatermarkBase64(): Promise<string | null> {
  for (const filePath of watermarkCandidatePaths()) {
    try {
      const buf = await fs.readFile(filePath);
      if (buf.length > 0) {
        return `data:image/png;base64,${buf.toString('base64')}`;
      }
    } catch {
      // siguiente candidato
    }
  }

  for (const filePath of candidatePaths()) {
    try {
      const png = await extractPngFromDocx(filePath, 'word/media/image1.png');
      if (png) {
        return `data:image/png;base64,${png.toString('base64')}`;
      }
    } catch {
      // siguiente candidato
    }
  }
  return null;
}

async function extractPngFromDocx(
  docxPath: string,
  entryName: string,
): Promise<Buffer | null> {
  const buf = await fs.readFile(docxPath);
  if (buf.slice(0, 2).toString() !== 'PK') return null;

  let offset = 0;
  while (offset + 30 <= buf.length) {
    const sig = buf.readUInt32LE(offset);
    if (sig !== 0x04034b50) break;
    const compression = buf.readUInt16LE(offset + 8);
    const compressedSize = buf.readUInt32LE(offset + 18);
    const uncompressedSize = buf.readUInt32LE(offset + 22);
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const name = buf.toString('utf8', offset + 30, offset + 30 + nameLen);
    const dataStart = offset + 30 + nameLen + extraLen;
    const dataEnd = dataStart + compressedSize;
    if (name === entryName) {
      const compressed = buf.subarray(dataStart, dataEnd);
      if (compression === 0) return Buffer.from(compressed);
      if (compression === 8) {
        return Buffer.from(zlib.inflateRawSync(compressed));
      }
      return null;
    }
    offset = dataEnd;
  }
  return null;
}
