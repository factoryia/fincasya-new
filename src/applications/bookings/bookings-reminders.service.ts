import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConvexService } from '../shared/services/convex.service';
import { BrevoEmailService } from '../shared/services/brevo-email.service';
import { addDays, startOfDay, endOfDay } from 'date-fns';

@Injectable()
export class BookingsRemindersService {
  private readonly logger = new Logger(BookingsRemindersService.name);

  constructor(
    private readonly convexService: ConvexService,
    private readonly brevoEmailService: BrevoEmailService,
  ) {}

  /**
   * Cron job que se ejecuta todos los días a las 8:00 AM
   */
  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async handleCron() {
    this.logger.log('Iniciando proceso de recordatorios de reserva (3 días antes)...');
    
    try {
      // Calcular el rango de fechas para dentro de 3 días
      const threeDaysFromNow = addDays(new Date(), 3);
      const minDate = startOfDay(threeDaysFromNow).getTime();
      const maxDate = endOfDay(threeDaysFromNow).getTime();

      this.logger.log(`Buscando reservas con entrada entre ${new Date(minDate).toISOString()} y ${new Date(maxDate).toISOString()}`);

      // Consultar reservas en Convex
      const bookingsToRemind = await this.convexService.query('bookings:listForReminders', {
        minDate,
        maxDate,
      });

      this.logger.log(`Se encontraron ${bookingsToRemind.length} reservas para enviar recordatorio.`);

      for (const booking of bookingsToRemind) {
        try {
          this.logger.log(`Enviando recordatorio para reserva ${booking._id} (${booking.correo})...`);
          
          const ref = booking.reference || booking._id;
          await this.brevoEmailService.sendReservationReminder({
            clientEmail: booking.correo,
            clientName: booking.nombreCompleto,
            propertyTitle: (booking).propertyTitle,
            checkInDate: new Date(booking.fechaEntrada).toLocaleDateString('es-CO'),
            checkInTime: this.formatHoraIngreso(
              booking.horaEntrada,
              booking.fechaEntrada,
            ),
            reference: booking.reference || booking._id.slice(-6),
            checkinUrl: `https://fincasya.com/checkin/${encodeURIComponent(ref)}`,
          });

          // Marcar como enviado en Convex
          await this.convexService.mutation('bookings:markReminderSent', {
            id: booking._id,
          });

          this.logger.log(`Recordatorio enviado y marcado exitosamente para ${booking._id}`);
        } catch (error) {
          this.logger.error(`Error procesando recordatorio para reserva ${booking._id}: ${error.message}`);
        }
      }

      this.logger.log('Proceso de recordatorios finalizado.');
    } catch (error) {
      this.logger.error(`Error en el cron de recordatorios: ${error.message}`);
    }
  }

  /**
   * Método manual para disparar los recordatorios (útil para pruebas)
   */
  async triggerRemindersManually() {
    return this.handleCron();
  }

  /** Hora de ingreso legible: usa horaEntrada si existe, si no la deriva del
   *  timestamp de llegada (hora Colombia). */
  private formatHoraIngreso(hora?: string | null, ms?: number): string {
    const s = String(hora ?? '').trim();
    const m = /^(\d{1,2}):(\d{2})$/.exec(s);
    if (m) {
      let h = parseInt(m[1], 10);
      const ampm = h >= 12 ? 'PM' : 'AM';
      if (h === 0) h = 12;
      else if (h > 12) h -= 12;
      return `${h}:${m[2]} ${ampm}`;
    }
    if (s) return s;
    if (ms != null && Number.isFinite(ms)) {
      return new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: 'America/Bogota',
      }).format(new Date(ms));
    }
    return '10:00 AM';
  }

  /** Envía el correo de invitación al check-in para una reserva (envío manual). */
  async sendCheckinInvitation(bookingId: string) {
    const booking = await this.convexService.query('bookings:getById', {
      id: bookingId,
    });
    if (!booking) throw new Error('Reserva no encontrada');
    if (!booking.correo) {
      throw new Error('La reserva no tiene correo del cliente');
    }

    const reference = booking.reference || bookingId;
    const checkinUrl = `https://fincasya.com/checkin/${encodeURIComponent(reference)}`;

    const fecha = new Intl.DateTimeFormat('es-CO', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'America/Bogota',
    }).format(new Date(booking.fechaEntrada));
    const fechaCap = fecha.charAt(0).toUpperCase() + fecha.slice(1);

    await this.brevoEmailService.sendCheckinInvitationToClient({
      clientEmail: booking.correo,
      clientName: booking.nombreCompleto || 'huésped',
      propertyTitle: booking.property?.title || 'tu finca',
      checkInDate: fechaCap,
      checkInTime: this.formatHoraIngreso(
        booking.horaEntrada,
        booking.fechaEntrada,
      ),
      reference,
      checkinUrl,
    });

    return { ok: true, to: booking.correo };
  }
}
