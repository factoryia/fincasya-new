/**
 * Genera assets/contracts/default-contract-template.docx a partir de QUINTA OLAYA.docx,
 * sustituyendo textos fijos de una finca por {{placeholders}} (mismo formato Word).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const source = path.join(root, 'docs', 'QUINTA OLAYA.docx');
const outDir = path.join(root, 'assets', 'contracts');
const outFile = path.join(outDir, 'default-contract-template.docx');

const PizZip = (await import('pizzip')).default;

const zip = new PizZip(readFileSync(source));
const xmlPath = 'word/document.xml';
let xml = zip.file(xmlPath)?.asText();
if (!xml) throw new Error('word/document.xml missing');

if (xml.includes('QUINTA OLAYA LUXURY')) {
  xml = xml.replace(/QUINTA OLAYA LUXURY/g, '{{nombreFinca}}');
} else {
  console.warn('[patch] QUINTA OLAYA LUXURY no encontrado');
}

if (xml.includes('>Villeta<')) {
  xml = xml.replace(/>Villeta</g, '>{{municipioFinca}}<');
} else {
  console.warn('[patch] Villeta no encontrado');
}

// Propietario (tabs en blanco) → placeholder
xml = xml.replace(
  /(del señor: <\/w:t><\/w:r>)((?:<w:r w:rsidR="00023C2E"><w:rPr><w:b\/><\/w:rPr><w:tab\/><\/w:r>){2,})/,
  '$1<w:r><w:rPr><w:b/></w:rPr><w:t>{{nombrePropietario}}</w:t></w:r>',
);

// Lista fija de amenidades de la plantilla ejemplo → un solo marcador
if (xml.includes('>08 HABITACIONES<')) {
  xml = xml.replace(/>08 HABITACIONES</g, '>{{caracteristicasDeFinca}}<');
  xml = xml.replace(
    /<w:p[^>]*w14:paraId="611AFF0F"[\s\S]*?<\/w:p>\s*<w:p[^>]*w14:paraId="611AFF10"[\s\S]*?<\/w:p>\s*<w:p[^>]*w14:paraId="611AFF11"[\s\S]*?<\/w:p>\s*<w:p[^>]*w14:paraId="611AFF12"[\s\S]*?<\/w:p>\s*<w:p[^>]*w14:paraId="611AFF13"[\s\S]*?<\/w:p>\s*<w:p[^>]*w14:paraId="611AFF14"[\s\S]*?<\/w:p>\s*<w:p[^>]*w14:paraId="611AFF15"[\s\S]*?<\/w:p>\s*<w:p[^>]*w14:paraId="611AFF16"[\s\S]*?<\/w:p>\s*<w:p[^>]*w14:paraId="611AFF17"[\s\S]*?<\/w:p>/g,
    '',
  );
  const extraFeatures = [
    '09 BAÑOS',
    '01 PISCINA',
    '01 JACUZZI',
    '01 COCINA EQUIPADA',
    'SALA PRINCIPAL',
    'COMEDOR',
    'WIFI – TV',
    'PARQUEADERO',
    'AIRE ACONDICIONADO',
    'ZONA SOCIAL',
  ];
  for (const label of extraFeatures) {
    const re = new RegExp(
      `<w:p[^>]*>[\\s\\S]*?${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?</w:p>`,
      'g',
    );
    xml = xml.replace(re, '');
  }
} else {
  console.warn('[patch] 08 HABITACIONES no encontrado');
}

zip.file(xmlPath, xml);
mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }));
console.log('OK:', outFile);
