const WORD_TEMPLATE_GAP =
  '(?:<[^>]+>|\\s|&nbsp;|&#160;|&#xA0;|\\u00A0)*';

/** Ancho útil de la página (Letter con márgenes). */
const TABLE_WIDTH_DXA = 9360;

/** Tamaños Word (half-points): 24 = 12pt, 28 = 14pt, 32 = 16pt, 36 = 18pt */
const FONT_TABLE = '24';
const FONT_TABLE_HEADER = '28';
const FONT_SECTION = '32';

const WATERMARK_IMAGE_TARGET = 'media/image1.png';
export const GUEST_LIST_WATERMARK_SHAPE_ID = 'GuestListBodyWatermark';

const TABLE_BORDERS = `<w:tblBorders>
  <w:top w:val="single" w:sz="6" w:space="0" w:color="CCCCCC"/>
  <w:left w:val="single" w:sz="6" w:space="0" w:color="CCCCCC"/>
  <w:bottom w:val="single" w:sz="6" w:space="0" w:color="CCCCCC"/>
  <w:right w:val="single" w:sz="6" w:space="0" w:color="CCCCCC"/>
  <w:insideH w:val="single" w:sz="6" w:space="0" w:color="CCCCCC"/>
  <w:insideV w:val="single" w:sz="6" w:space="0" w:color="CCCCCC"/>
</w:tblBorders>`;

const CELL_BORDERS = `<w:tcBorders>
  <w:top w:val="single" w:sz="6" w:space="0" w:color="CCCCCC"/>
  <w:left w:val="single" w:sz="6" w:space="0" w:color="CCCCCC"/>
  <w:bottom w:val="single" w:sz="6" w:space="0" w:color="CCCCCC"/>
  <w:right w:val="single" w:sz="6" w:space="0" w:color="CCCCCC"/>
</w:tcBorders>`;

const CELL_MARGINS = `<w:tcMar>
  <w:top w:w="60" w:type="dxa"/>
  <w:left w:w="100" w:type="dxa"/>
  <w:bottom w:w="60" w:type="dxa"/>
  <w:right w:w="100" w:type="dxa"/>
</w:tcMar>`;

const LABEL_FILL = 'F0F0F0';
const HEADER_FILL = 'E8E8E8';

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

function wordRunProps(opts?: {
  bold?: boolean;
  size?: string;
  color?: string;
}): string {
  const size = opts?.size ?? FONT_TABLE;
  const parts = [`<w:sz w:val="${size}"/>`, '<w:lang w:val="es-CO"/>'];
  if (opts?.bold) parts.unshift('<w:b/>');
  if (opts?.color) parts.push(`<w:color w:val="${opts.color}"/>`);
  return `<w:rPr>${parts.join('')}</w:rPr>`;
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

function wordParagraph(
  text: string,
  opts?: { bold?: boolean; center?: boolean; size?: string; color?: string },
) {
  const pPrParts = [
    '<w:spacing w:before="0" w:after="0" w:line="276" w:lineRule="auto"/>',
  ];
  if (opts?.center) pPrParts.unshift('<w:jc w:val="center"/>');
  return `<w:p><w:pPr>${pPrParts.join('')}</w:pPr><w:r>${wordRunProps(opts)}<w:t xml:space="preserve">${escapeWordXml(text)}</w:t></w:r></w:p>`;
}

function wordSectionTitle(text: string): string {
  return `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="140" w:after="60" w:line="300" w:lineRule="auto"/><w:keepNext/></w:pPr><w:r>${wordRunProps({ bold: true, size: FONT_SECTION })}<w:t xml:space="preserve">${escapeWordXml(text)}</w:t></w:r></w:p>`;
}

function wordCell(
  text: string,
  opts?: {
    header?: boolean;
    label?: boolean;
    width?: number;
    center?: boolean;
  },
) {
  const width = opts?.width ?? 4500;
  const fill = opts?.label
    ? ` w:fill="${LABEL_FILL}"`
    : opts?.header
      ? ` w:fill="${HEADER_FILL}"`
      : '';
  return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${CELL_BORDERS}${CELL_MARGINS}<w:shd w:val="clear" w:color="auto"${fill}/></w:tcPr>${wordParagraph(text, {
    bold: opts?.header || opts?.label,
    center: opts?.center,
    size: opts?.header || opts?.label ? FONT_TABLE_HEADER : FONT_TABLE,
  })}</w:tc>`;
}

function wordRow(cells: string[]) {
  return `<w:tr>${cells.join('')}</w:tr>`;
}

function wordTable(gridCols: number[], rows: string[]) {
  const grid = gridCols.map((w) => `<w:gridCol w:w="${w}"/>`).join('');
  return `<w:tbl><w:tblPr><w:jc w:val="center"/><w:tblW w:w="${TABLE_WIDTH_DXA}" w:type="dxa"/>${TABLE_BORDERS}<w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${rows.join('')}</w:tbl>`;
}

export function buildGuestListMetaTableXml(
  pairs: Array<[string, string]>,
): string {
  const labelWidth = 3400;
  const valueWidth = TABLE_WIDTH_DXA - labelWidth;
  const rows = pairs.map(([label, value]) =>
    wordRow([
      wordCell(label, { label: true, width: labelWidth, center: true }),
      wordCell(value, { width: valueWidth, center: true }),
    ]),
  );
  return wordTable([labelWidth, valueWidth], rows);
}

export function buildGuestListGuestsTableXml(
  headers: string[],
  bodyRows: string[][],
): string {
  const colWidths = [900, 4100, TABLE_WIDTH_DXA - 900 - 4100];
  const headerRow = wordRow(
    headers.map((h, i) =>
      wordCell(h, {
        header: true,
        width: colWidths[i] ?? 4500,
        center: true,
      }),
    ),
  );
  const dataRows = bodyRows.map((cells) =>
    wordRow(
      cells.map((c, i) =>
        wordCell(c, {
          width: colWidths[i] ?? 4500,
          center: true,
        }),
      ),
    ),
  );
  return wordTable(colWidths, [headerRow, ...dataRows]);
}

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

export function stripLeadingEmptyBodyParagraphs(xml: string): string {
  const bodyStart = xml.indexOf('<w:body>');
  const sectStart = xml.indexOf('<w:sectPr');
  if (bodyStart === -1 || sectStart === -1 || sectStart <= bodyStart) return xml;

  const head = xml.slice(0, bodyStart + '<w:body>'.length);
  let body = xml.slice(bodyStart + '<w:body>'.length, sectStart);
  const tail = xml.slice(sectStart);

  const emptyPara =
    /<w:p\b[^>]*\/>|<w:p\b[^>]*>\s*(?:<w:pPr\b[^>]*\/>|<w:pPr>[\s\S]*?<\/w:pPr>)?\s*(?:<w:r>\s*<w:tab\s*\/>\s*<\/w:r>\s*)?<\/w:p>/g;

  body = body.replace(/^(\s*)/, '');
  let prev = '';
  while (prev !== body) {
    prev = body;
    body = body.replace(emptyPara, '');
    body = body.replace(/^\s+/, '');
  }

  return head + body + tail;
}

export function compactGuestListDocumentXml(xml: string): string {
  let processed = stripLeadingEmptyBodyParagraphs(xml);
  processed = processed.replace(
    /<w:pgMar[^/>]*\/>/,
    '<w:pgMar w:top="720" w:right="1080" w:bottom="720" w:left="1080" w:header="480" w:footer="360" w:gutter="0"/>',
  );
  processed = processed.replace(
    /<w:headerReference w:type="first" r:id="[^"]+"\/>/g,
    '',
  );
  processed = processed.replace(
    /<w:footerReference w:type="first" r:id="[^"]+"\/>/g,
    '',
  );
  return processed;
}

/** Conserva logo + marca de agua del encabezado (iLovePDF a veces la omite ahí). */
export function styleGuestListHeaderXml(xml: string): string {
  if (!xml.includes('WordPictureWatermark')) return xml;
  return xml.replace(
    /width:468pt;height:468pt/g,
    'width:420pt;height:420pt',
  );
}

export function ensureGuestListDocumentImageRel(relsXml: string): {
  xml: string;
  relId: string | null;
} {
  const existing = relsXml.match(
    new RegExp(
      `Id="(rId\\d+)"[^>]+Target="${WATERMARK_IMAGE_TARGET.replace('/', '\\/')}"`,
    ),
  );
  if (existing) return { xml: relsXml, relId: existing[1] };

  const ids = [...relsXml.matchAll(/Id="rId(\d+)"/g)].map((m) =>
    parseInt(m[1], 10),
  );
  const nextNum = ids.length ? Math.max(...ids) + 1 : 1;
  const relId = `rId${nextNum}`;
  const rel = `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${WATERMARK_IMAGE_TARGET}"/>`;
  return {
    xml: relsXml.replace('</Relationships>', `${rel}</Relationships>`),
    relId,
  };
}

export function enableGuestListBackgroundShapes(settingsXml: string): string {
  if (settingsXml.includes('displayBackgroundShape')) return settingsXml;
  return settingsXml.replace(
    '</w:compat>',
    '</w:compat><w:displayBackgroundShape/>',
  );
}

function buildBodyWatermarkParagraph(imageRelId: string): string {
  return `<w:p><w:pPr><w:pStyle w:val="Header"/></w:pPr><w:r><w:rPr><w:noProof/></w:rPr><w:pict><v:shapetype id="_x0000_t75_glwm" coordsize="21600,21600" o:spt="75" o:preferrelative="t" path="m@4@5l@4@11@9@11@9@5xe" filled="f" stroked="f"><v:stroke joinstyle="miter"/><v:formulas><v:f eqn="if lineDrawn pixelLineWidth 0"/><v:f eqn="sum @0 1 0"/><v:f eqn="sum 0 0 @1"/><v:f eqn="prod @2 1 2"/><v:f eqn="prod @3 21600 pixelWidth"/><v:f eqn="prod @3 21600 pixelHeight"/><v:f eqn="sum @0 0 1"/><v:f eqn="prod @6 1 2"/><v:f eqn="prod @7 21600 pixelWidth"/><v:f eqn="sum @8 21600 0"/><v:f eqn="prod @7 21600 pixelHeight"/><v:f eqn="sum @10 21600 0"/></v:formulas><v:path o:extrusionok="f" gradientshapeok="t" o:connecttype="rect"/><o:lock v:ext="edit" aspectratio="t"/></v:shapetype><v:shape id="${GUEST_LIST_WATERMARK_SHAPE_ID}" o:spid="_x0000_s2049" type="#_x0000_t75_glwm" alt="" style="position:absolute;left:0;margin-left:0;margin-top:0;width:420pt;height:420pt;z-index:-251658240;mso-wrap-edited:f;mso-position-horizontal:center;mso-position-horizontal-relative:margin;mso-position-vertical:center;mso-position-vertical-relative:margin" o:allowincell="f"><v:imagedata r:id="${imageRelId}" o:title="watermark" gain="19661f" blacklevel="22938f"/><w10:wrap anchorx="margin" anchory="margin"/></v:shape></w:pict></w:r></w:p>`;
}

export function injectGuestListBodyWatermark(
  documentXml: string,
  imageRelId: string,
): string {
  if (documentXml.includes(GUEST_LIST_WATERMARK_SHAPE_ID)) return documentXml;
  return documentXml.replace(
    '<w:body>',
    `<w:body>${buildBodyWatermarkParagraph(imageRelId)}`,
  );
}

export function processGuestListTemplateXml(
  xml: string,
  metaTableXml: string,
  guestsTableXml: string,
  imageRelId?: string | null,
): string {
  let processed = compactGuestListDocumentXml(xml);
  if (imageRelId) {
    processed = injectGuestListBodyWatermark(processed, imageRelId);
  }

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
