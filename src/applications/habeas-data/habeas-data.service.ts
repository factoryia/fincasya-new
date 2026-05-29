import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConvexService } from '../shared/services/convex.service';
import { BrevoEmailService } from '../shared/services/brevo-email.service';
import { CreateHabeasDataDto } from './dto/create-habeas-data.dto';
import { UpdateHabeasDataStatusDto } from './dto/update-habeas-data-status.dto';

const REQUEST_TYPE_LABELS: Record<string, string> = {
  acceso: 'Acceso',
  rectificacion: 'Rectificación',
  cancelacion: 'Cancelación / Supresión',
  oposicion: 'Oposición',
  revocatoria: 'Revocatoria del consentimiento',
  queja: 'Queja por uso indebido',
};

@Injectable()
export class HabeasDataService {
  private readonly logger = new Logger(HabeasDataService.name);

  constructor(
    private readonly convexService: ConvexService,
    private readonly brevoEmailService: BrevoEmailService,
  ) {}

  /**
   * Crea una solicitud de Habeas Data:
   * 1. Persiste en Convex (fuente de verdad).
   * 2. Envía email al admin (notificación; no bloquea si falla).
   */
  async create(
    dto: CreateHabeasDataDto,
    meta: { ipAddress?: string; userAgent?: string } = {},
  ) {
    let result: { id: string };
    try {
      result = await this.convexService.mutation('habeasData:create', {
        ...dto,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
    } catch (error) {
      this.logger.error(
        `Error persistiendo solicitud Habeas Data: ${error.message}`,
      );
      throw new BadRequestException(
        'No pudimos registrar tu solicitud. Por favor escríbenos a comercial@fincasya.com.',
      );
    }

    // Notificación al admin (best-effort, no rompe el flujo si falla)
    void this.brevoEmailService.sendHabeasDataRequestToAdmin({
      fullName: dto.fullName,
      documentType: dto.documentType,
      documentNumber: dto.documentNumber,
      email: dto.email,
      phone: dto.phone,
      requestType: dto.requestType,
      requestTypeLabel:
        REQUEST_TYPE_LABELS[dto.requestType] ?? dto.requestType,
      description: dto.description,
      submittedAt: new Date().toISOString(),
      requestId: result.id,
    });

    return { ok: true, id: result.id };
  }

  async list(status?: string, limit?: number) {
    try {
      const args: Record<string, unknown> = {};
      if (status) args.status = status;
      if (limit !== undefined) args.limit = Number(limit);
      return await this.convexService.query('habeasData:list', args);
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async getById(id: string) {
    try {
      const item = await this.convexService.query('habeasData:getById', { id });
      if (!item) throw new NotFoundException('Solicitud no encontrada');
      return item;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException(error.message);
    }
  }

  async updateStatus(id: string, dto: UpdateHabeasDataStatusDto) {
    try {
      return await this.convexService.mutation('habeasData:updateStatus', {
        id,
        ...dto,
      });
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async countPending() {
    try {
      return await this.convexService.query('habeasData:countPending', {});
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }
}
