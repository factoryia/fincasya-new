import { Injectable, BadRequestException } from '@nestjs/common';
import sharp from 'sharp';
import * as path from 'path';
import { promises as fs, constants as fsConstants } from 'fs';

const PUPPETEER_LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
] as const;

const SYSTEM_CHROMIUM_CANDIDATES = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  process.env.CHROME_BIN,
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter((p): p is string => Boolean(p?.trim()));

async function resolveChromiumExecutablePath(): Promise<string | undefined> {
  for (const candidate of SYSTEM_CHROMIUM_CANDIDATES) {
    try {
      await fs.access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Try next path.
    }
  }
  return undefined;
}

async function launchPuppeteerBrowser() {
  const puppeteer = await import('puppeteer');
  const executablePath = await resolveChromiumExecutablePath();
  return puppeteer.launch({
    headless: true,
    args: [...PUPPETEER_LAUNCH_ARGS],
    ...(executablePath ? { executablePath } : {}),
  });
}

export type ReservationPaymentMethod =
  | 'bbva'
  | 'bancolombia'
  | 'davivienda'
  | 'nequi'
  | 'pse'
  | 'tarjeta_credito';

export type ReservationPaymentStatus = 'paid' | 'pending';

export type ReservationConfirmationData = {
  propertyId: string;
  contractNumber: string;
  clientName: string;
  clientId: string;
  clientEmail: string;
  issueDate: string;
  clientPhone: string;
  clientAddress: string;
  propertyName: string;
  propertyLocation: string;
  checkInDate: string;
  checkOutDate: string;
  checkInTime: string;
  checkOutTime: string;
  guests: number;
  nights: number;
  depositAmount: number;
  depositDate: string;
  balanceAmount: number;
  balanceDate: string;
  rentAmount: number;
  cleaningFee: number;
  /** Aseo único por 3+ mascotas (distinto de limpieza general de la finca). */
  petCleaningFee?: number;
  refundableDeposit: number;
  totalAmount: number;
  paymentMethod: ReservationPaymentMethod;
  paymentStatus: ReservationPaymentStatus;
  /** Passthrough al crear reserva desde inbox (no se imprimen en el PDF actual). */
  groupType?: string;
  purpose?: string;
  economicAdjustments?: Array<{
    description: string;
    amount: number;
    type: 'INCREMENT' | 'DISCOUNT';
  }>;
};

@Injectable()
export class PdfService {
  /**
   * Convierte cualquier cadena HTML a PDF usando puppeteer.
   */
  async htmlToPdf(html: string): Promise<Buffer> {
    const browser = await launchPuppeteerBrowser();
    try {
      const page = await browser.newPage();
      page.setDefaultNavigationTimeout(60_000);
      page.setDefaultTimeout(60_000);
      // networkidle0 suele colgar con HTML de contrato (fuentes/CDN que no terminan).
      await page.setContent(html, {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      });
      const pdfBytes = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '20mm', right: '20mm', bottom: '20mm', left: '20mm' },
      });
      return Buffer.from(pdfBytes);
    } finally {
      await browser.close();
    }
  }

  /**
   * Genera el buffer de un PDF de confirmación de reserva.
   */
  async generateReservationConfirmationPdfBuffer(
    data: ReservationConfirmationData,
  ): Promise<Uint8Array> {
    const html = await this.buildReservationConfirmationHtml(data);
    const browser = await launchPuppeteerBrowser();

    try {
      const page = await browser.newPage();
      page.setDefaultNavigationTimeout(60_000);
      page.setDefaultTimeout(60_000);
      await page.setViewport({ width: 1400, height: 990, deviceScaleFactor: 1 });
      await page.emulateMediaType('screen');
      await page.setContent(html, { waitUntil: 'domcontentloaded' });
      const pdfBuffer = await page.pdf({
        width: '297mm',
        height: '210mm',
        printBackground: true,
        preferCSSPageSize: true,
        margin: { top: '0', right: '0', bottom: '0', left: '0' },
      });
      return pdfBuffer;
    } finally {
      await browser.close();
    }
  }

  private async buildReservationConfirmationHtml(
    data: ReservationConfirmationData,
  ): Promise<string> {
    const logoDataUrl = await this.getLocalAssetDataUrl([
      path.resolve(
        process.cwd(),
        '../FincasYaWeb/public/fincasya-negro-logo-reserva.png',
      ),
      path.resolve(process.cwd(), '../FincasYaWeb/public/icons/FincasYA.png'),
      path.resolve(process.cwd(), '../FincasYaWeb/public/fincas-ya-logo.png'),
      path.resolve(
        process.cwd(),
        '../FincasYaWeb/public/icons/fincas-ya-logo.png',
      ),
    ]);
    const whatsappIconDataUrl = await this.getLocalAssetDataUrl([
      path.resolve(process.cwd(), '../FincasYaWeb/public/icons/whatsapp.svg'),
    ]);

    const paymentMarks: Record<ReservationPaymentMethod, string> = {
      bbva: '',
      bancolombia: '',
      davivienda: '',
      nequi: '',
      pse: '',
      tarjeta_credito: '',
    };
    paymentMarks[data.paymentMethod] = 'X';

    const logoHtml = logoDataUrl
      ? `<img src="${logoDataUrl}" alt="FINCASYA LOGO" style="max-width: 250px; max-height: 75px; object-fit: contain;">`
      : `<div style="font-size: 32px; font-weight: 700; color: #e46f3d;">FincasYa</div>`;

    const whatsappIconHtml = whatsappIconDataUrl
      ? `<img src="${whatsappIconDataUrl}" alt="WA">`
      : '';

    const paymentStatusText =
      data.paymentStatus === 'paid' ? 'PAGADO' : 'PENDIENTE DE PAGO';

    const termsText =
      '*NO SE RECIBE PAGO EN EFECTIVO* El presente documento se asimila en todos sus efectos legales a una letra de cambio seg&uacute;n el art&iacute;culo 774 del c&oacute;digo de comercio condiciones generales; FINCASYA no se compromete a realizar devoluciones de dinero en caso de cancelaciones fortuitas por razones ajenas a nuestra voluntad, se aplazar&aacute; la fecha en caso dado siempre y cuando la novedad sea notificada como m&iacute;nimo siete (7) d&iacute;as h&aacute;biles antes de la fecha de ingreso registrada. *Nos reservamos el derecho de admisi&oacute;n en algunas propiedades. *FINCASYA no se har&aacute; responsable de accidentes ocasionados durante su estancia, tampoco por hurtos o da&ntilde;os ocasionados por terceros. *HORARIOS; check in 10:00am en adelante, check out 03:00pm, el hecho de sobrepasar el horario de salida se entender&aacute; como adicional, con una tarifa establecida por hora y ser&aacute;n descontadas del dep&oacute;sito de seguridad. *Las personas adicionales al n&uacute;mero de personas contratadas se considerar&aacute;n como adicional. *Indicar si hay mascotas en el grupo, el hecho de no recoger las necesidades de sus mascotas ser&aacute; motivo de penalidad, de igual forma las mascotas que se suban a las camas y muebles o que ocasionen da&ntilde;os son conductas que dan para multar al responsable contratante. *Solicitar con anticipaci&oacute;n el servicio de apoyo en cocina o cualquier otro servicio adicional. *Los hu&eacute;spedes se comprometen a entregar el inmueble en &oacute;ptimas condiciones tal como se les fue entregado, los da&ntilde;os que pudieren ocasionarse ser&aacute;n descontados del dep&oacute;sito, si el da&ntilde;o supera el valor del dep&oacute;sito ser&aacute; por cuenta del hu&eacute;sped la reposici&oacute;n del bien averiado teni&eacute;ndose un plazo m&aacute;ximo de cinco (5) d&iacute;as h&aacute;biles para reparar el da&ntilde;o. *El dep&oacute;sito se reintegrar&aacute; bien sea a su salida o al d&iacute;a siguiente de la desocupaci&oacute;n una vez se haya concluido la revisi&oacute;n leg&iacute;tima de la propiedad. *En caso de: perturbar el sector con malas pr&aacute;cticas y desobediencia del c&oacute;digo civil colombiano, ri&ntilde;as, altos decibeles en horas no permitidas, fiestas y eventos clandestinos no autorizados ni contratados, agresiones a las autoridades o a terceros; FINCASYA no tendr&aacute; ning&uacute;n nivel de responsabilidad, las imputaciones, multas y sanciones son y ser&aacute;n enteramente por cuenta y responsabilidad del Contratante. *Todos los valores anteriormente mencionados NO incluyen IVA.';

    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Confirmaci&oacute;n de Reserva</title>
  <style>
    @page { size: A4 landscape; margin: 0; }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      width: 297mm;
      height: 210mm;
      font-family: 'Calibri', 'Segoe UI', Arial, sans-serif;
      color: #000;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    body {
      background-color: #f9ebe0;
    }
    .sheet {
      width: 297mm;
      height: 210mm;
      padding: 8mm 9mm 7mm;
      overflow: hidden;
      background-color: #f9ebe0;
      background-image:
        linear-gradient(115deg, transparent 20%, rgba(226, 185, 161, 0.3) 25%, rgba(226, 185, 161, 0.3) 35%, transparent 40%),
        linear-gradient(115deg, transparent 60%, rgba(226, 185, 161, 0.15) 65%, rgba(226, 185, 161, 0.15) 75%, transparent 80%),
        radial-gradient(circle at 5% 5%, rgba(255, 255, 255, 0.9) 0%, rgba(249, 235, 224, 0.6) 40%, rgba(226, 192, 173, 0.8) 100%);
    }
    .wrapper {
      width: 100%;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 4mm;
      padding: 0 2mm;
    }
    .header-logo {
      width: 26%;
      display: flex;
      align-items: center;
    }
    .header-title-container {
      width: 48%;
      text-align: center;
      padding-top: 4mm;
    }
    .header-title {
      font-size: 26px;
      color: #7a8288;
      white-space: nowrap;
    }
    .header-contact {
      width: 26%;
      display: flex;
      justify-content: flex-end;
      align-items: center;
      font-size: 20px;
      font-weight: 600;
      color: #7a8288;
      white-space: nowrap;
    }
    .header-contact img {
      height: 24px;
      margin-right: 8px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      background-color: #eaddd1;
      table-layout: fixed;
    }
    .table-1 {
      margin-bottom: 5mm;
    }
    .table-banks, .table-terms {
      margin-top: -1px;
    }
    th, td {
      border: 1px solid #000;
      padding: 6px 10px;
      vertical-align: middle;
      font-size: 14px;
      line-height: 1.08;
      word-wrap: break-word;
    }
    .peach {
      background-color: #efbc9b;
    }
    .value-cell, .empty-box {
      background-color: #eaddd1;
    }
    .right-align {
      text-align: right;
    }
    .terms-text {
      font-size: 11px;
      text-align: justify;
      padding: 10px 14px;
      line-height: 1.3;
    }
    .payment-mark {
      text-align: center;
      font-weight: 700;
      font-size: 20px;
    }
    .status-row td {
      text-align: center;
      font-weight: 700;
      font-size: 15px;
      padding: 8px;
    }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="wrapper">
      <div class="header">
        <div class="header-logo">${logoHtml}</div>
        <div class="header-title-container">
          <div class="header-title">Confirmaci&oacute;n de Reserva N.&ordm; ${this.escapeHtml(data.contractNumber || '-')}</div>
        </div>
        <div class="header-contact">${whatsappIconHtml} 3007984139</div>
      </div>

      <table class="table-1">
        <tr>
          <td class="peach" style="width: 18%;">NOMBRE</td>
          <td class="value-cell" style="width: 46%;">${this.escapeHtml(data.clientName || '-')}</td>
          <td class="peach" style="width: 11%;">C. C.</td>
          <td class="value-cell" style="width: 25%;">${this.escapeHtml(data.clientId || '-')}</td>
        </tr>
        <tr>
          <td class="peach">Correo electr&oacute;nico</td>
          <td class="value-cell">${this.escapeHtml(data.clientEmail || '-')}</td>
          <td class="peach">Fecha</td>
          <td class="value-cell">${this.escapeHtml(this.formatDateDisplay(data.issueDate))}</td>
        </tr>
        <tr>
          <td class="peach">Tel de contacto</td>
          <td class="value-cell">${this.escapeHtml(data.clientPhone || '-')}</td>
          <td class="peach">DIRECCI&Oacute;N</td>
          <td class="value-cell">${this.escapeHtml(data.clientAddress || '-')}</td>
        </tr>
      </table>

      <table class="table-2">
        <tr>
          <td class="peach" style="width: 18%;">Propiedad</td>
          <td class="value-cell" style="width: 31%;">${this.escapeHtml(data.propertyName || '-')}</td>
          <td colspan="2" class="value-cell" style="width: 32%;">Contrato: ${this.escapeHtml(data.contractNumber || '-')}</td>
          <td rowspan="6" class="empty-box" style="width: 19%;"></td>
        </tr>
        <tr>
          <td class="peach">Ubicaci&oacute;n</td>
          <td colspan="3" class="value-cell">${this.escapeHtml(data.propertyLocation || '-')}</td>
        </tr>
        <tr>
          <td class="peach">Fecha de Ingreso</td>
          <td class="value-cell">${this.escapeHtml(this.formatDateLong(data.checkInDate))}</td>
          <td class="peach" style="width: 16%;">Fecha de Salida</td>
          <td class="value-cell" style="width: 16%;">${this.escapeHtml(this.formatDateLong(data.checkOutDate))}</td>
        </tr>
        <tr>
          <td class="peach">Chek In / Chek Out</td>
          <td colspan="3" class="value-cell">${this.escapeHtml(this.formatTimeDisplay(data.checkInTime))} / ${this.escapeHtml(this.formatTimeDisplay(data.checkOutTime))}</td>
        </tr>
        <tr>
          <td class="peach">Hu&eacute;spedes</td>
          <td class="value-cell">${this.escapeHtml(String(data.guests || 1))}</td>
          <td class="peach">Noches</td>
          <td class="value-cell">${this.escapeHtml(String(data.nights || 1).padStart(2, '0'))}</td>
        </tr>
        <tr>
          <td class="peach">Tipo de grupo</td>
          <td class="value-cell">${this.escapeHtml((data.groupType || '').trim() || '-')}</td>
          <td colspan="2" class="peach">Prop&oacute;sito estancia</td>
          <td class="value-cell">${this.escapeHtml((data.purpose || '').trim() || '-')}</td>
        </tr>
        <tr>
          <td class="peach">Valor Abono</td>
          <td class="value-cell">${this.escapeHtml(this.formatCurrency(data.depositAmount))}</td>
          <td colspan="2" class="peach right-align">Valor Alquiler</td>
          <td class="value-cell">${this.escapeHtml(this.formatCurrency(data.rentAmount))}</td>
        </tr>
        <tr>
          <td class="peach">Fecha Abono</td>
          <td class="value-cell">${this.escapeHtml(this.formatDateLong(data.depositDate))}</td>
          <td colspan="2" class="peach right-align">Valor Limpieza General</td>
          <td class="value-cell">${this.escapeHtml(this.formatCurrency(data.cleaningFee))}</td>
        </tr>
        ${
          (data.petCleaningFee ?? 0) > 0
            ? `<tr>
          <td class="peach"></td>
          <td class="value-cell"></td>
          <td colspan="2" class="peach right-align">Aseo por mascotas (3+)</td>
          <td class="value-cell">${this.escapeHtml(this.formatCurrency(data.petCleaningFee ?? 0))}</td>
        </tr>`
            : ''
        }
        ${
          (data.economicAdjustments ?? [])
            .map(
              (item) => `<tr>
          <td class="peach"></td>
          <td class="value-cell"></td>
          <td colspan="2" class="peach right-align">${this.escapeHtml(item.type === 'INCREMENT' ? `Ajuste: ${item.description}` : `Descuento: ${item.description}`)}</td>
          <td class="value-cell">${this.escapeHtml(this.formatCurrency(item.type === 'INCREMENT' ? item.amount : -item.amount))}</td>
        </tr>`,
            )
            .join('') || ''
        }
        <tr>
          <td class="peach">Valor Saldo</td>
          <td class="value-cell">${this.escapeHtml(this.formatCurrency(data.balanceAmount))}</td>
          <td colspan="2" class="peach right-align">*Valor Dep&oacute;sito Reembolsable</td>
          <td class="value-cell">${this.escapeHtml(this.formatCurrency(data.refundableDeposit))}</td>
        </tr>
        <tr>
          <td class="peach">Fecha Saldo</td>
          <td class="value-cell">${this.escapeHtml(this.formatDateLong(data.balanceDate))}</td>
          <td colspan="2" class="peach right-align">Valor TOTAL</td>
          <td class="value-cell">${this.escapeHtml(this.formatCurrency(data.totalAmount))}</td>
        </tr>
      </table>

      <table class="table-banks">
        <tr>
          <td style="width: 10%;">BBVA</td><td style="width: 5%;" class="payment-mark">${paymentMarks.bbva}</td>
          <td style="width: 12%;">Bancolombia</td><td style="width: 5%;" class="payment-mark">${paymentMarks.bancolombia}</td>
          <td style="width: 12%;">Davivienda</td><td style="width: 5%;" class="payment-mark">${paymentMarks.davivienda}</td>
          <td style="width: 10%;">Nequi</td><td style="width: 5%;" class="payment-mark">${paymentMarks.nequi}</td>
          <td style="width: 8%;">PSE</td><td style="width: 5%;" class="payment-mark">${paymentMarks.pse}</td>
          <td style="width: 15%;">Tarjeta Cr&eacute;dito</td><td style="width: 8%;" class="payment-mark">${paymentMarks.tarjeta_credito}</td>
        </tr>
        <tr class="status-row">
          <td colspan="12">ESTADO DE PAGO: ${this.escapeHtml(paymentStatusText)}</td>
        </tr>
      </table>

      <table class="table-terms">
        <tr>
          <td class="terms-text">${termsText}</td>
        </tr>
      </table>
    </div>
  </div>
</body>
</html>`;
  }

  /**
   * Lee un archivo local del disco y lo devuelve como data URL base64,
   * intentando los candidatos en orden. Retorna `null` si ninguno existe.
   * Pública para que otros servicios (ej. `FincasService`) puedan incrustar
   * imágenes en sus HTML antes de pasarlos a `htmlToPdf`.
   */
  async getLocalAssetDataUrl(
    candidatePaths: string[],
  ): Promise<string | null> {
    for (const filePath of candidatePaths) {
      try {
        await fs.access(filePath);
        const fileBuffer = await fs.readFile(filePath);
        const ext = path.extname(filePath).toLowerCase();
        const mime =
          ext === '.png'
            ? 'image/png'
            : ext === '.svg'
              ? 'image/svg+xml'
              : ext === '.jpg' || ext === '.jpeg'
                ? 'image/jpeg'
                : 'application/octet-stream';
        return `data:${mime};base64,${fileBuffer.toString('base64')}`;
      } catch {
        // Try next path.
      }
    }
    return null;
  }

  private escapeHtml(value: string): string {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private formatTimeDisplay(time: string): string {
    const raw = String(time || '').trim();
    if (!raw) return '-';
    const match = raw.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return raw;
    let h = Number(match[1]);
    const mm = match[2];
    const suffix = h >= 12 ? 'PM' : 'AM';
    if (h === 0) h = 12;
    if (h > 12) h -= 12;
    return `${String(h).padStart(2, '0')}:${mm} ${suffix}`;
  }

  private formatDateDisplay(dateLike: string): string {
    const iso = this.toIsoDate(dateLike);
    if (!iso) return '-';
    const [year, month, day] = iso.split('-');
    return `${day}/${month}/${year}`;
  }

  private formatDateLong(dateLike: string): string {
    const iso = this.toIsoDate(dateLike);
    if (!iso) return '-';
    const [year, month, day] = iso.split('-');
    const months = [
      'ENERO',
      'FEBRERO',
      'MARZO',
      'ABRIL',
      'MAYO',
      'JUNIO',
      'JULIO',
      'AGOSTO',
      'SEPTIEMBRE',
      'OCTUBRE',
      'NOVIEMBRE',
      'DICIEMBRE',
    ];
    const monthName = months[Math.max(0, Math.min(11, Number(month) - 1))];
    return `${day} DE ${monthName} DEL ${year}`;
  }

  private formatCurrency(value: number): string {
    const safe = Number.isFinite(value) ? value : 0;
    return new Intl.NumberFormat('es-CO', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(safe);
  }

  public toIsoDate(value: any): string {
    if (!value) return '';
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return this.dateToIso(value);
    }
    const raw = String(value).trim();
    if (!raw) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      return raw;
    }
    const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (slash) {
      const day = slash[1].padStart(2, '0');
      const month = slash[2].padStart(2, '0');
      return `${slash[3]}-${month}-${day}`;
    }
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      return this.dateToIso(parsed);
    }
    return '';
  }

  private dateToIso(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  public toNumber(value: any): number {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const cleaned = String(value ?? '')
      .replace(/[^\d.-]/g, '')
      .trim();
    if (!cleaned) return 0;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  public calculateNights(checkInDate: string, checkOutDate: string): number {
    if (!checkInDate || !checkOutDate) return 1;
    const start = new Date(`${checkInDate}T00:00:00`);
    const end = new Date(`${checkOutDate}T00:00:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 1;
    const diffMs = end.getTime() - start.getTime();
    return Math.max(1, Math.round(diffMs / (1000 * 60 * 60 * 24)));
  }

  public normalizePaymentMethod(value: string): ReservationPaymentMethod {
    const normalized = String(value || '')
      .toLowerCase()
      .replace(/\s+/g, '_');
    const allowed: ReservationPaymentMethod[] = [
      'bbva',
      'bancolombia',
      'davivienda',
      'nequi',
      'pse',
      'tarjeta_credito',
    ];
    return allowed.includes(normalized as ReservationPaymentMethod)
      ? (normalized as ReservationPaymentMethod)
      : 'bancolombia';
  }

  /** Convierte WebP y otros formatos no soportados por WhatsApp a JPEG */
  async ensureImageCompatible(
    file: Express.Multer.File,
  ): Promise<Express.Multer.File> {
    const mime = (file.mimetype || '').toLowerCase();
    if (['image/jpeg', 'image/png'].includes(mime)) {
      return file;
    }
    if (!file.buffer) {
      throw new BadRequestException('El archivo no tiene buffer en memoria');
    }
    try {
      const jpegBuffer = await sharp(file.buffer)
        .jpeg({ quality: 90 })
        .toBuffer();
      const baseName = (file.originalname || 'image').replace(/\.[^.]+$/, '');
      return {
        ...file,
        buffer: jpegBuffer,
        mimetype: 'image/jpeg',
        originalname: `${baseName}.jpg`,
      } as Express.Multer.File;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new BadRequestException(
        `No se pudo convertir la imagen a JPEG: ${msg}. Use JPEG o PNG.`,
      );
    }
  }
}
