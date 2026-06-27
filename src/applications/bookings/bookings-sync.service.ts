import {
  Injectable,
  forwardRef,
  Inject,
  NotFoundException,
  BadRequestException,
  BadGatewayException,
} from '@nestjs/common';
import { ConvexService } from '../shared/services/convex.service';
import { S3Service } from '../shared/services/s3.service';
import { FincasService } from '../fincas/fincas.service';
import { BrevoEmailService } from '../shared/services/brevo-email.service';
import { mergeClientDataFromContractDetail } from './resolve-contract-client-data';
import * as crypto from 'crypto';

const DAY_MS = 1000 * 60 * 60 * 24;
/**
 * Noches calendario en hora de Colombia (UTC-5, sin DST), ignorando las horas
 * de entrada/salida. Evita la "noche fantasma" que producía Math.ceil sobre
 * timestamps completos cuando la hora de salida era mayor que la de entrada
 * (ej. 12→15 jun daba 4 noches en vez de 3).
 */
function calendarNights(entradaMs: number, salidaMs: number): number {
  const BOGOTA_OFFSET_MS = 5 * 60 * 60 * 1000;
  const dayIndex = (ms: number) => Math.floor((ms - BOGOTA_OFFSET_MS) / DAY_MS);
  return Math.max(1, dayIndex(salidaMs) - dayIndex(entradaMs));
}

@Injectable()
export class BookingsSyncService {
  constructor(
    private readonly convexService: ConvexService,
    private readonly s3Service: S3Service,
    @Inject(forwardRef(() => FincasService))
    private readonly fincasService: FincasService,
    private readonly brevoEmailService: BrevoEmailService,
  ) {}

  async countBookings() {
    return this.convexService.query('bookings:countAll', {});
  }

  async checkAvailability(
    propertyId: string,
    fechaEntrada: number,
    fechaSalida: number,
    excludeBookingId?: string,
  ) {
    return this.convexService.query('bookings:checkAvailability', {
      propertyId: propertyId as any,
      fechaEntrada,
      fechaSalida,
      ...(excludeBookingId
        ? { excludeBookingId: excludeBookingId as any }
        : {}),
    });
  }

  async getBlockedDateRanges(propertyId: string, monthsAhead = 12) {
    return this.convexService.query('bookings:getBlockedDateRanges', {
      propertyId: propertyId as any,
      monthsAhead,
    });
  }

  /**
   * Crear una reserva en Convex y sincronizarla con Google Calendar.
   */
  async createBooking(
    params: {
      propertyId: string;
      nombreCompleto: string;
      cedula: string;
      celular: string;
      correo: string;
      fechaEntrada: number | string; // ms or string if from FormBody
      fechaSalida: number | string; // ms
      numeroPersonas: number | string;
      precioTotal: number | string;
      temporada: string;
      numeroMascotas?: number | string;
      costoMascotas?: number | string;
      depositoMascotas?: number | string;
      sobrecargoMascotas?: number | string;
      observaciones?: string;
      calendarLabel?: string;
      horaEntrada?: string;
      horaSalida?: string;
      city?: string;
      purpose?: string;
      reference?: string;
      address?: string;
      isDirect?: boolean | string;
      status?: string;
      personasAdicionales?: number | string;
      groupType?: string;
      isEvento?: boolean | string;
      detallesEvento?: any;
      costoPersonasAdicionales?: number | string;
      costoPersonalServicio?: number | string;
      depositoGarantia?: number | string;
      depositoAseo?: number | string;
      discountAmount?: number | string;
      subtotal?: number | string;
      issueDate?: string;
      economicAdjustments?:
        | string
        | Array<{
            id: string;
            date: string;
            description: string;
            amount: number;
            type: 'INCREMENT' | 'DISCOUNT';
            createdBy?: string;
            createdAt: number;
          }>;
      tieneMascotas?: boolean | string;
      multimediaLinks?:
        | string
        | Array<{ url: string; name?: string; type?: string }>;
      /** Reservado por compatibilidad; ya no se genera contrato al crear reserva. */
      skipAutoContract?: boolean | string;
    },
    multimediaFiles?: Express.Multer.File[],
  ) {
    const { propertyId, temporada } = params;

    const parseNum = (val: any) => {
      if (typeof val === 'string') return parseFloat(val);
      if (typeof val === 'number') return val;
      return undefined;
    };

    const parseBool = (val: any) => {
      if (typeof val === 'boolean') return val;
      if (val === 'true') return true;
      if (val === 'false') return false;
      return undefined;
    };

    const fechaEntradaNum = parseNum(params.fechaEntrada) || 0;
    const fechaSalidaNum = parseNum(params.fechaSalida) || 0;
    const numeroPersonasNum = parseNum(params.numeroPersonas) || 1;
    const precioTotalNum = parseNum(params.precioTotal) || 0;
    const numeroMascotasNum = parseNum(params.numeroMascotas) || 0;
    const costoMascotasNum = parseNum(params.costoMascotas) || 0;
    const depositoMascotasNum = parseNum(params.depositoMascotas) || 0;
    const sobrecargoMascotasNum = parseNum(params.sobrecargoMascotas) || 0;

    const personasAdicionalesNum = parseNum(params.personasAdicionales);
    const costoPersonasAdicionalesNum = parseNum(params.costoPersonasAdicionales);
    const costoPersonalServicioNum = parseNum(params.costoPersonalServicio);
    const depositoGarantiaNum = parseNum(params.depositoGarantia);
    const depositoAseoNum = parseNum(params.depositoAseo);
    const discountAmountNum = parseNum(params.discountAmount);
    const subtotalNum = parseNum(params.subtotal);
    const tieneMascotasBool = parseBool(params.tieneMascotas);
    const issueDate =
      typeof params.issueDate === 'string' && params.issueDate.trim()
        ? params.issueDate.trim()
        : undefined;
    const economicAdjustments = (() => {
      const raw = params.economicAdjustments;
      if (!raw) return undefined;
      if (typeof raw === 'string') {
        try {
          const parsed = JSON.parse(raw);
          return Array.isArray(parsed) ? parsed : undefined;
        } catch {
          return undefined;
        }
      }
      return Array.isArray(raw) ? raw : undefined;
    })();
    const isDirectBool = parseBool(params.isDirect);
    const isEventoBool = parseBool(params.isEvento);
    const normalizedStatus =
      typeof params.status === 'string' ? params.status.trim().toUpperCase() : undefined;
    const allowedStatuses = new Set([
      'PENDING',
      'PENDING_PAYMENT',
      'CONFIRMED',
      'PAID',
      'CANCELLED',
      'COMPLETED',
    ]);
    const bookingStatus =
      normalizedStatus && allowedStatuses.has(normalizedStatus)
        ? normalizedStatus
        : isDirectBool
          ? 'PENDING_PAYMENT'
          : 'PENDING';

    // 1. Obtener info de la propiedad
    const property = await this.convexService.query('fincas:getById', {
      id: propertyId as any,
    });
    if (!property) throw new Error('Propiedad no encontrada');

    // 2. Mezclar multimedia preexistente (URLs) y archivos subidos en esta solicitud.
    const multimedia: { url: string; name: string; type: string }[] = [];

    const rawMultimediaLinks = params.multimediaLinks;
    if (rawMultimediaLinks) {
      let parsedLinks: Array<{ url: string; name?: string; type?: string }> =
        [];
      if (typeof rawMultimediaLinks === 'string') {
        try {
          const candidate = JSON.parse(rawMultimediaLinks);
          if (Array.isArray(candidate)) parsedLinks = candidate;
        } catch {
          // Ignorar payload inválido para no romper la creación de la reserva.
        }
      } else if (Array.isArray(rawMultimediaLinks)) {
        parsedLinks = rawMultimediaLinks;
      }

      multimedia.push(
        ...parsedLinks
          .filter((item) => item?.url)
          .map((item) => ({
            url: item.url,
            name: item.name || 'Documento',
            type: item.type || 'application/pdf',
          })),
      );
    }

    if (multimediaFiles && multimediaFiles.length > 0) {
      const uploadedMedia = await Promise.all(
        multimediaFiles.map(async (file) => {
          const url = await this.s3Service.uploadFile(
            file,
            'bookings/multimedia',
          );
          return {
            url,
            name: file.originalname,
            type: file.mimetype,
            size: file.size,
            uploadedAt: Date.now(),
          };
        }),
      );
      multimedia.push(...uploadedMedia);
    }

    // 3. Crear reserva en Convex
    const bookingId = await this.convexService.mutation('bookings:create', {
      propertyId: propertyId as any,
      nombreCompleto: params.nombreCompleto,
      cedula: params.cedula,
      celular: params.celular,
      correo: params.correo,
      fechaEntrada: fechaEntradaNum,
      fechaSalida: fechaSalidaNum,
      numeroPersonas: numeroPersonasNum,
      precioTotal: precioTotalNum,
      numeroNoches: calendarNights(fechaEntradaNum, fechaSalidaNum),
      observaciones: params.observaciones,
      calendarLabel: params.calendarLabel,
      horaEntrada: params.horaEntrada,
      horaSalida: params.horaSalida,
      city: params.city,
      purpose: params.purpose,
      reference: params.reference,
      address: params.address,
      subtotal: subtotalNum ?? precioTotalNum, // Fallback to total if not provided
      multimedia: multimedia.length > 0 ? multimedia : undefined,
      temporada,
      numeroMascotas: numeroMascotasNum,
      costoMascotas: costoMascotasNum,
      depositoMascotas: depositoMascotasNum,
      sobrecargoMascotas: sobrecargoMascotasNum,
      personasAdicionales: personasAdicionalesNum,
      costoPersonasAdicionales: costoPersonasAdicionalesNum,
      costoPersonalServicio: costoPersonalServicioNum,
      depositoGarantia: depositoGarantiaNum,
      depositoAseo: depositoAseoNum,
      discountAmount: discountAmountNum,
      issueDate,
      economicAdjustments,
      tieneMascotas: tieneMascotasBool,
      isDirect: isDirectBool,
      groupType: params.groupType,
      isEvento: isEventoBool,
      detallesEvento: params.detallesEvento ?? undefined,
      status: bookingStatus,
    });

    // 4. Generar firma de integridad para Bold...
    let integritySignature = null;
    const boldSecret = process.env.BOLD_SHARED_SECRET;

    if (params.reference && boldSecret) {
      // Solo cobramos el 50% inicialmente por Bold
      const amount = Math.floor(precioTotalNum / 2);
      const currency = 'COP';
      const dataToHash = `${params.reference}${amount}${currency}${boldSecret}`;
      integritySignature = crypto
        .createHash('sha256')
        .update(dataToHash)
        .digest('hex');
    }

    return { bookingId, integritySignature };
  }

  /**
   * Actualizar una reserva existente (admin).
   */
  async updateBooking(
    bookingId: string,
    params: {
      propertyId: string;
      nombreCompleto: string;
      cedula: string;
      celular: string;
      correo: string;
      fechaEntrada: number | string;
      fechaSalida: number | string;
      numeroPersonas: number | string;
      precioTotal: number | string;
      temporada: string;
      numeroMascotas?: number | string;
      costoMascotas?: number | string;
      depositoMascotas?: number | string;
      sobrecargoMascotas?: number | string;
      observaciones?: string;
      calendarLabel?: string;
      horaEntrada?: string;
      horaSalida?: string;
      city?: string;
      purpose?: string;
      reference?: string;
      address?: string;
      status?: string;
      personasAdicionales?: number | string;
      groupType?: string;
      costoPersonasAdicionales?: number | string;
      costoPersonalServicio?: number | string;
      depositoGarantia?: number | string;
      depositoAseo?: number | string;
      discountAmount?: number | string;
      subtotal?: number | string;
      issueDate?: string;
      economicAdjustments?:
        | string
        | Array<{
            id: string;
            date: string;
            description: string;
            amount: number;
            type: 'INCREMENT' | 'DISCOUNT';
            createdBy?: string;
            createdAt: number;
          }>;
      tieneMascotas?: boolean | string;
      multimediaLinks?:
        | string
        | Array<{ url: string; name?: string; type?: string }>;
    },
    multimediaFiles?: Express.Multer.File[],
  ) {
    const parseNum = (val: any) => {
      if (typeof val === 'string') return parseFloat(val);
      if (typeof val === 'number') return val;
      return undefined;
    };

    const parseBool = (val: any) => {
      if (typeof val === 'boolean') return val;
      if (val === 'true') return true;
      if (val === 'false') return false;
      return undefined;
    };

    const fechaEntradaNum = parseNum(params.fechaEntrada) || 0;
    const fechaSalidaNum = parseNum(params.fechaSalida) || 0;
    const numeroPersonasNum = parseNum(params.numeroPersonas) || 1;
    const precioTotalNum = parseNum(params.precioTotal) || 0;
    const numeroMascotasNum = parseNum(params.numeroMascotas) || 0;
    const costoMascotasNum = parseNum(params.costoMascotas) || 0;
    const depositoMascotasNum = parseNum(params.depositoMascotas) || 0;
    const sobrecargoMascotasNum = parseNum(params.sobrecargoMascotas) || 0;
    const personasAdicionalesNum = parseNum(params.personasAdicionales);
    const costoPersonasAdicionalesNum = parseNum(params.costoPersonasAdicionales);
    const costoPersonalServicioNum = parseNum(params.costoPersonalServicio);
    const depositoGarantiaNum = parseNum(params.depositoGarantia);
    const depositoAseoNum = parseNum(params.depositoAseo);
    const discountAmountNum = parseNum(params.discountAmount);
    const subtotalNum = parseNum(params.subtotal);
    const tieneMascotasBool = parseBool(params.tieneMascotas);
    const issueDate =
      typeof params.issueDate === 'string' && params.issueDate.trim()
        ? params.issueDate.trim()
        : undefined;
    const economicAdjustments = (() => {
      const raw = params.economicAdjustments;
      if (!raw) return undefined;
      if (typeof raw === 'string') {
        try {
          const parsed = JSON.parse(raw);
          return Array.isArray(parsed) ? parsed : undefined;
        } catch {
          return undefined;
        }
      }
      return Array.isArray(raw) ? raw : undefined;
    })();

    const normalizedStatus =
      typeof params.status === 'string' ? params.status.trim().toUpperCase() : undefined;
    const allowedStatuses = new Set([
      'PENDING',
      'PENDING_PAYMENT',
      'CONFIRMED',
      'PAID',
      'CANCELLED',
      'COMPLETED',
    ]);

    const existing = await this.convexService.query('bookings:getById', {
      id: bookingId as any,
    });
    if (!existing) {
      throw new Error('Reserva no encontrada');
    }

    const multimedia: {
      url: string;
      name: string;
      type: string;
      size?: number;
      uploadedAt?: number;
    }[] = [...(existing.multimedia || [])];

    const rawMultimediaLinks = params.multimediaLinks;
    if (rawMultimediaLinks) {
      let parsedLinks: Array<{ url: string; name?: string; type?: string }> =
        [];
      if (typeof rawMultimediaLinks === 'string') {
        try {
          const candidate = JSON.parse(rawMultimediaLinks);
          if (Array.isArray(candidate)) parsedLinks = candidate;
        } catch {
          // ignore
        }
      } else if (Array.isArray(rawMultimediaLinks)) {
        parsedLinks = rawMultimediaLinks;
      }

      for (const item of parsedLinks.filter((i) => i?.url)) {
        if (!multimedia.some((m) => m.url === item.url)) {
          multimedia.push({
            url: item.url,
            name: item.name || 'Documento',
            type: item.type || 'application/pdf',
          });
        }
      }
    }

    if (multimediaFiles && multimediaFiles.length > 0) {
      const uploadedMedia = await Promise.all(
        multimediaFiles.map(async (file) => {
          const url = await this.s3Service.uploadFile(
            file,
            'bookings/multimedia',
          );
          return {
            url,
            name: file.originalname,
            type: file.mimetype,
            size: file.size,
            uploadedAt: Date.now(),
          };
        }),
      );
      multimedia.push(...uploadedMedia);
    }

    const nochesCalendario = Math.max(
      1,
      Math.ceil((fechaSalidaNum - fechaEntradaNum) / (1000 * 60 * 60 * 24)),
    );

    await this.convexService.mutation('bookings:adminUpdate', {
      id: bookingId as any,
      propertyId: params.propertyId as any,
      nombreCompleto: params.nombreCompleto,
      cedula: params.cedula,
      celular: params.celular,
      correo: params.correo,
      fechaEntrada: fechaEntradaNum,
      fechaSalida: fechaSalidaNum,
      horaEntrada: params.horaEntrada,
      horaSalida: params.horaSalida,
      numeroNoches: nochesCalendario,
      numeroPersonas: numeroPersonasNum,
      personasAdicionales: personasAdicionalesNum,
      tieneMascotas: tieneMascotasBool ?? numeroMascotasNum > 0,
      numeroMascotas: numeroMascotasNum,
      subtotal: subtotalNum ?? precioTotalNum,
      costoPersonasAdicionales: costoPersonasAdicionalesNum,
      costoMascotas: costoMascotasNum,
      depositoMascotas: depositoMascotasNum,
      sobrecargoMascotas: sobrecargoMascotasNum,
      costoPersonalServicio: costoPersonalServicioNum,
      depositoGarantia: depositoGarantiaNum,
      depositoAseo: depositoAseoNum,
      discountAmount: discountAmountNum,
      issueDate,
      economicAdjustments,
      precioTotal: precioTotalNum,
      temporada: params.temporada,
      observaciones: params.observaciones,
      city: params.city,
      purpose: params.purpose,
      groupType: params.groupType,
      reference: params.reference,
      address: params.address,
      calendarLabel: params.calendarLabel,
      status:
        normalizedStatus && allowedStatuses.has(normalizedStatus)
          ? normalizedStatus
          : undefined,
      multimedia: multimedia.length > 0 ? multimedia : undefined,
    });

    return { bookingId };
  }

  /**
   * Consultar el estado de un pago en Bold usando la referencia.
   */
  async checkPaymentStatus(reference: string) {
    const boldApiKey = process.env.BOLD_IDENTIDAD_KEY;
    if (!boldApiKey) throw new Error('BOLD_IDENTIDAD_KEY no configurada');

    try {
      const response = await fetch(
        `https://payments.api.bold.co/v2/payment-voucher/${reference}`,
        {
          method: 'GET',
          headers: {
            Authorization: `x-api-key ${boldApiKey}`,
          },
        },
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('Error consultando estado en Bold:', errorData);
        return { payment_status: 'ERROR', detail: errorData };
      }

      const data = await response.json();
      console.log(`Estado de pago para ${reference}:`, data.payment_status);

      // Si el pago es aprobado, actualizamos la reserva en Convex
      if (data.payment_status === 'APPROVED') {
        const booking = await this.convexService.query(
          'bookings:getByReference',
          { reference } as any,
        );
        if (booking && booking.status !== 'PAID') {
          await this.convexService.mutation('bookings:update', {
            id: booking._id,
            status: 'PAID',
          });
          console.log(`Reserva ${booking._id} marcada como PAGADA.`);

          // Generar PDF de confirmación de reserva automáticamente
          let confirmationUrl = '';
          try {
            const confirmationResult = await this.fincasService.generateBookingConfirmation(booking._id);
            confirmationUrl = confirmationResult.url;
            console.log(`Confirmación de reserva generada: ${confirmationUrl}`);
          } catch (confErr) {
            console.error(`[api] Error generando confirmación de reserva para ${booking._id}:`, confErr.message);
          }

          // 6. Enviar notificaciones por correo (Brevo)
          try {
            // Refrescar booking para tener el multimedia actualizado (con la confirmación recién añadida)
            const updatedBooking = await this.convexService.query('bookings:getById', { id: booking._id });
            const contractFile = (updatedBooking?.multimedia || []).find((m: any) => 
              m.type === 'application/pdf' && (m.name.toLowerCase().includes('contrato') || m.name.toLowerCase().includes('contract'))
            );
            const confirmationFile = (updatedBooking?.multimedia || []).find((m: any) => 
              m.type === 'application/pdf' && (m.name.toLowerCase().includes('confirmacion') || m.name.toLowerCase().includes('confirmation'))
            );

            const contractUrl = contractFile?.url || '';
            const finalConfirmationUrl = confirmationUrl || confirmationFile?.url || '';

            // Notificación al Cliente
            await this.brevoEmailService.sendBookingConfirmationToClient({
              clientEmail: booking.correo,
              clientName: booking.nombreCompleto,
              propertyTitle: (booking).propertyTitle || 'tu propiedad',
              reference: reference,
              contractUrl: contractUrl,
              confirmationUrl: finalConfirmationUrl,
            });

            // Notificación al Administrador
            await this.brevoEmailService.sendBookingAlertToAdmin({
              clientName: booking.nombreCompleto,
              clientEmail: booking.correo,
              clientPhone: booking.celular,
              propertyTitle: (booking).propertyTitle || 'Propiedad Reservada',
              checkInDate: new Date(booking.fechaEntrada).toLocaleDateString('es-CO'),
              checkOutDate: new Date(booking.fechaSalida).toLocaleDateString('es-CO'),
              totalAmount: booking.precioTotal,
              reference: reference,
              contractUrl: contractUrl,
              confirmationUrl: finalConfirmationUrl,
            });
          } catch (emailErr) {
            console.error(`[api] Error enviando notificaciones para reserva ${booking._id}:`, emailErr.message);
          }
        }
      }

      return data;
    } catch (error) {
      console.error('Error en checkPaymentStatus:', error);
      throw error;
    }
  }

  /**
   * Sincronizar una reserva existente (por ejemplo, si se actualizan fechas).
   */
  async syncBooking(bookingId: string) {
    // La sincronización también ocurre automáticamente al usar el mutation `bookings:update`
    // desde Convex con el worker `syncBookingToCalendar`.
  }

  /**
   * Eliminar una reserva
   */
  async deleteBooking(bookingId: string) {
    await this.convexService.mutation('bookings:remove', {
      id: bookingId,
    });

    // La eliminación de Google Calendar se maneja asíncronamente en Convex (background worker)

    return { success: true, deletedId: bookingId };
  }

  /**
   * Listar reservas desde Convex (que ya están sincronizadas).
   */
  async listBookings(params: any) {
    return this.convexService.query('bookings:list', params);
  }

  async listBookingsForReports(params: {
    propertyId?: string;
    dateFrom?: number;
    dateTo?: number;
  }) {
    return this.convexService.query('bookings:listForReports', {
      propertyId: params.propertyId as any,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
    });
  }

  async saveReconciliationSheet(
    bookingId: string,
    payload: {
      turistaPago?: boolean | null;
      turistaLlego?: boolean | null;
      propietarioPago?: boolean | null;
      checkinListo?: boolean | null;
      notas?: string;
      updatedBy?: string;
    },
  ) {
    return this.convexService.mutation('bookings:saveReconciliationSheet', {
      id: bookingId,
      ...payload,
    });
  }

  async getBookingPayments(bookingId: string) {
    return this.convexService.query('bookings:getPaymentsByBooking', {
      bookingId: bookingId as any,
    });
  }

  /** Elimina un abono cargado por error y devuelve el resumen actualizado. */
  async deleteBookingPayment(bookingId: string, paymentId: string) {
    await this.convexService.mutation('bookings:deletePayment', {
      paymentId: paymentId as any,
    });
    return this.getBookingPayments(bookingId);
  }

  /** Habilita/bloquea la edición de la lista de invitados (override del equipo). */
  async setGuestListUnlocked(bookingId: string, unlocked: boolean) {
    return this.convexService.mutation('bookings:setGuestListUnlocked', {
      bookingId: bookingId as any,
      unlocked,
    });
  }

  /** Edición directa del equipo: guarda la lista de invitados (sin bloqueo). */
  async adminSaveCheckinGuests(
    bookingId: string,
    guests: Array<{
      nombreCompleto: string;
      cedula?: string;
      tipoDocumento?: string;
      esMenor?: boolean;
    }>,
  ) {
    return this.convexService.mutation('checkinPortal:adminSaveGuests', {
      bookingId: bookingId as any,
      guests: Array.isArray(guests) ? guests : [],
    });
  }

  async createManualPayment(
    bookingId: string,
    body: {
      type: 'ABONO_50' | 'SALDO_50' | 'COMPLETO' | 'REEMBOLSO';
      amount: number;
      paymentMethod?: string;
      reference?: string;
      notes?: string;
    },
  ) {
    const amount = Math.floor(Number(body.amount) || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('El monto debe ser mayor a cero.');
    }

    const paymentId = await this.convexService.mutation('bookings:createPayment', {
      bookingId: bookingId as any,
      type: body.type,
      amount,
      paymentMethod: body.paymentMethod?.trim() || 'Manual',
      reference: body.reference?.trim() || undefined,
      notes: body.notes?.trim() || undefined,
      status: 'PAID',
    });

    return this.getBookingPayments(bookingId);
  }

  /**
   * "Validar pago": el equipo registra un abono con su soporte (que llegó por
   * correo/WhatsApp). Sube el soporte a S3 y crea el pago como PAID. Al saldarse
   * el total, createPayment marca la reserva como PAID (cambia de color).
   */
  async validatePayment(
    bookingId: string,
    body: {
      amount: number;
      paymentMethod?: string;
      notes?: string;
      actor?: string;
    },
    soporte?: Express.Multer.File,
  ) {
    const amount = Math.floor(Number(body.amount) || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('El monto debe ser mayor a cero.');
    }
    let receiptUrl: string | undefined;
    if (soporte) {
      receiptUrl = await this.s3Service.uploadFile(soporte, 'payments/soportes');
    }
    await this.convexService.mutation('bookings:createPayment', {
      bookingId: bookingId as any,
      type: 'ABONO_50',
      amount,
      paymentMethod: body.paymentMethod?.trim() || 'Manual',
      notes: body.notes?.trim() || undefined,
      status: 'PAID',
      receiptUrl,
      verifiedBy: body.actor?.trim() || undefined,
      verifiedAt: Date.now(),
    });

    return this.getBookingPayments(bookingId);
  }

  async syncReservationAbono(
    bookingId: string,
    body: {
      paymentStatus?: string;
      abono?: {
        type: 'ABONO_50' | 'COMPLETO';
        amount: number;
        paymentMethod?: string;
        notes?: string;
      };
    },
  ) {
    return this.convexService.mutation('bookings:syncReservationAbono', {
      bookingId: bookingId as any,
      paymentStatus: body.paymentStatus,
      abono: body.abono,
    });
  }

  async getBookingByContractNumber(contractNumber: string) {
    const booking = await this.convexService.query(
      'bookings:getByContractNumber',
      { contractNumber },
    );
    let row: Record<string, unknown> | null = booking
      ? { ...(booking as Record<string, unknown>), isContractSnapshot: false }
      : null;
    if (!row) {
      const snap = await this.convexService.query(
        'adminContractSnapshots:getByContractNumber',
        { contractNumber },
      );
      if (snap) {
        row = { ...(snap as Record<string, unknown>), isContractSnapshot: true };
      }
    }
    if (!row) return null;

    try {
      const detail = await this.convexService.query('contracts:getDetail', {
        contractNumber: contractNumber.trim(),
      });
      row = mergeClientDataFromContractDetail(row, detail as any);
    } catch {
      // Sin registro en gestor: se usa el borrador/reserva tal cual.
    }
    return row;
  }

  /** Gestor de Contratos: lista paginada con filtros. */
  async listContracts(params: {
    estado?: string;
    origen?: string;
    tipo?: string;
    propertyId?: string;
    search?: string;
    cr?: string;
    limit?: number;
    page?: number;
  }) {
    return this.convexService.query('contracts:list', {
      estado: params.estado,
      origen: params.origen,
      tipo: params.tipo,
      propertyId: params.propertyId as any,
      search: params.search,
      cr: params.cr,
      limit: params.limit,
      page: params.page,
    });
  }

  /** Gestor de Contratos: detalle por número de contrato. */
  async getContract(contractNumber: string) {
    return this.convexService.query('contracts:get', { contractNumber });
  }

  /** Gestor de Contratos: detalle enriquecido (fotos, link, CR). */
  async getContractDetail(contractNumber: string) {
    return this.convexService.query('contracts:getDetail', { contractNumber });
  }

  /** Gestor de Contratos: elimina un registro del gestor. */
  async deleteContract(contractNumber: string) {
    return this.convexService.mutation('contracts:remove', { contractNumber });
  }

  /** Gestor de Contratos: sube fotos de cédula y actualiza el fill token. */
  async uploadContractCedulaPhotos(
    contractNumber: string,
    files: Express.Multer.File[],
  ) {
    const detail: any = await this.getContractDetail(contractNumber);
    if (!detail?.fillToken?._id) {
      throw new BadRequestException('Este contrato no tiene fotos de cédula asociadas');
    }
    if (!files?.length) {
      throw new BadRequestException('Adjunta al menos una foto');
    }
    if (files.length > 2) {
      throw new BadRequestException('Máximo 2 fotos de cédula');
    }

    const existing: string[] =
      detail.fillToken.filledData?.cedulaPhotoUrls ?? [];
    const room = Math.max(0, 2 - existing.length);
    if (room <= 0) {
      throw new BadRequestException('Ya hay 2 fotos. Elimina una antes de agregar otra.');
    }

    const token = String(detail.fillToken.token ?? '');
    const newUrls: string[] = [];
    for (const file of files.slice(0, room)) {
      if (!file.mimetype?.startsWith('image/')) {
        throw new BadRequestException('Solo se permiten imágenes');
      }
      if (file.size > 8 * 1024 * 1024) {
        throw new BadRequestException('Cada imagen debe pesar menos de 8 MB');
      }
      const ext = file.originalname?.split('.').pop() || 'jpg';
      const safeName = `cedula_${Date.now()}_${newUrls.length + 1}.${ext}`;
      const url = await this.s3Service.uploadFile(
        file,
        `contracts/cedula/${token || contractNumber}`,
        safeName,
      );
      newUrls.push(url);
    }

    const merged = [...existing, ...newUrls].slice(0, 2);
    await this.convexService.mutation('contractFillTokens:updateCedulaPhotos', {
      fillTokenId: detail.fillToken._id,
      cedulaPhotoUrls: merged,
    });
    return { ok: true, urls: merged };
  }

  /** Gestor de Contratos: reemplaza el listado de fotos de cédula. */
  async updateContractCedulaPhotos(
    contractNumber: string,
    cedulaPhotoUrls: string[],
  ) {
    const detail: any = await this.getContractDetail(contractNumber);
    if (!detail?.fillToken?._id) {
      throw new BadRequestException('Este contrato no tiene fotos de cédula asociadas');
    }
    const urls = (cedulaPhotoUrls ?? [])
      .map((u) => String(u ?? '').trim())
      .filter(Boolean)
      .slice(0, 2);
    await this.convexService.mutation('contractFillTokens:updateCedulaPhotos', {
      fillTokenId: detail.fillToken._id,
      cedulaPhotoUrls: urls,
    });
    return { ok: true, urls };
  }

  /** Gestor de Contratos: reconstruye la tabla desde las fuentes históricas. */
  async backfillContracts() {
    return this.convexService.mutation('contracts:backfill', {});
  }

  /** Marca como revisados los soportes de pago pendientes de una reserva. */
  async markPaymentReceiptsReviewed(bookingId: string) {
    return this.convexService.mutation(
      'bookings:markPaymentReceiptsReviewed',
      { bookingId: bookingId as any },
    );
  }

  /** Revisión de pagos: lista de soportes pendientes con contexto de reserva. */
  async listPendingPaymentReceipts() {
    return this.convexService.query('paymentReceipts:listPending', {});
  }

  /** Marca el flag hasPendingReceipt en reservas existentes con soporte pendiente. */
  async backfillPendingReceiptFlag() {
    return this.convexService.mutation('paymentReceipts:backfillPendingFlag', {});
  }

  /**
   * Aprueba un soporte: registra el abono (se refleja en la reserva) y marca el
   * recibo como aprobado.
   */
  async approvePaymentReceipt(params: {
    bookingId: string;
    receiptId: string;
    amount: number;
    paymentMethod?: string;
    reviewedBy?: string;
  }) {
    const amount = Math.max(0, Math.floor(Number(params.amount) || 0));
    if (amount <= 0) {
      throw new BadRequestException('El monto verificado debe ser mayor a cero.');
    }
    await this.convexService.mutation('bookings:createPayment', {
      bookingId: params.bookingId as any,
      type: 'ABONO_50',
      amount,
      paymentMethod: params.paymentMethod?.trim() || 'Soporte verificado',
      notes: `Abono verificado y aprobado en Revisión de Pagos${params.reviewedBy ? ` por ${params.reviewedBy}` : ''}.`,
      status: 'PAID',
    });
    await this.convexService.mutation('paymentReceipts:setReceiptStatus', {
      bookingId: params.bookingId as any,
      receiptId: params.receiptId,
      status: 'approved',
      reviewedAmount: amount,
      reviewedBy: params.reviewedBy,
    });
    return { ok: true };
  }

  /** Rechaza un soporte con un motivo. No registra abono. */
  async rejectPaymentReceipt(params: {
    bookingId: string;
    receiptId: string;
    motivo: string;
    reviewedBy?: string;
  }) {
    return this.convexService.mutation('paymentReceipts:setReceiptStatus', {
      bookingId: params.bookingId as any,
      receiptId: params.receiptId,
      status: 'rejected',
      rejectReason: params.motivo,
      reviewedBy: params.reviewedBy,
    });
  }

  /** Ajustes de notificaciones (correos de alerta de soportes de pago). */
  async getNotificationSettings() {
    return this.convexService.query('notificationSettings:get', {});
  }

  async setPaymentReceiptEmails(emails: string[]) {
    return this.convexService.mutation(
      'notificationSettings:setPaymentReceiptEmails',
      { emails },
    );
  }

  async listContractCodes(params: {
    propertyId?: string;
    search?: string;
    limit?: number;
    page?: number;
  }) {
    try {
      return await this.convexService.query('contractCodeHistory:list', {
        propertyId: params.propertyId as any,
        search: params.search,
        limit: params.limit,
        page: params.page,
      });
    } catch (e) {
      if (e instanceof BadGatewayException) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      throw new BadGatewayException(
        `No se pudo cargar el historial de códigos de contrato: ${msg}`,
      );
    }
  }

  async saveContractSnapshot(body: {
    contractNumber: string;
    propertyId: string;
    payload: Record<string, unknown>;
  }) {
    try {
      return await this.convexService.mutation('adminContractSnapshots:upsert', {
        contractNumber: body.contractNumber,
        propertyId: body.propertyId as any,
        payload: body.payload,
      });
    } catch (e) {
      if (e instanceof BadGatewayException) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      throw new BadGatewayException(
        `No se pudo guardar el borrador del contrato en Convex: ${msg}`,
      );
    }
  }

  /**
   * Tras generar la confirmación de pago: crea la reserva en Convex y elimina el borrador.
   */
  async finalizeContractSnapshot(args: {
    snapshotId: string;
    paymentStatus: string;
  }) {
    const row = await this.convexService.query('adminContractSnapshots:getById', {
      id: args.snapshotId as any,
    });
    if (!row) {
      throw new NotFoundException(
        'No hay borrador para este contrato. Vuelve a generar el contrato o revisa el código.',
      );
    }
    const p = row.payload as Record<string, any>;

    const ps = String(args.paymentStatus ?? '')
      .trim()
      .toUpperCase();
    const bookingStatus = ps === 'PAID' ? 'PAID' : 'PENDING_PAYMENT';

    const { propertyId: _ignoreProp, ...rest } = p;
    let created: { bookingId: string; integritySignature: string | null };
    try {
      created = await this.createBooking({
        ...rest,
        propertyId: row.propertyId as string,
        status: bookingStatus,
        isDirect: true,
      } as Parameters<BookingsSyncService['createBooking']>[0]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new BadRequestException(
        msg.includes('disponible') || msg.includes('Disponible')
          ? msg
          : `No se pudo registrar la reserva: ${msg}`,
      );
    }

    await this.convexService.mutation('adminContractSnapshots:remove', {
      id: args.snapshotId as any,
    });

    const ref = String(p.reference ?? '').trim();
    const booking = ref
      ? await this.getBookingByContractNumber(ref)
      : null;
    return {
      bookingId: created.bookingId,
      booking,
      integritySignature: created.integritySignature,
    };
  }

  async uploadMultimedia(bookingId: string, file: Express.Multer.File) {
    const url = await this.s3Service.uploadFile(file, 'bookings/multimedia');
    return this.convexService.mutation('bookings:appendMultimedia', {
      bookingId: bookingId as any,
      file: {
        url,
        name: file.originalname,
        type: file.mimetype,
        size: file.size,
        uploadedAt: Date.now(),
      },
    });
  }

  async removeMultimedia(bookingId: string, url: string) {
    // Primero removemos de Convex
    await this.convexService.mutation('bookings:removeMultimedia', {
      bookingId: bookingId as any,
      url,
    });

    // Luego intentamos borrar de S3
    try {
      await this.s3Service.deleteFile(url);
    } catch (error) {
      console.error(`Error eliminando archivo de S3: ${url}`, error);
      // No lanzamos error para no bloquear el flujo si el archivo ya no existe en S3
    }

    return { success: true };
  }
}
