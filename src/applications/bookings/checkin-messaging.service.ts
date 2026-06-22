import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConvexService } from '../shared/services/convex.service';
import { S3Service } from '../shared/services/s3.service';
import { PdfService } from '../shared/services/pdf.service';
import { addDays, startOfDay, endOfDay, getDay } from 'date-fns';

/** Clave lógica de cada momento del timeline (debe coincidir con el catálogo Convex). */
export type CheckinMomentKey =
  | 'owner_week_reminder'
  | 'tourist_checkin_start'
  | 'tourist_checkin_pending'
  | 'tourist_travel_tomorrow'
  | 'owner_arrival_tomorrow'
  | 'tourist_departure';

/** Cuenta propia de una reserva (importada de un propietario), no del catálogo global. */
export type PortalExtraBankAccount = {
  id: string;
  bankName: string;
  accountType?: string;
  accountNumber: string;
  ownerName: string;
  ownerCedula?: string;
  imageUrl?: string;
  imageUrls?: string[];
  qrOnly?: boolean;
  brebKey?: boolean;
};

type MomentWindow = {
  key: CheckinMomentKey;
  minDate: number;
  maxDate: number;
};

type BatchRecipient = {
  bookingId?: string;
  to: string;
  recipientName?: string;
  bodyParams: string[];
  logToInbox?: boolean;
};

type MomentResult = {
  key: string;
  template: string;
  candidates: number;
  planned: number;
  sent: number;
  failed: number;
  dryRun: boolean;
  details: Array<{
    to: string;
    recipientType: string;
    ok: boolean;
    wamid?: string;
    error?: string;
  }>;
};

/**
 * Motor de recordatorios programados del flujo de check-in (spec §3).
 *
 * Calcula las ventanas de fecha de cada momento del timeline (relativas a HOY,
 * en hora local del servidor) y delega el envío de plantillas Meta a las
 * actions de Convex (`checkinMessaging:*`), que iteran 1-a-1 sobre YCloud.
 */
@Injectable()
export class CheckinMessagingService {
  private readonly logger = new Logger(CheckinMessagingService.name);

  constructor(
    private readonly convexService: ConvexService,
    private readonly s3Service: S3Service,
    private readonly pdfService: PdfService,
  ) {}

  /** Cron diario: dispara cada momento del timeline cuyo día aplique hoy. */
  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async handleDailyCron() {
    this.logger.log('Iniciando motor de mensajería de check-in (timeline §3)...');
    const windows = this.computeDailyWindows(new Date());
    for (const w of windows) {
      try {
        const result = await this.runMoment(w);
        this.logger.log(
          `[${w.key}] candidatos=${result?.candidates ?? 0} planeados=${result?.planned ?? 0} enviados=${result?.sent ?? 0} fallidos=${result?.failed ?? 0}`,
        );
      } catch (error) {
        this.logger.error(
          `[${w.key}] error ejecutando momento: ${(error as Error).message}`,
        );
      }
    }
    this.logger.log('Motor de mensajería de check-in finalizado.');
  }

  /**
   * Ventanas de fecha para HOY. Cada reserva recibe un único mensaje por
   * momento (dedupe en Convex). Algunos momentos solo aplican ciertos días.
   */
  computeDailyWindows(today: Date): MomentWindow[] {
    const windows: MomentWindow[] = [];

    // Lunes: recordatorio a propietarios de fincas que entran ESTA semana.
    if (getDay(today) === 1) {
      windows.push({
        key: 'owner_week_reminder',
        minDate: startOfDay(today).getTime(),
        maxDate: endOfDay(addDays(today, 6)).getTime(),
      });
    }

    // Inicio de check-in: 3 días antes de la llegada.
    const inThreeDays = addDays(today, 3);
    windows.push({
      key: 'tourist_checkin_start',
      minDate: startOfDay(inThreeDays).getTime(),
      maxDate: endOfDay(inThreeDays).getTime(),
    });

    // Día antes (llegada mañana): recordatorio de check-in pendiente,
    // recordatorio de viaje (a quien ya hizo check-in) y avisos a
    // propietario + encargado.
    const tomorrow = addDays(today, 1);
    const tomorrowMin = startOfDay(tomorrow).getTime();
    const tomorrowMax = endOfDay(tomorrow).getTime();
    windows.push({ key: 'tourist_checkin_pending', minDate: tomorrowMin, maxDate: tomorrowMax });
    windows.push({ key: 'tourist_travel_tomorrow', minDate: tomorrowMin, maxDate: tomorrowMax });
    windows.push({ key: 'owner_arrival_tomorrow', minDate: tomorrowMin, maxDate: tomorrowMax });

    // Día de salida: mensaje de salida a quienes viajan hoy.
    windows.push({
      key: 'tourist_departure',
      minDate: startOfDay(today).getTime(),
      maxDate: endOfDay(today).getTime(),
    });

    return windows;
  }

  private async runMoment(w: MomentWindow, dryRun = false): Promise<MomentResult> {
    return (await this.convexService.action('checkinMessaging:runScheduledMoment', {
      key: w.key,
      minDate: w.minDate,
      maxDate: w.maxDate,
      dryRun,
    })) as MomentResult;
  }

  /** Dispara manualmente todos los momentos de hoy (útil para pruebas). */
  async triggerDailyManually(dryRun = false) {
    const windows = this.computeDailyWindows(new Date());
    const results = [];
    for (const w of windows) {
      results.push(await this.runMoment(w, dryRun));
    }
    return results;
  }

  /** Dispara un único momento con una ventana de fecha explícita. */
  async triggerMoment(
    key: CheckinMomentKey,
    minDate: number,
    maxDate: number,
    tag?: string,
    dryRun = false,
  ) {
    return this.convexService.action('checkinMessaging:runScheduledMoment', {
      key,
      minDate,
      maxDate,
      tag,
      dryRun,
    });
  }

  /** Catálogo de plantillas (para la UI de envío en lote). */
  async listTemplates() {
    return this.convexService.query('checkinMessaging:listCheckinTemplates', {});
  }

  /** Reservas candidatas (con params por defecto) para el envío en lote. */
  async listBookingsForBatch(
    templateKey: string,
    minDate: number,
    maxDate: number,
    tag?: string,
  ) {
    return this.convexService.query('checkinMessaging:listBookingsForBatch', {
      templateKey,
      minDate,
      maxDate,
      tag,
    });
  }

  /** Envío en lote con destinatarios ya editados por el equipo (spec §10). */
  async sendBatch(
    templateKey: string,
    recipients: BatchRecipient[],
    dryRun = false,
  ) {
    return this.convexService.action('checkinMessaging:sendBatchTemplate', {
      templateKey,
      recipients,
      dryRun,
    });
  }

  /** Registra (crea) las plantillas del catálogo en YCloud/Meta. */
  async registerTemplates(wabaId?: string, onlyKeys?: string[]) {
    return this.convexService.action('checkinMessaging:registerCheckinTemplates', {
      wabaId,
      onlyKeys,
    });
  }

  /** Etiqueta de lote (ej. "puente_festivo") sobre una reserva. */
  async setBroadcastTag(bookingId: string, tag: string | null) {
    return this.convexService.mutation('checkinMessaging:setBroadcastTag', {
      bookingId,
      tag,
    });
  }

  /** Envío manual de una plantilla a UNA reserva (desde el modal de Reservas). */
  async sendTemplateToBooking(
    bookingId: string,
    templateKey: string,
    dryRun = false,
  ) {
    return this.convexService.action('checkinMessaging:sendTemplateToBooking', {
      bookingId,
      templateKey,
      dryRun,
    });
  }

  /** Resumen de pago + imágenes QR/flyer por WhatsApp (YCloud). */
  async sendPaymentSummary(
    bookingId: string,
    payload: {
      messageText: string;
      images: Array<{ label?: string; imageUrl: string }>;
      dryRun?: boolean;
    },
  ) {
    return this.convexService.action(
      'checkinPaymentSend:sendPaymentSummaryToBooking',
      {
        bookingId,
        messageText: payload.messageText,
        images: payload.images,
        dryRun: Boolean(payload.dryRun),
      },
    );
  }

  /** Check-in manual / marcar completado (spec §8.1). */
  async setCheckinCompleted(bookingId: string, completed: boolean) {
    return this.convexService.mutation('checkinMessaging:setCheckinCompleted', {
      bookingId,
      completed,
    });
  }

  /** Link del portal de check-in (para copiar sin enviar por WhatsApp). */
  async getCheckinLink(bookingId: string) {
    return this.convexService.query('checkinMessaging:getCheckinLink', {
      bookingId,
    });
  }

  /** Link del portal de pago compartible con el cliente. */
  async getPaymentLink(bookingId: string) {
    return this.convexService.query('paymentPortal:getPaymentLink', {
      bookingId,
    });
  }

  /** Marca/desmarca manualmente el check-in como enviado (etapa morado). */
  async markCheckinSent(bookingId: string, sent: boolean) {
    return this.convexService.mutation('bookings:markCheckinSent', {
      id: bookingId,
      sent,
    });
  }

  /** Vista pública para el propietario (por referencia, solo lectura). */
  async getOwnerView(reference: string) {
    const trimmed = String(reference ?? '').trim();
    if (!trimmed) return null;
    const booking: any = await this.convexService.query(
      'bookings:getByReference',
      { reference: trimmed },
    );
    if (!booking) return null;

    const property = booking.property || {};
    const allGuests = (booking.checkinGuests || []).filter(
      (g: any) => !g.esMenor,
    );
    const maskCedula = (c?: string) => {
      const d = String(c ?? '').replace(/\D/g, '');
      return d.length >= 4 ? `••••${d.slice(-4)}` : d ? '••••' : '';
    };
    const empleada = booking.needsTeam
      ? 'varias'
      : booking.needsEmpleada
        ? 'una'
        : 'no';
    const pdf = (booking.multimedia || []).find(
      (m: any) =>
        m.type === 'application/pdf' && /invitad|guest/i.test(m.name || ''),
    );

    return {
      reference: booking.reference || trimmed,
      propertyTitle: property.title || 'tu finca',
      propertyLocation: property.location || null,
      ownerName: property.propietarioNombre || null,
      fechaEntrada: booking.fechaEntrada,
      fechaSalida: booking.fechaSalida,
      horaEntrada: booking.horaEntrada ?? null,
      numeroPersonas: booking.numeroPersonas ?? null,
      empleada, // 'no' | 'una' | 'varias'
      checkinCompleted: Boolean(booking.checkinCompleted),
      guestCount: allGuests.length,
      guests: allGuests.map((g: any) => ({
        nombre: g.nombreCompleto,
        cedula: maskCedula(g.cedula),
        tipoDocumento: String(g.tipoDocumento ?? 'CC').trim().toUpperCase() || 'CC',
      })),
      invitadosPdfUrl: pdf?.url || null,
    };
  }

  /**
   * Genera al vuelo el PDF del listado de invitados para el propietario,
   * a partir del check-in del turista (no depende de multimedia).
   * Devuelve null si la reserva no existe o no hay invitados diligenciados.
   */
  async getOwnerGuestsPdf(
    reference: string,
  ): Promise<{ buffer: Buffer; filename: string } | null> {
    const trimmed = String(reference ?? '').trim();
    if (!trimmed) return null;
    const booking: any = await this.convexService.query(
      'bookings:getByReference',
      { reference: trimmed },
    );
    if (!booking) return null;

    const guests = (booking.checkinGuests || []).filter((g: any) => !g.esMenor);
    if (guests.length === 0) return null;

    const property = booking.property || {};
    const esc = (v: unknown) =>
      String(v ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    const fmtFecha = (ms?: number) =>
      ms
        ? new Intl.DateTimeFormat('es-CO', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
            timeZone: 'America/Bogota',
          }).format(new Date(ms))
        : '—';

    const metaPairs: Array<[string, string]> = [
      ['Propiedad', property.title || 'Propiedad'],
      ...(property.location
        ? ([['Ubicación', property.location]] as Array<[string, string]>)
        : []),
      ['Titular de la reserva', booking.nombreCompleto || '—'],
      ['Referencia', booking.reference || trimmed],
      ['Entrada', fmtFecha(booking.fechaEntrada)],
      ['Salida', fmtFecha(booking.fechaSalida)],
      ['Personas', String(booking.numeroPersonas ?? guests.length)],
    ];
    const metaRows = metaPairs
      .map(
        ([k, v]) =>
          `<tr><th style="border:1px solid #ddd;background:#f5f5f5;text-align:left;width:34%;padding:6px 10px;">${esc(
            k,
          )}</th><td style="border:1px solid #ddd;padding:6px 10px;">${esc(
            v,
          )}</td></tr>`,
      )
      .join('');

    const guestRows = guests
      .map(
        (g: any, i: number) =>
          `<tr><td style="border:1px solid #ddd;text-align:center;width:36px;padding:6px 10px;">${
            i + 1
          }</td><td style="border:1px solid #ddd;padding:6px 10px;">${esc(
            g.nombreCompleto || '—',
          )}</td><td style="border:1px solid #ddd;padding:6px 10px;">${esc(
            g.esMenor
              ? 'Menor de 2 años'
              : g.cedula?.trim()
                ? `${String(g.tipoDocumento ?? 'CC').trim().toUpperCase() || 'CC'} ${g.cedula.trim()}`
                : 'Sin documento',
          )}</td></tr>`,
      )
      .join('');

    const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8" />
<style>
  body { font-family: Arial, 'Segoe UI', sans-serif; color: #111; padding: 8px; }
  h1 { font-size: 16pt; margin: 0 0 4pt; text-align: center; }
  p.sub { text-align: center; color: #555; font-size: 10pt; margin: 0 0 16pt; }
  h2 { font-size: 12pt; margin: 0 0 8pt; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16pt; font-size: 11pt; }
</style></head>
<body>
  <h1>Lista de invitados — Check-in</h1>
  <p class="sub">Documento generado por Fincas Ya para el propietario.</p>
  <table><tbody>${metaRows}</tbody></table>
  <h2>Personas registradas (${guests.length})</h2>
  <table>
    <thead><tr>
      <th style="border:1px solid #ddd;background:#f5f5f5;padding:6px 10px;width:36px;">#</th>
      <th style="border:1px solid #ddd;background:#f5f5f5;text-align:left;padding:6px 10px;">Nombre completo</th>
      <th style="border:1px solid #ddd;background:#f5f5f5;text-align:left;padding:6px 10px;">Documento</th>
    </tr></thead>
    <tbody>${guestRows}</tbody>
  </table>
</body></html>`;

    const buffer = await this.pdfService.htmlToPdf(html);
    const safeRef = String(booking.reference || trimmed).replace(
      /[^a-zA-Z0-9_-]/g,
      '_',
    );
    return { buffer, filename: `Invitados-${safeRef}.pdf` };
  }

  /** Guarda cuentas/imágenes visibles en el portal de pago. */
  async savePaymentPortalConfig(
    bookingId: string,
    payload: {
      bankAccountIds: string[];
      paymentMediaIds?: string[];
      extraBankAccounts?: PortalExtraBankAccount[];
      boldLink?: string;
      boldSurcharge?: number;
    },
  ) {
    const extraBankAccounts = (payload.extraBankAccounts ?? [])
      .filter((a) => a && a.id)
      .map((a) => ({
        id: String(a.id),
        bankName: String(a.bankName ?? ''),
        accountType: a.accountType != null ? String(a.accountType) : undefined,
        accountNumber: String(a.accountNumber ?? ''),
        ownerName: String(a.ownerName ?? ''),
        ownerCedula: a.ownerCedula != null ? String(a.ownerCedula) : undefined,
        imageUrl: a.imageUrl != null ? String(a.imageUrl) : undefined,
        imageUrls: Array.isArray(a.imageUrls)
          ? a.imageUrls.map((u) => String(u))
          : undefined,
        qrOnly: a.qrOnly != null ? Boolean(a.qrOnly) : undefined,
        brebKey: a.brebKey != null ? Boolean(a.brebKey) : undefined,
      }));

    return this.convexService.mutation('paymentPortal:savePaymentPortalConfig', {
      bookingId,
      bankAccountIds: payload.bankAccountIds,
      paymentMediaIds: payload.paymentMediaIds ?? [],
      extraBankAccounts:
        extraBankAccounts.length > 0 ? extraBankAccounts : undefined,
      boldLink: payload.boldLink,
      boldSurcharge: payload.boldSurcharge,
    });
  }

  /** Datos públicos del portal de pago por CR o id de reserva. */
  async getPaymentPortalByReference(key: string) {
    const trimmed = String(key ?? '').trim();
    if (!trimmed) return null;

    try {
      const data = await this.convexService.query(
        'paymentPortal:getByReference',
        { key: trimmed },
      );
      if (data) return data;
    } catch {
      /* query aún no desplegada: intentar HTTP de Convex */
    }

    const base =
      process.env.CONVEX_SITE_URL ||
      'https://adventurous-octopus-651.convex.site';
    try {
      const res = await fetch(
        `${base.replace(/\/+$/, '')}/api/payment/${encodeURIComponent(trimmed)}`,
      );
      if (res.status === 404) return null;
      if (!res.ok) return null;
      const json = (await res.json()) as Record<string, unknown>;
      if (json?.error === 'not_found') return null;
      return json;
    } catch {
      return null;
    }
  }

  /** Sube soporte de pago al portal (proxy a Convex HTTP). */
  async submitPaymentPortalReceipt(
    key: string,
    payload: {
      file: Express.Multer.File;
      bankAccountId?: string;
      bankName?: string;
      amount?: number;
    },
  ) {
    const trimmed = String(key ?? '').trim();
    if (!trimmed) {
      throw new Error('Referencia inválida');
    }

    const base =
      process.env.CONVEX_SITE_URL ||
      'https://adventurous-octopus-651.convex.site';

    // Subimos el comprobante a S3 y guardamos solo la URL. Antes se enviaba el
    // archivo como base64 al doc de la reserva en Convex, que tiene un límite
    // de 1 MiB: un comprobante grande lo desbordaba y la subida fallaba.
    const receiptUrl = await this.s3Service.uploadImage(payload.file);

    const res = await fetch(
      `${base.replace(/\/+$/, '')}/api/payment/${encodeURIComponent(trimmed)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receiptUrl,
          fileName: payload.file.originalname || 'comprobante.jpg',
          mimeType: payload.file.mimetype || 'image/jpeg',
          bankAccountId: payload.bankAccountId,
          bankName: payload.bankName,
          amount:
            payload.amount != null && payload.amount > 0
              ? payload.amount
              : undefined,
        }),
      },
    );

    const text = await res.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { error: text || res.statusText };
    }

    if (!res.ok) {
      throw new Error(
        typeof body === 'object' &&
          body !== null &&
          'error' in body &&
          typeof (body as { error: unknown }).error === 'string'
          ? (body as { error: string }).error
          : 'No se pudo enviar el comprobante',
      );
    }

    return body;
  }
}
