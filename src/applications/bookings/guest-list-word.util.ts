const WORD_TEMPLATE_GAP =
  '(?:<[^>]+>|\\s|&nbsp;|&#160;|&#xA0;|\\u00A0)*';

/** Ancho útil de la página (Letter con márgenes de 1440 dxa). */
const TABLE_WIDTH_DXA = 9360;

const TABLE_BORDERS = `<w:tblBorders>
  <w:top w:val="single" w:sz="4" w:space="0" w:color="BBBBBB"/>
  <w:left w:val="single" w:sz="4" w:space="0" w:color="BBBBBB"/>
  <w:bottom w:val="single" w:sz="4" w:space="0" w:color="BBBBBB"/>
  <w:right w:val="single" w:sz="4" w:space="0" w:color="BBBBBB"/>
  <w:insideH w:val="single" w:sz="4" w:space="0" w:color="BBBBBB"/>
  <w:insideV w:val="single" w:sz="4" w:space="0" w:color="BBBBBB"/>
</w:tblBorders>`;

const CELL_BORDERS = `<w:tcBorders>
  <w:top w:val="single" w:sz="4" w:space="0" w:color="BBBBBB"/>
  <w:left w:val="single" w:sz="4" w:space="0" w:color="BBBBBB"/>
  <w:bottom w:val="single" w:sz="4" w:space="0" w:color="BBBBBB"/>
  <w:right w:val="single" w:sz="4" w:space="0" w:color="BBBBBB"/>
</w:tcBorders>`;

const CELL_MARGINS = `<w:tcMar>
  <w:top w:w="40" w:type="dxa"/>
  <w:left w:w="80" w:type="dxa"/>
  <w:bottom w:w="40" w:type="dxa"/>
  <w:right w:w="80" w:type="dxa"/>
</w:tcMar>`;

const COMPACT_PARAGRAPH_SPACING =
  '<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeWordXml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function findEnclosingWordParagraph(
  xml: string,
  start: number,
  end: number,
): { start: number; end: number } | null {
  const open = xml.lastIndexOf('<w:p', start);
  if (open === -1) return null;
  let depth = 0;
  let i = open;
  while (i < xml.length) {
    const nextOpen = xml.indexOf('<w:p', i);
    const nextClose = xml.indexOf('</w:p>', i);
    if (nextClose === -1) return null;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      i = nextOpen + 4;
      continue;
    }
    if (depth === 0) {
      return { start: open, end: nextClose + 6 };
    }
    depth--;
    i = nextClose + 6;
  }
  return null;
}

/** Reemplaza el párrafo que contiene {{key}} por bloque XML crudo (p. ej. una tabla). */
export function replaceWordRawBlockPlaceholder(
  xml: string,
  key: string,
  rawXml: string,
): string {
  const keyPart = Array.from(key)
    .map((ch) => escapeRegExp(ch))
    .join(WORD_TEMPLATE_GAP);
  const re = new RegExp(
    `\\{${WORD_TEMPLATE_GAP}\\{${WORD_TEMPLATE_GAP}${keyPart}${WORD_TEMPLATE_GAP}\\}${WORD_TEMPLATE_GAP}\\}|\\{\\{${WORD_TEMPLATE_GAP}${keyPart}${WORD_TEMPLATE_GAP}\\}\\}`,
  );
  const match = re.exec(xml);
  if (!match) return xml;
  const para = findEnclosingWordParagraph(
    xml,
    match.index,
    match.index + match[0].length,
  );
  if (!para) return xml.replace(re, rawXml);
  return xml.slice(0, para.start) + rawXml + xml.slice(para.end);
}

function wordParagraph(text: string, opts?: { bold?: boolean; center?: boolean }) {
  const pPrParts = [COMPACT_PARAGRAPH_SPACING];
  if (opts?.center) pPrParts.unshift('<w:jc w:val="center"/>');
  const pPr = `<w:pPr>${pPrParts.join('')}</w:pPr>`;
  const rPr = opts?.bold
    ? '<w:rPr><w:b/><w:sz w:val="18"/><w:lang w:val="es-CO"/></w:rPr>'
    : '<w:rPr><w:sz w:val="18"/><w:lang w:val="es-CO"/></w:rPr>';
  return `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${escapeWordXml(text)}</w:t></w:r></w:p>`;
}

function wordSectionTitle(text: string): string {
  return `<w:p><w:pPr><w:spacing w:before="100" w:after="40" w:line="240" w:lineRule="auto"/><w:keepNext/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="22"/><w:lang w:val="es-CO"/></w:rPr><w:t xml:space="preserve">${escapeWordXml(text)}</w:t></w:r></w:p>`;
}

function wordCell(
  text: string,
  opts?: { header?: boolean; width?: number; center?: boolean },
) {
  const width = opts?.width ?? 4500;
  const fill = opts?.header ? ' w:fill="F5F5F5"' : '';
  return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${CELL_BORDERS}${CELL_MARGINS}<w:shd w:val="clear" w:color="auto"${fill}/></w:tcPr>${wordParagraph(text, { bold: opts?.header, center: opts?.center })}</w:tc>`;
}

function wordRow(cells: string[]) {
  return `<w:tr>${cells.join('')}</w:tr>`;
}

function wordTable(gridCols: number[], rows: string[]) {
  const grid = gridCols.map((w) => `<w:gridCol w:w="${w}"/>`).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="${TABLE_WIDTH_DXA}" w:type="dxa"/>${TABLE_BORDERS}<w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${rows.join('')}</w:tbl>`;
}

export function buildGuestListMetaTableXml(
  pairs: Array<[string, string]>,
): string {
  const labelWidth = 3200;
  const valueWidth = TABLE_WIDTH_DXA - labelWidth;
  const rows = pairs.map(([label, value]) =>
    wordRow([
      wordCell(label, { header: true, width: labelWidth }),
      wordCell(value, { width: valueWidth }),
    ]),
  );
  return wordTable([labelWidth, valueWidth], rows);
}

export function buildGuestListGuestsTableXml(
  headers: string[],
  bodyRows: string[][],
): string {
  const colWidths = [800, 4200, TABLE_WIDTH_DXA - 800 - 4200];
  const headerRow = wordRow(
    headers.map((h, i) =>
      wordCell(h, {
        header: true,
        width: colWidths[i] ?? 4500,
        center: i === 0,
      }),
    ),
  );
  const dataRows = bodyRows.map((cells) =>
    wordRow(
      cells.map((c, i) =>
        wordCell(c, {
          width: colWidths[i] ?? 4500,
          center: i === 0,
        }),
      ),
    ),
  );
  return wordTable(colWidths, [headerRow, ...dataRows]);
}

/** Meta + título + invitados en un solo bloque (evita salto de página entre tablas). */
export function buildGuestListBodyXml(
  metaPairs: Array<[string, string]>,
  guestHeaders: string[],
  guestRows: string[][],
): string {
  return [
    buildGuestListMetaTableXml(metaPairs),
    wordSectionTitle('Personas registradas'),
    buildGuestListGuestsTableXml(guestHeaders, guestRows),
  ].join('');
}

/** Reduce márgenes y encabezado para que quepa más contenido en una página. */
export function compactGuestListDocumentXml(xml: string): string {
  return xml
    .replace(
      /<w:pgMar[^/>]*\/>/,
      '<w:pgMar w:top="900" w:right="1200" w:bottom="900" w:left="1200" w:header="400" w:footer="400" w:gutter="0"/>',
    )
    .replace(
      /<w:headerReference w:type="first" r:id="[^"]+"\/>/g,
      '',
    )
    .replace(
      /<w:footerReference w:type="first" r:id="[^"]+"\/>/g,
      '',
    );
}

/** Marca de agua del encabezado más pequeña para no empujar el contenido. */
export function compactGuestListHeaderXml(xml: string): string {
  return xml.replace(
    /width:468pt;height:468pt/g,
    'width:320pt;height:320pt',
  );
}

export function processGuestListTemplateXml(
  xml: string,
  metaTableXml: string,
  guestsTableXml: string,
): string {
  let processed = compactGuestListDocumentXml(xml);

  const bodyXml = `${metaTableXml}${wordSectionTitle('Personas registradas')}${guestsTableXml}`;
  if (processed.includes('{{contenido}}') || processed.includes('{contenido}')) {
    processed = replaceWordRawBlockPlaceholder(processed, 'contenido', bodyXml);
    return processed;
  }

  processed = replaceWordRawBlockPlaceholder(processed, 'tablaMeta', metaTableXml);
  processed = replaceWordRawBlockPlaceholder(
    processed,
    'tablaInvitados',
    `${wordSectionTitle('Personas registradas')}${guestsTableXml}`,
  );
  return processed;
}
