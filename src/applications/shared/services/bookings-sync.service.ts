import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConvexService } from './convex.service';
import { GoogleCalendarService } from './google-calendar.service';

@Injectable()
export class BookingsSyncService {
  constructor(
    private readonly convexService: ConvexService,
    private readonly googleCalendarService: GoogleCalendarService,
  ) {}

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

    // 3. Crear evento en Google Calendar
    try {
      const eventId = await this.googleCalendarService.createEvent({
        summary: `Reserva: ${property.title} - ${params.nombreCompleto}`,
        location: property.location,
        description: `Cliente: ${params.nombreCompleto}\nCédula: ${params.cedula}\nCelular: ${params.celular}\nCorreo: ${params.correo}\nPrecio: $${params.precioTotal.toLocaleString('es-CO')}\nObservaciones: ${params.observaciones || 'Ninguna'}`,
        start: new Date(params.fechaEntrada),
        end: new Date(params.fechaSalida),
      });

      // 4. Actualizar reserva en Convex con el ID de Google
      await this.convexService.mutation('bookings:update', {
        id: bookingId,
        googleEventId: eventId,
        googleCalendarId: process.env.GOOGLE_CALENDAR_ID || 'primary',
      });
    } catch (error) {
      console.error('Error syncing with Google Calendar:', error);
      // No fallamos la creación de la reserva si falla Google, pero lo logueamos
    }

    return { bookingId };
  }

  /**
   * Sincronizar una reserva existente (por ejemplo, si se actualizan fechas).
   */
  async syncBooking(bookingId: string) {
    const booking = await this.convexService.query('bookings:getById', {
      id: bookingId as any,
    });
    if (!booking || !booking.googleEventId) return;

    const property = await this.convexService.query('fincas:getById', {
      id: booking.propertyId as any,
    });

    await this.googleCalendarService.updateEvent(booking.googleEventId, {
      summary: `Reserva: ${property.title} - ${booking.nombreCompleto}`,
      location: property.location,
      start: new Date(booking.fechaEntrada),
      end: new Date(booking.fechaSalida),
    });
  }

  /**
   * Listar reservas desde Convex (que ya están sincronizadas).
   */
  async listBookings(params: any) {
    return this.convexService.query('bookings:list', params);
  }
}
