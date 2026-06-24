import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Query,
  Param,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
  UploadedFile,
  Req,
  Res,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { FilesInterceptor, FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { BookingsSyncService } from './bookings-sync.service';
import { BookingsRemindersService } from './bookings-reminders.service';
import {
  CheckinMessagingService,
  type CheckinMomentKey,
  type PortalExtraBankAccount,
} from './checkin-messaging.service';
import { ConvexAuthGuard } from '../shared/guards/convex-auth.guard';
import { AdminGuard } from '../shared/guards/admin.guard';
import { OwnerOrAdminGuard } from '../shared/guards/owner-or-admin.guard';
import { RolesGuard } from '../shared/guards/roles.guard';
import { Roles } from '../shared/decorators/roles.decorator';
import { UserRole } from '../shared/constants/user-role';
import { AuthService } from '../auth/auth.service';

@Controller('bookings')
export class BookingsController {
  constructor(
    private readonly bookingsSyncService: BookingsSyncService,
    private readonly authService: AuthService,
    private readonly remindersService: BookingsRemindersService,
    private readonly checkinMessaging: CheckinMessagingService,
  ) {}

  @Post('trigger-reminders')
  @UseGuards(ConvexAuthGuard, AdminGuard)
  async triggerReminders() {
    return this.remindersService.triggerRemindersManually();
  }

  // ───────────────────────────────────────────────────────────────────────
  // Mensajería de check-in (timeline §3 + envío en lote §10)
  // ───────────────────────────────────────────────────────────────────────

  /** Catálogo de plantillas Meta del flujo de check-in. */
  @Get('checkin/templates')
  @UseGuards(ConvexAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ASSISTANT)
  async listCheckinTemplates() {
    return this.checkinMessaging.listTemplates();
  }

  /** Registra (crea) las plantillas del catálogo en YCloud/Meta. */
  @Post('checkin/register-templates')
  @UseGuards(ConvexAuthGuard, AdminGuard)
  async registerCheckinTemplates(
    @Body() body: { wabaId?: string; onlyKeys?: string[] },
  ) {
    return this.checkinMessaging.registerTemplates(body?.wabaId, body?.onlyKeys);
  }

  /** Dispara manualmente todos los momentos programados de HOY. */
  @Post('checkin/trigger-daily')
  @UseGuards(ConvexAuthGuard, AdminGuard)
  async triggerCheckinDaily(@Body() body: { dryRun?: boolean }) {
    return this.checkinMessaging.triggerDailyManually(Boolean(body?.dryRun));
  }

  /** Dispara un único momento con una ventana de fecha explícita. */
  @Post('checkin/trigger-moment')
  @UseGuards(ConvexAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ASSISTANT)
  async triggerCheckinMoment(
    @Body()
    body: {
      key: CheckinMomentKey;
      minDate: number;
      maxDate: number;
      tag?: string;
      dryRun?: boolean;
    },
  ) {
    if (!body?.key || !body?.minDate || !body?.maxDate) {
      throw new HttpException(
        'key, minDate y maxDate son requeridos',
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.checkinMessaging.triggerMoment(
      body.key,
      body.minDate,
      body.maxDate,
      body.tag,
      Boolean(body.dryRun),
    );
  }

  /** Reservas candidatas (con params por defecto) para el envío en lote. */
  @Get('checkin/batch-candidates')
  @UseGuards(ConvexAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ASSISTANT)
  async listBatchCandidates(
    @Query('templateKey') templateKey: string,
    @Query('minDate') minDate: string,
    @Query('maxDate') maxDate: string,
    @Query('tag') tag?: string,
  ) {
    const min = Number(minDate);
    const max = Number(maxDate);
    if (!templateKey || !Number.isFinite(min) || !Number.isFinite(max)) {
      throw new HttpException(
        'templateKey, minDate y maxDate son requeridos',
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.checkinMessaging.listBookingsForBatch(
      templateKey,
      min,
      max,
      tag?.trim() || undefined,
    );
  }

  /** Envío en lote con destinatarios ya editados por el equipo (spec §10). */
  @Post('checkin/send-batch')
  @UseGuards(ConvexAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ASSISTANT)
  async sendCheckinBatch(
    @Body()
    body: {
      templateKey: string;
      recipients: Array<{
        bookingId?: string;
        to: string;
        recipientName?: string;
        bodyParams: string[];
        logToInbox?: boolean;
      }>;
      dryRun?: boolean;
    },
  ) {
    if (!body?.templateKey || !Array.isArray(body?.recipients)) {
      throw new HttpException(
        'templateKey y recipients son requeridos',
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.checkinMessaging.sendBatch(
      body.templateKey,
      body.recipients,
      Boolean(body.dryRun),
    );
  }

  /** Envío manual de una plantilla a UNA reserva (desde el modal de Reservas). */
  @Post('checkin/:id/send')
  @UseGuards(ConvexAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ASSISTANT)
  async sendTemplateToBooking(
    @Param('id') id: string,
    @Body() body: { templateKey: string; dryRun?: boolean },
  ) {
    if (!body?.templateKey) {
      throw new HttpException(
        'templateKey es requerido',
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.checkinMessaging.sendTemplateToBooking(
      id,
      body.templateKey,
      Boolean(body.dryRun),
    );
  }

  /** Envía el correo de invitación al check-in al cliente de la reserva. */
  @Post('checkin/:id/send-email')
  @UseGuards(ConvexAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ASSISTANT)
  async sendCheckinEmail(@Param('id') id: string) {
    try {
      return await this.remindersService.sendCheckinInvitation(id);
    } catch (err) {
      throw new HttpException(
        {
          error:
            err instanceof Error
              ? err.message
              : 'No se pudo enviar el correo de check-in',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /** Marca/desmarca manualmente el check-in como enviado (etapa morado). */
  @Post('checkin/:id/mark-sent')
  @UseGuards(ConvexAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ASSISTANT)
  async markCheckinSent(
    @Param('id') id: string,
    @Body() body: { sent?: boolean },
  ) {
    return this.checkinMessaging.markCheckinSent(id, body?.sent ?? true);
  }

  /** Check-out propietario (Fase 1): guarda las observaciones del cliente (editable + log). */
  @Post(':id/client-observaciones')
  @UseGuards(ConvexAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ASSISTANT)
  async saveClientObservaciones(
    @Param('id') id: string,
    @Body() body: { valor?: string; actor?: string },
  ) {
    return this.checkinMessaging.saveClientObservaciones(
      id,
      String(body?.valor ?? ''),
      body?.actor,
    );
  }

  /** Check-out propietario (Fase 1): registra/edita el pago al propietario (+ comprobante). */
  @Post(':id/owner-payout')
  @UseGuards(ConvexAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ASSISTANT)
  @UseInterceptors(
    FileInterceptor('comprobante', {
      storage: memoryStorage(),
      limits: { fileSize: 50 * 1024 * 1024 },
    }),
  )
  async saveOwnerPayout(
    @Param('id') id: string,
    @Body()
    body: {
      valorAcordado?: string;
      abono?: string;
      valor?: string;
      fecha?: string;
      medio?: string;
      actor?: string;
    },
    @UploadedFile() comprobante?: Express.Multer.File,
  ) {
    const toNum = (v?: string) =>
      v !== undefined && v !== ''
        ? Number(String(v).replace(/[^\d.-]/g, ''))
        : undefined;
    return this.checkinMessaging.saveOwnerPayout(
      id,
      {
        valorAcordado: toNum(body?.valorAcordado),
        abono: toNum(body?.abono),
        valor: toNum(body?.valor),
        fecha: body?.fecha,
        medio: body?.medio,
        actor: body?.actor,
      },
      comprobante,
    );
  }

  /** Check-out cliente (Fase 3): validación del propietario por el equipo admin. */
  @Post(':id/deposit-approval')
  @UseGuards(ConvexAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ASSISTANT)
  async saveDepositApproval(
    @Param('id') id: string,
    @Body()
    body: {
      estado: string;
      nombre?: string;
      motivo?: string;
      obsPropietario?: string;
      valorRetenido?: number | string;
    },
  ) {
    if (!body?.estado) {
      throw new HttpException('estado es requerido', HttpStatus.BAD_REQUEST);
    }
    const vr =
      body.valorRetenido != null && body.valorRetenido !== ''
        ? Number(String(body.valorRetenido).replace(/[^\d.-]/g, ''))
        : undefined;
    return this.checkinMessaging.saveDepositApproval(id, {
      estado: body.estado,
      por: 'admin',
      nombre: body.nombre,
      motivo: body.motivo,
      obsPropietario: body.obsPropietario,
      valorRetenido: vr,
    });
  }

  /** Validación del propietario desde su enlace público (sin login, por referencia). */
  @Post('owner/:ref/deposit-approval')
  async saveDepositApprovalByOwner(
    @Param('ref') ref: string,
    @Body()
    body: {
      estado: string;
      nombre?: string;
      motivo?: string;
      obsPropietario?: string;
    },
  ) {
    if (!body?.estado) {
      throw new HttpException('estado es requerido', HttpStatus.BAD_REQUEST);
    }
    const result = await this.checkinMessaging.saveDepositApprovalByRef(ref, {
      estado: body.estado,
      nombre: body.nombre,
      motivo: body.motivo,
      obsPropietario: body.obsPropietario,
    });
    if (!result.ok) {
      throw new HttpException(
        { error: 'not_found', message: 'No encontramos esta reserva.' },
        HttpStatus.NOT_FOUND,
      );
    }
    return { ok: true };
  }

  /** Persona que recibe a los turistas: la diligencia el propietario desde su enlace. */
  @Post('owner/:ref/receiver')
  async saveOwnerReceiver(
    @Param('ref') ref: string,
    @Body() body: { nombre?: string; contacto?: string },
  ) {
    const result = await this.checkinMessaging.saveOwnerReceiverByRef(ref, {
      nombre: body?.nombre,
      contacto: body?.contacto,
    });
    if (!result.ok) {
      throw new HttpException(
        { error: 'not_found', message: 'No encontramos esta reserva.' },
        HttpStatus.NOT_FOUND,
      );
    }
    return { ok: true };
  }

  /** Check-out cliente (Fase 3): registra el pago de devolución (+ comprobante). */
  @Post(':id/deposit-refund')
  @UseGuards(ConvexAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ASSISTANT)
  @UseInterceptors(
    FileInterceptor('comprobante', {
      storage: memoryStorage(),
      limits: { fileSize: 50 * 1024 * 1024 },
    }),
  )
  async saveDepositRefund(
    @Param('id') id: string,
    @Body()
    body: {
      valor?: string;
      fecha?: string;
      medio?: string;
      numTransaccion?: string;
      observaciones?: string;
      actor?: string;
    },
    @UploadedFile() comprobante?: Express.Multer.File,
  ) {
    const valorNum =
      body?.valor != null && body.valor !== ''
        ? Number(String(body.valor).replace(/[^\d.-]/g, ''))
        : undefined;
    return this.checkinMessaging.saveDepositRefund(
      id,
      {
        valor: valorNum,
        fecha: body?.fecha,
        medio: body?.medio,
        numTransaccion: body?.numTransaccion,
        observaciones: body?.observaciones,
        actor: body?.actor,
      },
      comprobante,
    );
  }

  /** Check-out cliente (Fase 3): sube evidencias de retención (daños/novedades). */
  @Post(':id/deposit-evidencias')
  @UseGuards(ConvexAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ASSISTANT)
  @UseInterceptors(
    FilesInterceptor('evidencias', 10, {
      storage: memoryStorage(),
      limits: { fileSize: 50 * 1024 * 1024 },
    }),
  )
  async addDepositEvidencias(
    @Param('id') id: string,
    @UploadedFiles() evidencias?: Express.Multer.File[],
  ) {
    return this.checkinMessaging.addDepositEvidencias(id, evidencias);
  }

  /** Vista pública para el propietario (por referencia, solo lectura). */
  @Get('owner/:ref')
  async getOwnerView(@Param('ref') ref: string) {
    const data = await this.checkinMessaging.getOwnerView(ref);
    if (!data) {
      throw new HttpException(
        { error: 'not_found', message: 'No encontramos esta reserva.' },
        HttpStatus.NOT_FOUND,
      );
    }
    return { ok: true, ...data };
  }

  /** PDF del listado de invitados, generado al vuelo (público, para el propietario). */
  @Get('owner/:ref/guests-pdf')
  async getOwnerGuestsPdf(@Param('ref') ref: string, @Res() res: Response) {
    const result = await this.checkinMessaging.getOwnerGuestsPdf(ref);
    if (!result) {
      throw new HttpException(
        {
          error: 'not_found',
          message: 'Aún no hay listado de invitados para esta reserva.',
        },
        HttpStatus.NOT_FOUND,
      );
    }
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${result.filename}"`,
      'Content-Length': String(result.buffer.length),
    });
    res.send(result.buffer);
  }

  /** Resumen de pago + imágenes por WhatsApp al cliente de la reserva. */
  @Post('checkin/:id/send-payment')
  @UseGuards(ConvexAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ASSISTANT)
  async sendPaymentSummary(
    @Param('id') id: string,
    @Body()
    body: {
      messageText: string;
      images?: Array<{ label?: string; imageUrl: string }>;
      dryRun?: boolean;
    },
  ) {
    if (!body?.messageText?.trim()) {
      throw new HttpException(
        'messageText es requerido',
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.checkinMessaging.sendPaymentSummary(id, {
      messageText: body.messageText.trim(),
      images: Array.isArray(body.images) ? body.images : [],
      dryRun: Boolean(body.dryRun),
    });
  }

  /** Etiqueta de lote (ej. "puente_festivo") sobre una reserva. */
  @Post('checkin/:id/tag')
  @UseGuards(ConvexAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ASSISTANT)
  async setBroadcastTag(
    @Param('id') id: string,
    @Body('tag') tag: string | null,
  ) {
    return this.checkinMessaging.setBroadcastTag(id, tag ?? null);
  }

  /** Check-in manual / marcar completado (spec §8.1). */
  @Post('checkin/:id/completed')
  @UseGuards(ConvexAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ASSISTANT)
  async setCheckinCompleted(
    @Param('id') id: string,
    @Body('completed') completed: boolean,
  ) {
    return this.checkinMessaging.setCheckinCompleted(id, Boolean(completed));
  }

  /** Link del portal de check-in (para copiar manualmente). */
  @Get('checkin/:id/link')
  @UseGuards(ConvexAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ASSISTANT)
  async getCheckinLink(@Param('id') id: string) {
    return this.checkinMessaging.getCheckinLink(id);
  }

  /** Link del portal de pago (para compartir con el cliente). */
  @Get('payment/:id/link')
  @UseGuards(ConvexAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ASSISTANT)
  async getPaymentLink(@Param('id') id: string) {
    return this.checkinMessaging.getPaymentLink(id);
  }

  /** Portal de pago público (fallback si Convex HTTP no responde). */
  @Get('payment-public/:key')
  async getPaymentPortalPublic(@Param('key') key: string) {
    const data = await this.checkinMessaging.getPaymentPortalByReference(key);
    if (!data) {
      throw new HttpException(
        { error: 'not_found', message: 'No encontramos esta reserva.' },
        HttpStatus.NOT_FOUND,
      );
    }
    return { ok: true, ...data };
  }

  /** Cuentas/imágenes que verá el cliente en el portal de pago. */
  @Post('payment/:id/config')
  @UseGuards(ConvexAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ASSISTANT)
  async savePaymentPortalConfig(
    @Param('id') id: string,
    @Body()
    body: {
      bankAccountIds: string[];
      paymentMediaIds?: string[];
      extraBankAccounts?: PortalExtraBankAccount[];
      boldLink?: string;
      boldSurcharge?: number;
    },
  ) {
    if (!Array.isArray(body?.bankAccountIds)) {
      throw new HttpException(
        'bankAccountIds es requerido',
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.checkinMessaging.savePaymentPortalConfig(id, {
      bankAccountIds: body.bankAccountIds,
      paymentMediaIds: body.paymentMediaIds,
      extraBankAccounts: body.extraBankAccounts,
      boldLink: body.boldLink,
      boldSurcharge: body.boldSurcharge,
    });
  }

  @Get('count')
  @UseGuards(ConvexAuthGuard, AdminGuard)
  async count() {
    return this.bookingsSyncService.countBookings();
  }

  @Get('my-bookings')
  @UseGuards(ConvexAuthGuard)
  async getMyBookings(@Req() req: Request) {
    const cookies = (req.headers.cookie ?? (req.headers as any)['Cookie'] ?? '') as string;
    const authHeader = req.headers.authorization;
    const session = await this.authService.getSession(cookies, authHeader);
    const sessionData = session?.data ?? session;
    const userEmail = sessionData?.user?.email;
    
    if (!userEmail) {
      throw new Error('No se pudo identificar el correo del usuario');
    }
    
    // We only pass userEmail. Passing userId (BetterAuth string) would cause the database to
    // look for a Contact with that ID, resulting in an empty list.
    return this.bookingsSyncService.listBookings({ userEmail });
  }

  @Get()
  @UseGuards(ConvexAuthGuard, OwnerOrAdminGuard)
  async list(@Query() query: any) {
    return this.bookingsSyncService.listBookings(query);
  }

  @Get('by-contract')
  @UseGuards(ConvexAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ASSISTANT, UserRole.VENDEDOR)
  async getByContractNumber(@Query('contractNumber') contractNumber: string) {
    if (!contractNumber?.trim()) {
      return null;
    }
    try {
      return await this.bookingsSyncService.getBookingByContractNumber(
        contractNumber.trim(),
      );
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : typeof err === 'string' ? err : 'Error desconocido';
      throw new HttpException(
        {
          error: 'Fallo al consultar reservas en Convex.',
          message: msg,
        },
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  @Get('contract-codes')
  @UseGuards(ConvexAuthGuard, AdminGuard)
  async listContractCodes(
    @Query('propertyId') propertyId?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('page') page?: string,
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) : undefined;
    const parsedPage = page ? parseInt(page, 10) : undefined;
    return this.bookingsSyncService.listContractCodes({
      propertyId: propertyId?.trim() || undefined,
      search: search?.trim() || undefined,
      limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
      page: Number.isFinite(parsedPage) ? parsedPage : undefined,
    });
  }

  @Get('contracts')
  @UseGuards(ConvexAuthGuard, AdminGuard)
  async listContracts(
    @Query('estado') estado?: string,
    @Query('origen') origen?: string,
    @Query('tipo') tipo?: string,
    @Query('propertyId') propertyId?: string,
    @Query('search') search?: string,
    @Query('cr') cr?: string,
    @Query('limit') limit?: string,
    @Query('page') page?: string,
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) : undefined;
    const parsedPage = page ? parseInt(page, 10) : undefined;
    return this.bookingsSyncService.listContracts({
      estado: estado?.trim() || undefined,
      origen: origen?.trim() || undefined,
      tipo: tipo?.trim() || undefined,
      propertyId: propertyId?.trim() || undefined,
      search: search?.trim() || undefined,
      cr: cr?.trim() || undefined,
      limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
      page: Number.isFinite(parsedPage) ? parsedPage : undefined,
    });
  }

  @Post('contracts/backfill')
  @UseGuards(ConvexAuthGuard, AdminGuard)
  async backfillContracts() {
    return this.bookingsSyncService.backfillContracts();
  }

  @Get('contracts/:contractNumber/detail')
  @UseGuards(ConvexAuthGuard, AdminGuard)
  async getContractDetail(@Param('contractNumber') contractNumber: string) {
    return this.bookingsSyncService.getContractDetail(contractNumber);
  }

  @Delete('contracts/:contractNumber')
  @UseGuards(ConvexAuthGuard, AdminGuard)
  async deleteContract(@Param('contractNumber') contractNumber: string) {
    return this.bookingsSyncService.deleteContract(contractNumber);
  }

  @Post('contracts/:contractNumber/cedula-photos')
  @UseGuards(ConvexAuthGuard, AdminGuard)
  @UseInterceptors(
    FilesInterceptor('photos', 2, {
      storage: memoryStorage(),
      limits: { fileSize: 8 * 1024 * 1024 },
    }),
  )
  async uploadContractCedulaPhotos(
    @Param('contractNumber') contractNumber: string,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    return this.bookingsSyncService.uploadContractCedulaPhotos(
      contractNumber,
      files ?? [],
    );
  }

  @Put('contracts/:contractNumber/cedula-photos')
  @UseGuards(ConvexAuthGuard, AdminGuard)
  async updateContractCedulaPhotos(
    @Param('contractNumber') contractNumber: string,
    @Body() body: { cedulaPhotoUrls?: string[] },
  ) {
    return this.bookingsSyncService.updateContractCedulaPhotos(
      contractNumber,
      body?.cedulaPhotoUrls ?? [],
    );
  }

  @Get('contracts/:contractNumber')
  @UseGuards(ConvexAuthGuard, AdminGuard)
  async getContract(@Param('contractNumber') contractNumber: string) {
    return this.bookingsSyncService.getContract(contractNumber);
  }

  @Post(':id/receipts/review')
  @UseGuards(ConvexAuthGuard, AdminGuard)
  async reviewReceipts(@Param('id') id: string) {
    return this.bookingsSyncService.markPaymentReceiptsReviewed(id);
  }

  @Post('check-availability')
  @UseGuards(ConvexAuthGuard, AdminGuard)
  async checkAvailability(
    @Body()
    body: {
      propertyId: string;
      fechaEntrada: number;
      fechaSalida: number;
      excludeBookingId?: string;
    },
  ) {
    return this.bookingsSyncService.checkAvailability(
      body.propertyId,
      body.fechaEntrada,
      body.fechaSalida,
      body.excludeBookingId,
    );
  }

  /**
   * Endpoint público para verificar disponibilidad (desde la web)
   */
  @Post('check-availability-public')
  async checkAvailabilityPublic(
    @Body()
    body: {
      propertyId: string;
      fechaEntrada: number;
      fechaSalida: number;
    },
  ) {
    return this.bookingsSyncService.checkAvailability(
      body.propertyId,
      body.fechaEntrada,
      body.fechaSalida,
    );
  }

  /**
   * Rangos ocupados para deshabilitar fechas en el calendario público.
   */
  @Get('blocked-dates-public')
  async getBlockedDatesPublic(
    @Query('propertyId') propertyId: string,
    @Query('monthsAhead') monthsAhead?: string,
  ) {
    if (!propertyId) {
      throw new HttpException(
        'propertyId es requerido',
        HttpStatus.BAD_REQUEST,
      );
    }
    const months = monthsAhead ? parseInt(monthsAhead, 10) : 12;
    return this.bookingsSyncService.getBlockedDateRanges(
      propertyId,
      Number.isFinite(months) ? months : 12,
    );
  }

  /**
   * Endpoint público para reservas directas (desde la web)
   */
  @Post('direct')
  async createDirect(@Body() body: any) {
    return this.bookingsSyncService.createBooking(body);
  }

  @Get('status/:reference')
  async getStatus(@Param('reference') reference: string) {
    return this.bookingsSyncService.checkPaymentStatus(reference);
  }

  @Post('contract-snapshot')
  @UseGuards(ConvexAuthGuard, AdminGuard)
  async saveContractSnapshot(
    @Body()
    body: {
      contractNumber: string;
      propertyId: string;
      payload: Record<string, unknown>;
    },
  ) {
    return this.bookingsSyncService.saveContractSnapshot(body);
  }

  @Post('finalize-contract-snapshot')
  @UseGuards(ConvexAuthGuard, AdminGuard)
  async finalizeContractSnapshot(
    @Body()
    body: {
      snapshotId: string;
      paymentStatus: string;
    },
  ) {
    return this.bookingsSyncService.finalizeContractSnapshot(body);
  }

  @Post()
  @UseGuards(ConvexAuthGuard, AdminGuard)
  @UseInterceptors(
    FilesInterceptor('multimedia', 10, {
      storage: memoryStorage(),
      limits: { fileSize: 50 * 1024 * 1024 },
    }),
  )
  async create(
    @Body() body: any,
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    return this.bookingsSyncService.createBooking(body, files);
  }

  @Put(':id')
  @UseGuards(ConvexAuthGuard, AdminGuard)
  @UseInterceptors(
    FilesInterceptor('multimedia', 10, {
      storage: memoryStorage(),
      limits: { fileSize: 50 * 1024 * 1024 },
    }),
  )
  async update(
    @Param('id') id: string,
    @Body() body: any,
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    return this.bookingsSyncService.updateBooking(id, body, files);
  }

  @Get(':id/payments')
  @UseGuards(ConvexAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ASSISTANT, UserRole.VENDEDOR)
  async getBookingPayments(@Param('id') id: string) {
    const data = await this.bookingsSyncService.getBookingPayments(id);
    if (!data) {
      throw new HttpException('Reserva no encontrada', HttpStatus.NOT_FOUND);
    }
    return data;
  }

  @Post(':id/payments')
  @UseGuards(ConvexAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ASSISTANT, UserRole.VENDEDOR)
  async createManualPayment(
    @Param('id') id: string,
    @Body()
    body: {
      type: 'ABONO_50' | 'SALDO_50' | 'COMPLETO' | 'REEMBOLSO';
      amount: number;
      paymentMethod?: string;
      reference?: string;
      notes?: string;
    },
  ) {
    if (!body?.type || body.amount === undefined) {
      throw new HttpException(
        'type y amount son requeridos',
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.bookingsSyncService.createManualPayment(id, body);
  }

  @Delete(':id')
  @UseGuards(ConvexAuthGuard, AdminGuard)
  async remove(@Param('id') id: string) {
    return this.bookingsSyncService.deleteBooking(id);
  }

  @Post(':id/multimedia')
  @UseGuards(ConvexAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  async uploadMultimedia(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.bookingsSyncService.uploadMultimedia(id, file);
  }

  @Delete(':id/multimedia')
  @UseGuards(ConvexAuthGuard)
  async removeMultimedia(
    @Param('id') id: string,
    @Body('url') url: string,
  ) {
    return this.bookingsSyncService.removeMultimedia(id, url);
  }
}
