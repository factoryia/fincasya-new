const WORD_TEMPLATE_GAP =
  '(?:<[^>]+>|\\s|&nbsp;|&#160;|&#xA0;|\\u00A0)*';

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

function wordCell(text: string, opts?: { header?: boolean; width?: number }) {
  const width = opts?.width ?? 4500;
  const fill = opts?.header ? ' w:fill="F5F5F5"' : '';
  return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/><w:shd w:val="clear" w:color="auto"${fill}/></w:tcPr><w:p><w:r><w:rPr><w:sz w:val="20"/><w:lang w:val="es-CO"/></w:rPr><w:t xml:space="preserve">${escapeWordXml(text)}</w:t></w:r></w:p></w:tc>`;
}

function wordRow(cells: string[]) {
  return `<w:tr>${cells.join('')}</w:tr>`;
}

function wordTable(rows: string[]) {
  return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="3200"/><w:gridCol w:w="6200"/></w:tblGrid>${rows.join('')}</w:tbl>`;
}

export function buildGuestListMetaTableXml(
  pairs: Array<[string, string]>,
): string {
  const rows = pairs.map(([label, value]) =>
    wordRow([wordCell(label, { header: true, width: 3200 }), wordCell(value, { width: 6200 })]),
  );
  return wordTable(rows);
}

export function buildGuestListGuestsTableXml(
  headers: string[],
  bodyRows: string[][],
): string {
  const headerRow = wordRow(
    headers.map((h, i) =>
      wordCell(h, {
        header: true,
        width: i === 0 ? 700 : i === 1 ? 4200 : 4500,
      }),
    ),
  );
  const widths = [700, 4200, 4500];
  const dataRows = bodyRows.map((cells) =>
    wordRow(
      cells.map((c, i) =>
        wordCell(c, { width: widths[i] ?? 4500 }),
      ),
    ),
  );
  return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="700"/><w:gridCol w:w="4200"/><w:gridCol w:w="4500"/></w:tblGrid>${headerRow}${dataRows.join('')}</w:tbl>`;
}

export function processGuestListTemplateXml(
  xml: string,
  metaTableXml: string,
  guestsTableXml: string,
): string {
  let processed = xml;
  processed = replaceWordRawBlockPlaceholder(processed, 'tablaMeta', metaTableXml);
  processed = replaceWordRawBlockPlaceholder(
    processed,
    'tablaInvitados',
    guestsTableXml,
  );
  return processed;
}
