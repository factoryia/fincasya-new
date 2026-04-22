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
          
          await this.brevoEmailService.sendReservationReminder({
            clientEmail: booking.correo,
            clientName: booking.nombreCompleto,
            propertyTitle: (booking as any).propertyTitle,
            checkInDate: new Date(booking.fechaEntrada).toLocaleDateString('es-CO'),
            checkInTime: booking.horaEntrada || '03:00 PM',
            reference: booking.reference || booking._id.slice(-6),
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
}
