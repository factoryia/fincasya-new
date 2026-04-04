import { Injectable } from '@nestjs/common';
import { ConvexService } from './convex.service';
import { GoogleCalendarService } from './google-calendar.service';
import { S3Service } from './s3.service';

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
      observaciones?: string;
      horaEntrada?: string;
      horaSalida?: string;
      city?: string;
      purpose?: string;
    },
    multimediaFiles?: Express.Multer.File[],
  ) {
    const { propertyId, ...rest } = params;

    // Normalize types if they come as strings from FormData
    const fechaEntradaNum = typeof params.fechaEntrada === 'string' ? parseInt(params.fechaEntrada, 10) : params.fechaEntrada;
    const fechaSalidaNum = typeof params.fechaSalida === 'string' ? parseInt(params.fechaSalida, 10) : params.fechaSalida;
    const numeroPersonasNum = typeof params.numeroPersonas === 'string' ? parseInt(params.numeroPersonas, 10) : params.numeroPersonas;
    const precioTotalNum = typeof params.precioTotal === 'string' ? parseInt(params.precioTotal, 10) : params.precioTotal;

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
    });

    return { bookingId };
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
