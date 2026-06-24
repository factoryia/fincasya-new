import type { ReservationPaymentMethod } from '../shared/services/pdf.service';

/** Quita resaltado amarillo de marcador en celdas de valor. */
export function stripConfirmationWordHighlights(xml: string): string {
  let s = xml;
  s = s.replace(/<w:highlight\b[^/>]*\/>/g, '');
  s = s.replace(/<w:highlight\b[^>]*>[\s\S]*?<\/w:highlight>/g, '');
  return s;
}

function escapeWordXmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function plainText(xml: string): string {
  return xml
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;|&#0*160;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Sustituye horarios fijos (10:00 AM / 4:00 PM) por los del contrato. */
export function replaceConfirmationCheckInOutTimes(
  xml: string,
  checkInCheckOut: string,
): string {
  const safe = escapeWordXmlText(checkInCheckOut.trim() || '-');
  return xml.replace(/<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/g, (row) => {
    const plain = plainText(row);
    if (!plain.includes('chek in') && !plain.includes('check in')) return row;
    const cells = [...row.matchAll(/<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/g)];
    if (cells.length < 2) return row;
    const timeCell = cells[1][0];
    if (!/10|AM|PM|:00/.test(timeCell)) return row;
    const newTimeCell = timeCell.replace(
      /<w:p\b[^>]*>[\s\S]*?<\/w:p>/,
      `<w:p><w:r><w:t xml:space="preserve">${safe}</w:t></w:r></w:p>`,
    );
    return row.replace(timeCell, newTimeCell);
  });
}

function mapBankLabelToMethod(label: string): ReservationPaymentMethod | null {
  const t = label.replace(/\s+/g, ' ').trim().toLowerCase();
  if (t.includes('bbva')) return 'bbva';
  if (t.includes('bancolombia')) return 'bancolombia';
  if (t.includes('davivienda')) return 'davivienda';
  if (t.includes('nequi')) return 'nequi';
  if (t.includes('pse')) return 'pse';
  if (t.includes('tarjeta')) return 'tarjeta_credito';
  return null;
}

/** Marca con X la cuenta/método con el que pagó el cliente. */
export function markConfirmationPaymentMethod(
  xml: string,
  selected: ReservationPaymentMethod,
): string {
  return xml.replace(/<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/g, (row) => {
    const plain = plainText(row);
    if (!plain.includes('bancolombia') || !plain.includes('tarjeta')) return row;
    const cells = [...row.matchAll(/<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/g)].map(
      (m) => m[0],
    );
    if (cells.length < 4) return row;

    let newRow = row;
    for (let i = 0; i + 1 < cells.length; i += 2) {
      const method = mapBankLabelToMethod(plainText(cells[i]));
      if (!method) continue;
      const mark = method === selected ? 'X' : '';
      const checkboxCell = cells[i + 1];
      const newCheckbox = checkboxCell.replace(
        /<w:p\b[^>]*>[\s\S]*?<\/w:p>/,
        `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>${mark}</w:t></w:r></w:p>`,
      );
      newRow = newRow.replace(checkboxCell, newCheckbox);
    }
    return newRow;
  });
}

const FOOTER_FONT_HALF_POINTS = '14';

/** Texto legal al pie en fuente más pequeña (~7 pt). */
export function shrinkConfirmationFooterText(xml: string): string {
  return xml.replace(/<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/g, (row) => {
    const plain = plainText(row);
    if (!plain.includes('no se recibe pago en efectivo')) return row;

    return row.replace(/<w:r\b([^>]*)>([\s\S]*?)<\/w:r>/g, (match, attrs, inner) => {
      const sz = `<w:sz w:val="${FOOTER_FONT_HALF_POINTS}"/><w:szCs w:val="${FOOTER_FONT_HALF_POINTS}"/>`;
      if (inner.includes('<w:rPr>')) {
        if (inner.includes('w:val="' + FOOTER_FONT_HALF_POINTS + '"')) return match;
        return match.replace(/<w:rPr>/, `<w:rPr>${sz}`);
      }
      return `<w:r${attrs}><w:rPr>${sz}</w:rPr>${inner}</w:r>`;
    });
  });
}

export function postProcessConfirmationWordXml(
  xml: string,
  opts: {
    checkInCheckOut?: string;
    paymentMethod?: ReservationPaymentMethod;
  },
): string {
  let s = stripConfirmationWordHighlights(xml);
  if (opts.checkInCheckOut) {
    s = replaceConfirmationCheckInOutTimes(s, opts.checkInCheckOut);
  }
  if (opts.paymentMethod) {
    s = markConfirmationPaymentMethod(s, opts.paymentMethod);
  }
  s = shrinkConfirmationFooterText(s);
  return s;
}
