import { Injectable, forwardRef, Inject } from '@nestjs/common';
import { ConvexService } from '../shared/services/convex.service';
import { S3Service } from '../shared/services/s3.service';
import type { FincasService } from '../fincas/fincas.service';
import { BrevoEmailService } from '../shared/services/brevo-email.service';
import * as crypto from 'crypto';

@Injectable()
export class BookingsSyncService {
  constructor(
    private readonly convexService: ConvexService,
    private readonly s3Service: S3Service,
    @Inject(forwardRef(() => require('../fincas/fincas.service').FincasService))
    private readonly fincasService: FincasService,
    private readonly brevoEmailService: BrevoEmailService,
  ) {}

  async checkAvailability(
    propertyId: string,
    fechaEntrada: number,
    fechaSalida: number,
  ) {
    return this.convexService.query('bookings:checkAvailability', {
      propertyId: propertyId as any,
      fechaEntrada,
      fechaSalida,
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
      horaEntrada?: string;
      horaSalida?: string;
      city?: string;
      purpose?: string;
      reference?: string;
      address?: string;
      isDirect?: boolean | string;
      status?: string;
      personasAdicionales?: number | string;
      costoPersonasAdicionales?: number | string;
      costoPersonalServicio?: number | string;
      depositoGarantia?: number | string;
      depositoAseo?: number | string;
      discountAmount?: number | string;
      subtotal?: number | string;
      tieneMascotas?: boolean | string;
      multimediaLinks?:
        | string
        | Array<{ url: string; name?: string; type?: string }>;
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
    const isDirectBool = parseBool(params.isDirect);
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
    let multimedia: { url: string; name: string; type: string }[] = [];

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
      numeroNoches: Math.ceil(
        (fechaSalidaNum - fechaEntradaNum) / (1000 * 60 * 60 * 24),
      ),
      observaciones: params.observaciones,
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
      tieneMascotas: tieneMascotasBool,
      isDirect: isDirectBool,
      status: bookingStatus,
    });
    
    // 4. Generar contrato automáticamente para reservas directas (o todas si se desea)
    // El usuario solicitó que "una vez creada la reserva, crea también el contrato"
    try {
      console.log(`[api] Generando contrato automático para la reserva ${bookingId}...`);
      
      const checkInDateStr = params.fechaEntrada ? (typeof params.fechaEntrada === 'number' ? new Date(params.fechaEntrada).toISOString().split('T')[0] : String(params.fechaEntrada)) : '';
      const checkOutDateStr = params.fechaSalida ? (typeof params.fechaSalida === 'number' ? new Date(params.fechaSalida).toISOString().split('T')[0] : String(params.fechaSalida)) : '';

      await this.fincasService.generateContract(propertyId, {
        propertyId,
        bookingId,
        clientName: params.nombreCompleto,
        clientId: params.cedula,
        clientEmail: params.correo,
        clientPhone: params.celular,
        idNumber: params.cedula,
        clientCity: params.city || '',
        clientAddress: params.address || '',
        checkInDate: checkInDateStr,
        checkOutDate: checkOutDateStr,
        checkInTime: params.horaEntrada || '03:00 PM',
        checkOutTime: params.horaSalida || '01:00 PM',
        nightlyPrice: String(precioTotalNum / (Math.max(1, Math.ceil((fechaSalidaNum - fechaEntradaNum) / (1000 * 60 * 60 * 24))))), 
        totalPrice: String(precioTotalNum),
        contractNumber: params.reference || `REC-${bookingId.slice(-6)}`,
        bankName: 'Bold/FincasYa',
        accountNumber: 'N/A',
        accountHolder: 'FincasYa',
        conversationId: isDirectBool ? 'direct-reservation' : 'internal-booking',
        petCount: numeroMascotasNum,
        petDeposit: depositoMascotasNum,
        petSurcharge: sobrecargoMascotasNum,
        serviceStaffFee: costoPersonalServicioNum,
      });
      console.log(`[api] Contrato automático generado para ${bookingId}`);
    } catch (contractErr) {
      console.error(`[api] Error generando contrato automático para ${bookingId}:`, contractErr.message);
      // No lanzamos error para no romper el flujo de creación de la reserva
    }

    // 5. Generar firma de integridad para Bold...
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

          // 6. Enviar notificaciones por correo (Brevo)
          try {
            const contractFile = (booking.multimedia || []).find((m: any) => m.type === 'application/pdf');
            const contractUrl = contractFile?.url || '';

            // Notificación al Cliente
            await this.brevoEmailService.sendBookingConfirmationToClient({
              clientEmail: booking.correo,
              clientName: booking.nombreCompleto,
              propertyTitle: (booking as any).propertyTitle || 'tu propiedad',
              reference: reference,
              contractUrl: contractUrl,
            });

            // Notificación al Administrador
            await this.brevoEmailService.sendBookingAlertToAdmin({
              clientName: booking.nombreCompleto,
              clientEmail: booking.correo,
              clientPhone: booking.celular,
              propertyTitle: (booking as any).propertyTitle || 'Propiedad Reservada',
              checkInDate: new Date(booking.fechaEntrada).toLocaleDateString('es-CO'),
              checkOutDate: new Date(booking.fechaSalida).toLocaleDateString('es-CO'),
              totalAmount: booking.precioTotal,
              reference: reference,
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
