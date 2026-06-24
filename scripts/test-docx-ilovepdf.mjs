/**
 * Diagnóstico: procesa la plantilla como fincas.service y prueba iLovePDF.
 * Uso: node scripts/test-docx-ilovepdf.mjs [--firma]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import PizZip from 'pizzip';
import ILovePDFApi from '@ilovepdf/ilovepdf-nodejs';
import ILovePDFFile from '@ilovepdf/ilovepdf-nodejs/ILovePDFFile.js';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// --- helpers copiados de fincas.service.ts ---
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceByPlainInnerKey(xml, key, valueXmlEscaped) {
  const keyNorm = key.replace(/\s+/g, ' ').trim();
  if (!keyNorm) return xml;
  let s = xml;
  let from = 0;
  for (;;) {
    const open = s.indexOf('{{', from);
    if (open === -1) break;
    const close = s.indexOf('}}', open + 2);
    if (close === -1) {
      from = open + 2;
      continue;
    }
    const inner = s.slice(open + 2, close);
    const innerPlain = inner
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;|&#0*160;|&#x0*A0;|&#32;|&#x20;|&amp;#160;|&amp;#32;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (innerPlain === keyNorm) {
      s = s.slice(0, open) + valueXmlEscaped + s.slice(close + 2);
      from = open + valueXmlEscaped.length;
    } else {
      from = close + 2;
    }
  }
  return s;
}

const WORD_TEMPLATE_GAP =
  '(?:<[^>]+>|[\\s\\u00A0\\u200B\\uFEFF]|&nbsp;|&#0*160;|&#x0*A0;|&#32;|&#x20;)*';

function escapeWordPlainText(rawVal) {
  return (rawVal ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildWordLeftAlignedParagraphs(lines, bold = false, paragraphPr = '<w:pPr><w:jc w:val="left"/></w:pPr>') {
  const rPr = bold ? '<w:rPr><w:b/><w:bCs/></w:rPr>' : '';
  return lines
    .map((line) => {
      const t = escapeWordPlainText(line);
      return `<w:p>${paragraphPr}<w:r>${rPr}<w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
    })
    .join('');
}

function findEnclosingWordParagraph(xml, innerStart, innerEnd) {
  let pos = innerStart;
  let pStart = -1;
  while (pos > 0) {
    const idx = xml.lastIndexOf('<w:p', pos);
    if (idx === -1) break;
    const next = xml.charAt(idx + 4);
    if (next === '>' || next === ' ' || next === '/') {
      pStart = idx;
      break;
    }
    pos = idx - 1;
  }
  if (pStart === -1) return null;
  const pEnd = xml.indexOf('</w:p>', innerEnd);
  if (pEnd === -1) return null;
  return { start: pStart, end: pEnd + '</w:p>'.length };
}

function buildWordBankAccountsInlineXml(lines) {
  return lines
    .map((line, i) => {
      const t = escapeWordPlainText(line);
      const br = i > 0 ? '<w:r><w:br/></w:r>' : '';
      return `${br}<w:r><w:t xml:space="preserve">${t}</w:t></w:r>`;
    })
    .join('');
}

function replaceWordBankAccountPlaceholderCluster(xml, lines) {
  if (lines.length <= 1) return xml;
  const gap = WORD_TEMPLATE_GAP;
  const cuentaKey = Array.from('cuentaNumero').map((ch) => escapeRegExp(ch)).join(gap);
  const titularKey = Array.from('titularCedula').map((ch) => escapeRegExp(ch)).join(gap);
  const re = new RegExp(
    `(\\{${gap}\\{${gap}${cuentaKey}${gap}\\}${gap}\\}|\\{\\{${gap}${cuentaKey}${gap}\\}\\})[\\s\\S]*?(\\{${gap}\\{${gap}${titularKey}${gap}\\}${gap}\\}|\\{\\{${gap}${titularKey}${gap}\\}\\})`,
  );
  return xml.replace(re, buildWordBankAccountsInlineXml(lines));
}

function replaceWordListPlaceholderWithLeftAlign(xml, key, rawVal) {
  const keyPart = Array.from(key).map((ch) => escapeRegExp(ch)).join(WORD_TEMPLATE_GAP);
  const re = new RegExp(
    `\\{${WORD_TEMPLATE_GAP}\\{${WORD_TEMPLATE_GAP}${keyPart}${WORD_TEMPLATE_GAP}\\}${WORD_TEMPLATE_GAP}\\}|\\{\\{${WORD_TEMPLATE_GAP}${keyPart}${WORD_TEMPLATE_GAP}\\}\\}`,
  );
  const match = re.exec(xml);
  if (!match) return xml;
  const para = findEnclosingWordParagraph(xml, match.index, match.index + match[0].length);
  const lines = (rawVal ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!para) return xml.replace(re, escapeWordTemplateValue(rawVal));
  const paraXml = xml.slice(para.start, para.end);
  const pPrMatch = paraXml.match(/<w:pPr>[\s\S]*?<\/w:pPr>/);
  const paragraphPr = pPrMatch?.[0] ?? '<w:pPr><w:ind w:left="550"/></w:pPr>';
  const bold = /<w:b\s*\/>/.test(paraXml);
  const replacement = lines.length ? buildWordLeftAlignedParagraphs(lines, bold, paragraphPr) : '';
  return xml.slice(0, para.start) + replacement + xml.slice(para.end);
}

function escapeWordTemplateValue(rawVal) {
  let v = (rawVal ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  if (v.includes('\n')) {
    v = v.replace(/\r\n/g, '\n').replace(/\n/g, '</w:t></w:r><w:br/><w:r><w:t xml:space="preserve">');
  }
  return v;
}

function applyWordTemplateReplacements(xml, values) {
  let s = xml;
  s = s.replace(/<w:proofErr[^/>]*\/>/g, '');
  s = s.replace(/<w:proofErr[^>]*>[\s\S]*?<\/w:proofErr>/g, '');
  s = s.replace(/<w:softHyphen\/>/g, '');
  s = s.replace(/<w:noBreakHyphen\/>/g, '');
  s = s.replace(/<w:tab\/>/g, ' ');
  const gap = WORD_TEMPLATE_GAP;
  const entries = Object.entries(values)
    .filter(([k, v]) => k && v !== undefined)
    .map(([k, v]) => [k, v ?? ''])
    .sort((a, b) => b[0].length - a[0].length);
  for (const [key, rawVal] of entries) {
    if (!key.trim()) continue;
    const val = escapeWordTemplateValue(rawVal);
    const keyPart = Array.from(key).map((ch) => escapeRegExp(ch)).join(gap);
    s = s.replace(new RegExp(`\\{${gap}\\{${gap}${keyPart}${gap}\\}${gap}\\}`, 'g'), val);
    s = s.replace(new RegExp(`\\{\\{${gap}${keyPart}${gap}\\}\\}`, 'g'), val);
    s = s.replace(new RegExp(`\\{${gap}${keyPart}${gap}\\}`, 'g'), val);
  }
  for (const [key, rawVal] of entries) {
    if (!key.trim()) continue;
    s = replaceByPlainInnerKey(s, key, escapeWordTemplateValue(rawVal));
  }
  s = s.replace(/\{\{[^}]*\}\}/g, '');
  s = s.replace(/\{[A-Za-z0-9_\s\u00C0-\u024F.,()$-]+\}/g, '');
  return s;
}

function sampleWordValues() {
  const caracteristicas = '04 HABITACIONES\n09 BAÑOS\nPISCINA\nJACUZZI';
  const base = {
    fechaGeneracion: '24 días del mes de Junio del 2026',
    precioLetras: 'TRES MILLONES TRESCIENTOS MIL PESOS',
    precioNumerico: '$3.300.000',
    bancoNombre: 'Bancolombia Ahorros',
    cuentaNumero: '36471108604',
    titularNombre: 'HERNÁN AGUILERA GÓMEZ',
    titularCedula: '81.720.077',
    contratoNumero: 'cc1111212',
    nochesTexto: 'una', nochesNumero: '1', diasTexto: 'un', diasNumero: '1',
    fechaLlegadaMini: '01/07/2026', fechaSalidaMini: '02/07/2026',
    horaLlegada: '3:00 PM', horaSalida: '12:00 PM',
    ciudadCliente: 'BOGOTÁ', direccionCliente: 'MZ 26 CS 9',
    clienteNombre: 'NADLKMALSD', clienteCedula: '12312312',
    clientCorreo: 'A@B.COM', clienteCelular: '3001234567',
    nombreFinca: 'GIRARDOT CASA', municipioFinca: 'Girardot',
    capacidad: '15', caracteristicasDeFinca: caracteristicas,
    nombrePropietario: 'SANTIAGO', adminNombre: 'HERNÁN AGUILERA GÓMEZ',
    adminCedula: '81.720.077', adminCiudad: 'Chía',
    aseofinal: '$100.000', Depósitopordaños: '$200.000',
    depositomascotas: '$100.000', personasextras: '$50.000',
  };
  // Simular claves largas del mapeo PDF (como en valuesMapping)
  base['FECHA_GENERACIÓN DE CONTRATO (FORMATO DIA(NUMERO) MES(TEXTO) de AÑO(NUMERO))'] = base.fechaGeneracion;
  base['PRECIO EN LETRAS (FORMATO TEXTO)'] = base.precioLetras;
  return base;
}

function injectFirmaDrawing(zip, docXml) {
  const ext = 'png';
  const imgBuf = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  zip.file(`word/media/firma_arrendador.${ext}`, imgBuf);
  const relId = 'rIdFirmaArr';
  let rels = zip.file('word/_rels/document.xml.rels')?.asText() ?? '';
  if (rels && !rels.includes(relId)) {
    rels = rels.replace(
      '</Relationships>',
      `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/firma_arrendador.${ext}"/></Relationships>`,
    );
    zip.file('word/_rels/document.xml.rels', rels);
  }
  const drawing =
    `<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="1524000" cy="571500"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    `<wp:docPr id="9001" name="FirmaArrendador"/>` +
    `<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:nvPicPr><pic:cNvPr id="9001" name="FirmaArrendador"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1524000" cy="571500"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`;
  return docXml.replace(
    /<w:t xml:space="preserve">_{5,}[^<]*<\/w:t>/,
    `<w:t xml:space="preserve"></w:t></w:r><w:r>${drawing}`,
  );
}

function injectFirmaDrawingFixed(zip, docXml) {
  const ext = 'png';
  const imgBuf = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  zip.file(`word/media/firma_arrendador.${ext}`, imgBuf);
  let rels = zip.file('word/_rels/document.xml.rels')?.asText() ?? '';
  const relId = 'rId15';
  if (rels && !rels.includes(`Id="${relId}"`)) {
    rels = rels.replace(
      '</Relationships>',
      `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/firma_arrendador.${ext}"/></Relationships>`,
    );
    zip.file('word/_rels/document.xml.rels', rels);
  }
  let ct = zip.file('[Content_Types].xml')?.asText() ?? '';
  if (ct && !ct.includes('Extension="png"')) {
    ct = ct.replace('</Types>', '<Default Extension="png" ContentType="image/png"/></Types>');
    zip.file('[Content_Types].xml', ct);
  }
  const drawing =
    `<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="1524000" cy="571500"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    `<wp:docPr id="9001" name="FirmaArrendador"/>` +
    `<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:nvPicPr><pic:cNvPr id="9001" name="FirmaArrendador"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1524000" cy="571500"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`;
  return docXml.replace(
    /<w:r>(\s*<w:rPr>[\s\S]*?<\/w:rPr>)?\s*<w:t xml:space="preserve">_{5,}[^<]*<\/w:t>\s*<\/w:r>/,
    `<w:r>$1${drawing}</w:r>`,
  );
}

async function testIlove(buf, label) {
  const outPath = path.join(__dirname, '..', 'tmp', `${label}.docx`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buf);
  const instance = new ILovePDFApi(process.env.ILOVEPDF_PUBLIC_KEY, process.env.ILOVEPDF_SECRET_KEY);
  const task = instance.newTask('officepdf');
  await task.start();
  await task.addFile(new ILovePDFFile(outPath));
  try {
    await task.process();
    const pdf = await task.download();
    console.log(`[${label}] iLovePDF OK — PDF ${pdf.length} bytes → ${outPath}`);
    return true;
  } catch (e) {
    const detail = e.response?.data?.error?.param?.[0] ?? e.response?.data ?? e.message;
    console.log(`[${label}] iLovePDF FAIL —`, JSON.stringify(detail));
    return false;
  }
}

function processTemplate({ withFirma, fixedFirma, mode = 'full' }) {
  const templatePath = path.join(__dirname, '..', 'assets', 'contracts', 'default-contract-template.docx');
  const zip = new PizZip(fs.readFileSync(templatePath));
  const wordValues = sampleWordValues();
  const bankWordLines = [wordValues.cuentaNumero];
  const processXml = (xml) => {
    let processed = xml;
    if (mode === 'list-only' || mode === 'full') {
      for (const key of ['caracteristicasDeFinca', 'característicasDeFinca']) {
        if (wordValues[key] !== undefined) {
          processed = replaceWordListPlaceholderWithLeftAlign(processed, key, wordValues[key]);
        }
      }
    }
    if (mode === 'replace-only' || mode === 'full') {
      processed = applyWordTemplateReplacements(processed, wordValues);
    }
    return processed;
  };
  const xmlTargets = Object.keys(zip.files).filter(
    (name) =>
      !zip.files[name].dir &&
      (name === 'word/document.xml' ||
        /^word\/header\d+\.xml$/.test(name) ||
        /^word\/footer\d+\.xml$/.test(name)),
  );
  for (const fileName of xmlTargets) {
    const raw = zip.file(fileName)?.asText();
    if (raw) zip.file(fileName, processXml(raw));
  }
  if (withFirma) {
    let docXml = zip.file('word/document.xml').asText();
    docXml = fixedFirma ? injectFirmaDrawingFixed(zip, docXml) : injectFirmaDrawing(zip, docXml);
    zip.file('word/document.xml', docXml);
  }
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

const withFirma = process.argv.includes('--firma');
const fixed = process.argv.includes('--fixed');
const modeArg = process.argv.find((a) => a.startsWith('--mode='));
const mode = modeArg ? modeArg.split('=')[1] : 'full';

const buf = processTemplate({ withFirma, fixedFirma: fixed, mode });
const label = `${mode}${withFirma ? (fixed ? '-fixed-firma' : '-firma') : ''}`;
await testIlove(buf, label);
