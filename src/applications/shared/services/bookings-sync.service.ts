import { Injectable } from '@nestjs/common';
import { ConvexService } from './convex.service';
import { GoogleCalendarService } from './google-calendar.service';
import { S3Service } from './s3.service';
import * as crypto from 'crypto';

@Injectable()
export class BookingsSyncService {
  constructor(
    private readonly convexService: ConvexService,
    private readonly googleCalendarService: GoogleCalendarService,
    private readonly s3Service: S3Service,
  ) {}

  async checkAvailability(propertyId: string, fechaEntrada: number, fechaSalida: number) {
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
      observaciones?: string;
      horaEntrada?: string;
      horaSalida?: string;
      city?: string;
      purpose?: string;
      reference?: string;
      address?: string;
      isDirect?: boolean;
    },
    multimediaFiles?: Express.Multer.File[],
  ) {
    const { propertyId, temporada, ...rest } = params;

    // Normalize types if they come as strings from FormData
    const fechaEntradaNum = typeof params.fechaEntrada === 'string' ? parseInt(params.fechaEntrada, 10) : params.fechaEntrada;
    const fechaSalidaNum = typeof params.fechaSalida === 'string' ? parseInt(params.fechaSalida, 10) : params.fechaSalida;
    const numeroPersonasNum = typeof params.numeroPersonas === 'string' ? parseInt(params.numeroPersonas, 10) : params.numeroPersonas;
    const precioTotalNum = typeof params.precioTotal === 'string' ? parseFloat(params.precioTotal) : params.precioTotal;
    const numeroMascotasNum = typeof params.numeroMascotas === 'string' ? parseInt(params.numeroMascotas, 10) : (params.numeroMascotas || 0);
    const costoMascotasNum = typeof params.costoMascotas === 'string' ? parseFloat(params.costoMascotas) : (params.costoMascotas || 0);

    // 1. Obtener info de la propiedad
    const property = await this.convexService.query('fincas:getById', {
      id: propertyId as any,
    });
    if (!property) throw new Error('Propiedad no encontrada');

    // 2. Subir multimedia si existe
    let multimedia: { url: string; name: string; type: string }[] | undefined;
    if (multimediaFiles && multimediaFiles.length > 0) {
      multimedia = await Promise.all(
        multimediaFiles.map(async (file) => {
          const url = await this.s3Service.uploadFile(file, 'bookings/multimedia');
          return {
            url,
            name: file.originalname,
            type: file.mimetype,
          };
        }),
      );
    }

    // 3. Crear reserva en Convex
    const bookingId = await this.convexService.mutation('bookings:create', {
      propertyId: propertyId as any,
      ...rest,
      fechaEntrada: fechaEntradaNum,
      fechaSalida: fechaSalidaNum,
      numeroPersonas: numeroPersonasNum,
      precioTotal: precioTotalNum,
      numeroNoches: Math.ceil((fechaSalidaNum - fechaEntradaNum) / (1000 * 60 * 60 * 24)),
      subtotal: precioTotalNum,
      multimedia,
      temporada,
      numeroMascotas: numeroMascotasNum,
      costoMascotas: costoMascotasNum,
    });

    // 4. Generar firma de integridad para Bold (opcional pero recomendado si viene de la web)
    let integritySignature = null;
    const boldSecret = process.env.BOLD_SHARED_SECRET;
    
    if (params.reference && boldSecret) {
      const amount = Math.floor(precioTotalNum);
      const currency = 'COP';
      const dataToHash = `${params.reference}${amount}${currency}${boldSecret}`;
      integritySignature = crypto.createHash('sha256').update(dataToHash).digest('hex');
    }

    return { bookingId, integritySignature };
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
}
