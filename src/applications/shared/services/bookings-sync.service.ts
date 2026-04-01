import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConvexService } from './convex.service';
import { GoogleCalendarService } from './google-calendar.service';

@Injectable()
export class BookingsSyncService {
  constructor(
    private readonly convexService: ConvexService,
    private readonly googleCalendarService: GoogleCalendarService,
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
  async createBooking(params: {
    propertyId: string;
    nombreCompleto: string;
    cedula: string;
    celular: string;
    correo: string;
    fechaEntrada: number; // ms
    fechaSalida: number; // ms
    numeroPersonas: number;
    precioTotal: number;
    temporada: string;
    observaciones?: string;
  }) {
    const { propertyId, ...rest } = params;

    // 1. Obtener info de la propiedad para el título del evento
    const property = await this.convexService.query('fincas:getById', {
      id: propertyId as any,
    });
    if (!property) throw new Error('Propiedad no encontrada');

    // 2. Crear reserva en Convex (PENDING por defecto)
    const bookingId = await this.convexService.mutation('bookings:create', {
      propertyId: propertyId as any,
      ...rest,
      numeroNoches: Math.ceil((params.fechaSalida - params.fechaEntrada) / (1000 * 60 * 60 * 24)),
      subtotal: params.precioTotal, // Simplificado para este flujo
    });

    // 3. (Google Calendar sync is handled asynchronously by Convex itself in background)
    // El background worker `syncBookingToCalendar` hace la sincronización evitando delays aquí.

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
