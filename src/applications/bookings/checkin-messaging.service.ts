import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConvexService } from '../shared/services/convex.service';
import { addDays, startOfDay, endOfDay, getDay } from 'date-fns';

/** Clave lógica de cada momento del timeline (debe coincidir con el catálogo Convex). */
export type CheckinMomentKey =
  | 'owner_week_reminder'
  | 'tourist_checkin_start'
  | 'tourist_checkin_pending'
  | 'tourist_travel_tomorrow'
  | 'owner_arrival_tomorrow'
  | 'tourist_departure';

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

  constructor(private readonly convexService: ConvexService) {}

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
}
