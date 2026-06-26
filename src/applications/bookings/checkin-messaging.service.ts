import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConvexService } from '../shared/services/convex.service';
import { S3Service } from '../shared/services/s3.service';
import { PdfService } from '../shared/services/pdf.service';
import { BrevoEmailService } from '../shared/services/brevo-email.service';
import { addDays, startOfDay, endOfDay, getDay } from 'date-fns';
import {
  GuestListPdfService,
  type GuestListPdfInput,
} from './guest-list-pdf.service';

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

export type OwnerPortalShareView = {
  showGuestList: boolean;
  showPlates: boolean;
  showEmpleada: boolean;
  showInternalNotes: boolean;
};

export function resolveOwnerPortalShare(
  share?: Record<string, boolean | undefined> | null,
): OwnerPortalShareView {
  return {
    showGuestList: share?.showGuestList !== false,
    showPlates: share?.showPlates !== false,
    showEmpleada: share?.showEmpleada !== false,
    showInternalNotes: share?.showInternalNotes === true,
  };
}

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
    private readonly brevoEmail: BrevoEmailService,
    private readonly guestListPdfService: GuestListPdfService,
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
    const portalShare = resolveOwnerPortalShare(
      booking.ownerPortalShare as Record<string, boolean | undefined> | null,
    );
    const shareGuests = portalShare.showGuestList;

    return {
      reference: booking.reference || trimmed,
      propertyTitle: property.title || 'tu finca',
      propertyLocation: property.location || null,
      ownerName: property.propietarioNombre || null,
      ownerTratamiento: property.propietarioTratamiento || null,
      fechaEntrada: booking.fechaEntrada,
      fechaSalida: booking.fechaSalida,
      horaEntrada: booking.horaEntrada ?? null,
      numeroPersonas: booking.numeroPersonas ?? null,
      empleada, // 'no' | 'una' | 'varias'
      placas: String(booking.checkinPlacas ?? '').trim() || null,
      allowsPets: (property as { allowsPets?: boolean })?.allowsPets === true,
      requiresGuestList:
        (property as { requiresGuestList?: boolean })?.requiresGuestList !==
        false,
      mascotas:
        typeof booking.checkinMascotas === 'number'
          ? booking.checkinMascotas
          : Number(booking.numeroMascotas) || 0,
      checkinCompleted: Boolean(booking.checkinCompleted),
      guestCount: shareGuests ? allGuests.length : 0,
      guests: shareGuests
        ? allGuests.map((g: any) => ({
            nombre: g.nombreCompleto,
            cedula: maskCedula(g.cedula),
            tipoDocumento:
              String(g.tipoDocumento ?? 'CC').trim().toUpperCase() || 'CC',
          }))
        : [],
      invitadosPdfUrl: shareGuests ? pdf?.url || null : null,
      // Para el propietario ocultamos la línea de "Invitados adicionales (sujeto a
      // aprobación)": esos los aprueba el equipo admin de Fincas Ya, no el propietario.
      checkinObservaciones:
        String(booking.checkinObservaciones ?? '')
          .split('\n')
          .filter((l) => !l.trim().startsWith('Invitados adicionales'))
          .join('\n')
          .trim() || null,
      serviciosNota: String(booking.checkinServiciosNota ?? '').trim() || null,
      clientObservaciones: String(booking.clientObservaciones ?? '').trim() || null,
      ownerPortalShare: portalShare,
      ownerReceiver: booking.ownerReceiver
        ? {
            nombre: String(booking.ownerReceiver.nombre ?? '').trim() || null,
            contacto:
              String(booking.ownerReceiver.contacto ?? '').trim() || null,
          }
        : null,
      ownerPayout: booking.ownerPayout
        ? (() => {
            const op = booking.ownerPayout as {
              valorAcordado?: number;
              abono?: number;
              valor?: number;
              fecha?: string;
              medio?: string;
              comprobanteUrl?: string;
              abonos?: Array<{ id: string; amount: number; fecha?: string; medio?: string; comprobanteUrl?: string; createdAt: number; actor?: string }>;
            };
            const valorAcordado =
              typeof op.valorAcordado === 'number' ? op.valorAcordado : null;
            const abonosFromList = Array.isArray(op.abonos)
              ? op.abonos.filter((a) => (Number(a.amount) || 0) > 0)
              : [];
            const abonoFromList = abonosFromList.reduce(
              (sum, item) => sum + (Number(item.amount) || 0),
              0,
            );
            const abono =
              abonoFromList > 0
                ? abonoFromList
                : typeof op.abono === 'number'
                  ? op.abono
                  : null;
            const saldo =
              valorAcordado != null
                ? Math.max(0, valorAcordado - (abono ?? 0))
                : null;
            return {
              valorAcordado,
              abono,
              saldo,
              abonos: abonosFromList.map((a) => ({
                id: a.id,
                amount: a.amount,
                fecha: a.fecha ?? null,
                medio: a.medio ?? null,
                comprobanteUrl: a.comprobanteUrl ?? null,
                createdAt: a.createdAt,
              })),
              valor: typeof op.valor === 'number' ? op.valor : null,
              fecha: op.fecha ?? null,
              medio: op.medio ?? null,
              comprobanteUrl: op.comprobanteUrl ?? null,
            };
          })()
        : null,
      // Devolución del depósito (Fase 3): estado para que el propietario valide.
      depositoGarantia: Number(booking.depositoGarantia) || 0,
      depositReturn: booking.depositReturn
        ? {
            estado: booking.depositReturn.estado ?? 'pendiente_validacion',
            devuelto:
              typeof booking.depositReturn.devolucion?.valor === 'number'
                ? booking.depositReturn.devolucion.valor
                : null,
          }
        : null,
    };
  }

  /** Check-out propietario (Fase 1): guarda observaciones del cliente (con log). */
  async saveClientObservaciones(
    bookingId: string,
    valor: string,
    actor?: string,
  ) {
    return this.convexService.mutation('bookings:saveClientObservaciones', {
      id: bookingId,
      valor: String(valor ?? ''),
      actor: actor?.trim() || undefined,
    });
  }

  /** Qué información del check-in ve el propietario en /anfitrion. */
  async saveOwnerPortalShare(
    bookingId: string,
    share: {
      showGuestList?: boolean;
      showPlates?: boolean;
      showEmpleada?: boolean;
      showInternalNotes?: boolean;
    },
  ) {
    return this.convexService.mutation('bookings:saveOwnerPortalShare', {
      id: bookingId,
      ...share,
    });
  }

  /** Check-out propietario (Fase 1): registra/edita el pago al propietario. */
  async saveOwnerPayout(
    bookingId: string,
    payload: {
      valorAcordado?: number;
      abono?: number;
      valor?: number;
      fecha?: string;
      medio?: string;
      actor?: string;
    },
    comprobante?: Express.Multer.File,
  ) {
    let comprobanteUrl: string | undefined;
    if (comprobante) {
      comprobanteUrl = await this.s3Service.uploadFile(
        comprobante,
        'owners/payouts',
      );
    }
    const num = (v?: number) =>
      v !== undefined && Number.isFinite(v) ? v : undefined;
    return this.convexService.mutation('bookings:saveOwnerPayout', {
      id: bookingId,
      valorAcordado: num(payload.valorAcordado),
      abono: num(payload.abono),
      valor: num(payload.valor),
      fecha: payload.fecha?.trim() || undefined,
      medio: payload.medio?.trim() || undefined,
      comprobanteUrl,
      actor: payload.actor?.trim() || undefined,
    });
  }

  async addOwnerPayoutAbono(
    bookingId: string,
    payload: {
      amount: number;
      fecha?: string;
      medio?: string;
      actor?: string;
    },
    comprobante?: Express.Multer.File,
  ) {
    let comprobanteUrl: string | undefined;
    if (comprobante) {
      comprobanteUrl = await this.s3Service.uploadFile(
        comprobante,
        'owners/payouts',
      );
    }
    return this.convexService.mutation('bookings:addOwnerPayoutAbono', {
      id: bookingId,
      amount: Math.floor(Number(payload.amount) || 0),
      fecha: payload.fecha?.trim() || undefined,
      medio: payload.medio?.trim() || undefined,
      comprobanteUrl,
      actor: payload.actor?.trim() || undefined,
    });
  }

  async removeOwnerPayoutAbono(
    bookingId: string,
    abonoId: string,
    actor?: string,
  ) {
    return this.convexService.mutation('bookings:removeOwnerPayoutAbono', {
      id: bookingId,
      abonoId,
      actor: actor?.trim() || undefined,
    });
  }

  /** Check-out cliente (Fase 3): validación del propietario sobre la devolución. */
  async saveDepositApproval(
    bookingId: string,
    payload: {
      estado: string;
      por?: string;
      nombre?: string;
      motivo?: string;
      obsPropietario?: string;
      valorRetenido?: number;
    },
  ) {
    return this.convexService.mutation('bookings:saveDepositApproval', {
      id: bookingId,
      estado: payload.estado,
      por: payload.por?.trim() || undefined,
      nombre: payload.nombre?.trim() || undefined,
      motivo: payload.motivo?.trim() || undefined,
      obsPropietario: payload.obsPropietario?.trim() || undefined,
      valorRetenido:
        payload.valorRetenido != null && Number.isFinite(payload.valorRetenido)
          ? payload.valorRetenido
          : undefined,
    });
  }

  /** Validación del propietario por su enlace público (resuelve ref → id). */
  async saveDepositApprovalByRef(
    reference: string,
    payload: {
      estado: string;
      nombre?: string;
      motivo?: string;
      obsPropietario?: string;
      valorRetenido?: number;
    },
  ) {
    const trimmed = String(reference ?? '').trim();
    if (!trimmed) return { ok: false as const, reason: 'not_found' };
    const booking: any = await this.convexService.query(
      'bookings:getByReference',
      { reference: trimmed },
    );
    if (!booking?._id) return { ok: false as const, reason: 'not_found' };
    await this.saveDepositApproval(booking._id, { ...payload, por: 'propietario' });
    return { ok: true as const };
  }

  /** Persona que recibe a los turistas: guardada por el propietario desde su enlace. */
  async saveOwnerReceiverByRef(
    reference: string,
    payload: { nombre?: string; contacto?: string },
  ) {
    const trimmed = String(reference ?? '').trim();
    if (!trimmed) return { ok: false as const, reason: 'not_found' };
    const booking: any = await this.convexService.query(
      'bookings:getByReference',
      { reference: trimmed },
    );
    if (!booking?._id) return { ok: false as const, reason: 'not_found' };
    await this.convexService.mutation('bookings:saveOwnerReceiver', {
      id: booking._id,
      nombre: payload.nombre?.trim() || undefined,
      contacto: payload.contacto?.trim() || undefined,
    });
    return { ok: true as const };
  }

  /** Check-out cliente (Fase 3): registra el pago de devolución (+ comprobante a S3). */
  async saveDepositRefund(
    bookingId: string,
    payload: {
      valor?: number;
      fecha?: string;
      medio?: string;
      numTransaccion?: string;
      observaciones?: string;
      actor?: string;
    },
    comprobante?: Express.Multer.File,
  ) {
    let comprobanteUrl: string | undefined;
    if (comprobante) {
      comprobanteUrl = await this.s3Service.uploadFile(
        comprobante,
        'deposits/refunds',
      );
    }
    return this.convexService.mutation('bookings:saveDepositRefund', {
      id: bookingId,
      valor:
        payload.valor != null && Number.isFinite(payload.valor)
          ? payload.valor
          : undefined,
      fecha: payload.fecha?.trim() || undefined,
      medio: payload.medio?.trim() || undefined,
      numTransaccion: payload.numTransaccion?.trim() || undefined,
      observaciones: payload.observaciones?.trim() || undefined,
      comprobanteUrl,
      actor: payload.actor?.trim() || undefined,
    });
  }

  /** Check-out cliente (Fase 3): sube evidencias de retención (daños/novedades) a S3. */
  async addDepositEvidencias(
    bookingId: string,
    files?: Express.Multer.File[],
  ) {
    const list = Array.isArray(files) ? files : [];
    if (list.length === 0) return { ok: false as const, reason: 'no_files' };
    const urls: string[] = [];
    for (const f of list) {
      urls.push(await this.s3Service.uploadFile(f, 'deposits/evidencias'));
    }
    return this.convexService.mutation('bookings:addDepositEvidencias', {
      id: bookingId,
      urls,
    });
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

    const portalShare = resolveOwnerPortalShare(
      booking.ownerPortalShare as Record<string, boolean | undefined> | null,
    );
    if (!portalShare.showGuestList) return null;

    const guests = (booking.checkinGuests || []).filter((g: any) => !g.esMenor);
    if (guests.length === 0) return null;

    const property = booking.property || {};
    const fmtFecha = (ms?: number) =>
      ms
        ? new Intl.DateTimeFormat('es-CO', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
            timeZone: 'America/Bogota',
          }).format(new Date(ms))
        : '—';

    const input: GuestListPdfInput = {
      propertyTitle: property.title || 'Propiedad',
      propertyLocation: property.location || null,
      guestName: booking.nombreCompleto || '—',
      reference: booking.reference || trimmed,
      checkInDate: fmtFecha(booking.fechaEntrada),
      checkOutDate: fmtFecha(booking.fechaSalida),
      guests,
      numeroPersonas: booking.numeroPersonas ?? guests.length,
      needsEmpleada: booking.checkinNeedsEmpleada === true,
      needsTeam: booking.checkinNeedsTeam === true,
      petCount:
        typeof booking.checkinMascotas === 'number'
          ? booking.checkinMascotas
          : Number(booking.numeroMascotas) || 0,
      vehiclePlates: String(booking.checkinPlacas ?? '').trim() || null,
      servicesNote: String(booking.checkinServiciosNota ?? '').trim() || null,
    };

    return this.guestListPdfService.generateBuffer(input);
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
    const receiptUrl = await this.s3Service.uploadPaymentReceipt(payload.file);

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

    // Avisar a comercial que hay un soporte por revisar. No bloquea la subida.
    try {
      const portal = (await this.getPaymentPortalByReference(trimmed)) as {
        reference?: string;
        propertyTitle?: string;
        nombreTitular?: string;
        precioTotal?: number;
        pagoPendiente?: number;
      } | null;
      // Correos destino configurados en el admin (fallback a los por defecto).
      const settings = (await this.convexService
        .query('notificationSettings:get', {})
        .catch(() => null)) as { paymentReceiptEmails?: string[] } | null;
      const emails = Array.isArray(settings?.paymentReceiptEmails)
        ? settings!.paymentReceiptEmails
        : undefined;
      await this.brevoEmail.sendPaymentReceiptAlert({
        emails,
        reference: portal?.reference || trimmed,
        propertyTitle: portal?.propertyTitle || 'tu finca',
        clientName: portal?.nombreTitular || '',
        amount: payload.amount,
        bankName: payload.bankName,
        receiptUrl,
        precioTotal:
          typeof portal?.precioTotal === 'number'
            ? portal.precioTotal
            : undefined,
        pagoPendiente:
          typeof portal?.pagoPendiente === 'number'
            ? portal.pagoPendiente
            : undefined,
        adminUrl: 'https://fincasya.com/admin/payment-review',
      });
    } catch (mailErr) {
      console.warn(
        '[api] No se pudo enviar la alerta de soporte de pago:',
        (mailErr as Error)?.message,
      );
    }

    return body;
  }
}
