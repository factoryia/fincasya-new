import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
  BadRequestException,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { InboxService } from './inbox.service';
import { ConvexAuthGuard } from '../shared/guards/convex-auth.guard';
import { RolesGuard } from '../shared/guards/roles.guard';
import { Roles } from '../shared/decorators/roles.decorator';
import { UserRole } from '../shared/constants/user-role';

const VALID_OPERATIONAL_STATES = [
  'requires_advisor',
  'validate_availability',
  'ready_to_book',
  'pending_payment',
  'pending_data',
] as const;

type OperationalStateParam = (typeof VALID_OPERATIONAL_STATES)[number];

function isOperationalStateParam(s: string): s is OperationalStateParam {
  return (VALID_OPERATIONAL_STATES as readonly string[]).includes(s);
}

@Controller('inbox')
@UseGuards(ConvexAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.ASSISTANT, UserRole.VENDEDOR)
export class InboxController {
  constructor(private readonly inboxService: InboxService) {}

  /**
   * Listar conversaciones (inbox)
   * GET /api/inbox?status=human&priority=urgent&limit=50
   */
  @Get('operational-states')
  async listOperationalStates() {
    return this.inboxService.listOperationalStateDefinitions();
  }

  @Get('assignable-users')
  async listAssignableUsers() {
    return this.inboxService.listAssignableUsers();
  }

  @Get('ai-settings')
  async getAiSettings() {
    return this.inboxService.getAiSettings();
  }

  @Patch('ai-settings')
  @Roles(UserRole.ADMIN)
  async setAiSettings(@Body() body: { aiEnabled: boolean }) {
    if (typeof body?.aiEnabled !== 'boolean') {
      throw new BadRequestException('aiEnabled debe ser boolean');
    }
    return this.inboxService.setAiEnabled(body.aiEnabled);
  }

  @Get()
  async list(
    @Query('status') status?: 'ai' | 'human' | 'resolved',
    @Query('attended') attended?: string,
    @Query('priority') priority?: 'urgent' | 'low' | 'medium' | 'resolved',
    @Query('operationalStates') operationalStatesRaw?: string,
    @Query('assignedUserIds') assignedUserIdsRaw?: string,
    @Query('unassignedOnly') unassignedOnly?: string,
    @Query('unreadOnly') unreadOnly?: string,
    @Query('tagsAny') tagsAnyRaw?: string,
    @Query('lastMessageFrom') lastMessageFromRaw?: string,
    @Query('lastMessageTo') lastMessageToRaw?: string,
    @Query('channel') channel?: 'whatsapp' | 'web',
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const limitNum = limit ? parseInt(limit, 10) : undefined;
    const attendedBool = attended === 'true' ? true : attended === 'false' ? false : undefined;
    const operationalStates = operationalStatesRaw
      ?.split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .filter(isOperationalStateParam);
    const assignedUserIds = assignedUserIdsRaw
      ?.split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const lastMessageFrom =
      lastMessageFromRaw !== undefined && lastMessageFromRaw !== ''
        ? parseInt(lastMessageFromRaw, 10)
        : undefined;
    const lastMessageTo =
      lastMessageToRaw !== undefined && lastMessageToRaw !== ''
        ? parseInt(lastMessageToRaw, 10)
        : undefined;
    const tagsAny = tagsAnyRaw
      ?.split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    return this.inboxService.listConversations({
      status,
      attended: attendedBool,
      priority,
      operationalStates:
        operationalStates && operationalStates.length > 0 ? operationalStates : undefined,
      assignedUserIds: assignedUserIds && assignedUserIds.length > 0 ? assignedUserIds : undefined,
      unassignedOnly: unassignedOnly === 'true' ? true : undefined,
      unreadOnly: unreadOnly === 'true' ? true : undefined,
      tagsAny: tagsAny && tagsAny.length > 0 ? tagsAny : undefined,
      lastMessageFrom: Number.isFinite(lastMessageFrom) ? lastMessageFrom : undefined,
      lastMessageTo: Number.isFinite(lastMessageTo) ? lastMessageTo : undefined,
      channel: channel === 'whatsapp' || channel === 'web' ? channel : undefined,
      limit: limitNum,
      cursor: cursor?.trim() || undefined,
    });
  }

  /**
   * Obtener mensajes de una conversación
   * GET /api/inbox/:conversationId/messages?limit=50
   */
  @Get(':conversationId/messages')
  async getMessages(
    @Param('conversationId') conversationId: string,
    @Query('limit') limit?: string,
    @Query('beforeCreatedAt') beforeCreatedAt?: string,
  ) {
    const limitNum = limit ? parseInt(limit, 10) : undefined;
    const beforeMs = beforeCreatedAt ? parseInt(beforeCreatedAt, 10) : undefined;
    return this.inboxService.getMessages(conversationId, {
      limit: limitNum,
      beforeCreatedAt: Number.isFinite(beforeMs) ? beforeMs : undefined,
    });
  }

  @Delete(':conversationId/messages/:messageId')
  async deleteMessage(@Param('messageId') messageId: string) {
    return this.inboxService.deleteMessage(messageId);
  }

  @Patch(':conversationId/messages/:messageId')
  async editMessage(
    @Param('messageId') messageId: string,
    @Body() body: { content?: string },
  ) {
    if (!body?.content?.trim()) {
      throw new BadRequestException('content requerido');
    }
    return this.inboxService.editMessage(messageId, body.content.trim());
  }

  @Post(':conversationId/messages/:messageId/forward')
  async forwardMessage(
    @Param('messageId') messageId: string,
    @Body() body: { targetConversationId?: string; sentByUserId?: string },
  ) {
    if (!body?.targetConversationId?.trim()) {
      throw new BadRequestException('targetConversationId requerido');
    }
    return this.inboxService.forwardMessage(
      messageId,
      body.targetConversationId.trim(),
      body.sentByUserId?.trim() || undefined,
    );
  }

  /**
   * Ficha CRM del contacto vinculado a la conversación (mismo contactId que WhatsApp).
   * GET /api/inbox/:conversationId/contact
   */
  @Get(':conversationId/contact')
  async getContactForConversation(@Param('conversationId') conversationId: string) {
    return this.inboxService.getContactForConversation(conversationId);
  }

  /**
   * Actualizar nombre, cédula/código, clasificación lead/cliente, etc.
   * PATCH /api/inbox/:conversationId/contact
   */
  @Patch(':conversationId/contact')
  async updateContactForConversation(
    @Param('conversationId') conversationId: string,
    @Body()
    body: {
      name?: string;
      cedula?: string;
      email?: string;
      city?: string;
      crmType?: 'lead' | 'client';
    },
  ) {
    if (body.crmType && !['lead', 'client'].includes(body.crmType)) {
      throw new BadRequestException('crmType debe ser lead o client');
    }
    return this.inboxService.updateContactForConversation(conversationId, body);
  }

  @Get('templates')
  async listTemplates() {
    return this.inboxService.listQuickReplyTemplates();
  }

  @Post('templates')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 16 * 1024 * 1024 },
    }),
  )
  async createTemplate(
    @Body() body: any,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.inboxService.createQuickReplyTemplate(body, file);
  }

  @Patch('templates/:templateId')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 16 * 1024 * 1024 },
    }),
  )
  async updateTemplate(
    @Param('templateId') templateId: string,
    @Body() body: any,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.inboxService.updateQuickReplyTemplate(templateId, body, file);
  }

  @Delete('templates/:templateId')
  async deleteTemplate(@Param('templateId') templateId: string) {
    return this.inboxService.deleteQuickReplyTemplate(templateId);
  }

  @Post(':conversationId/send-template/:templateId')
  async sendTemplateToConversation(
    @Param('conversationId') conversationId: string,
    @Param('templateId') templateId: string,
  ) {
    return this.inboxService.sendQuickTemplateToConversation(conversationId, templateId);
  }

  /**
   * Escalar: cambiar entre IA, humano o resuelto
   * PATCH /api/inbox/:conversationId/status
   * Body: { "status": "human", "userId": "<convex_user_id>" }
   */
  @Patch(':conversationId/status')
  async setStatus(
    @Param('conversationId') conversationId: string,
    @Body() body: { status: 'ai' | 'human' | 'resolved'; userId?: string },
  ) {
    if (!body?.status || !['ai', 'human', 'resolved'].includes(body.status)) {
      throw new BadRequestException('status debe ser ai, human o resolved');
    }
    return this.inboxService.setStatus(conversationId, body.status, body.userId);
  }

  /**
   * Clasificar prioridad
   * PATCH /api/inbox/:conversationId/priority
   * Body: { "priority": "urgent" } | "low" | "medium" | "resolved"
   */
  @Patch(':conversationId/priority')
  async setPriority(
    @Param('conversationId') conversationId: string,
    @Body() body: { priority: 'urgent' | 'low' | 'medium' | 'resolved' },
  ) {
    if (!body?.priority || !['urgent', 'low', 'medium', 'resolved'].includes(body.priority)) {
      throw new BadRequestException('priority debe ser urgent, low, medium o resolved');
    }
    return this.inboxService.setPriority(conversationId, body.priority);
  }

  /**
   * Estado operativo del embudo (etiqueta de asesor / pago / etc.)
   * PATCH /api/inbox/:conversationId/operational-state
   * Body: { "operationalState": "requires_advisor" }
   */
  @Patch(':conversationId/operational-state')
  async setOperationalState(
    @Param('conversationId') conversationId: string,
    @Body() body: { operationalState: string; userId?: string },
  ) {
    const allowed = [
      'requires_advisor',
      'validate_availability',
      'ready_to_book',
      'pending_payment',
      'pending_data',
    ] as const;
    if (!body?.operationalState || !allowed.includes(body.operationalState as (typeof allowed)[number])) {
      throw new BadRequestException(
        'operationalState debe ser: requires_advisor, validate_availability, ready_to_book, pending_payment, pending_data',
      );
    }
    return this.inboxService.setOperationalState(
      conversationId,
      body.operationalState as (typeof allowed)[number],
      body.userId,
    );
  }

  /**
   * Asignar o quitar asesor (Convex user _id).
   * PATCH /api/inbox/:conversationId/assigned-user
   * Body: { "assignedUserId": "<id>" | null, "actorUserId": "<convex_user_id>" }
   */
  @Patch(':conversationId/assigned-user')
  async setAssignedUser(
    @Param('conversationId') conversationId: string,
    @Body() body: { assignedUserId: string | null; actorUserId?: string },
  ) {
    if (!body || !('assignedUserId' in body)) {
      throw new BadRequestException('Body debe incluir assignedUserId (string o null)');
    }
    if (body.assignedUserId !== null && typeof body.assignedUserId !== 'string') {
      throw new BadRequestException('assignedUserId debe ser string o null');
    }
    return this.inboxService.setAssignedUser(conversationId, body.assignedUserId, body.actorUserId);
  }

  /**
   * Historial de auditoría de atención de una conversación
   * GET /api/inbox/:conversationId/audit-history
   */
  @Get(':conversationId/audit-history')
  async getAuditHistory(@Param('conversationId') conversationId: string) {
    return this.inboxService.getAuditHistory(conversationId);
  }

  /**
   * Enviar mensaje (texto o media)
   * POST /api/inbox/:conversationId/send
   * - Texto: Body JSON { "text": "...", "type": "text" }
   * - Media: Form-data con "file" y "type" (image|audio|document), opcional "text" como caption
   */
  @Post(':conversationId/send')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 16 * 1024 * 1024 }, // 16MB
    }),
  )
  async sendMessage(
    @Param('conversationId') conversationId: string,
    @Body('text') text?: string,
    @Body('type') type?: 'text' | 'image' | 'audio' | 'document' | 'product',
    @Body('mediaUrl') mediaUrl?: string,
    @Body('filename') filename?: string,
    @Body('metadata') metadata?: any,
    @Body('sentByUserId') sentByUserId?: string,
    @Body('replyToWamid') replyToWamid?: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const msgType = (type || (file ? this.inferTypeFromFile(file) : 'text'));

    let parsedMetadata = metadata;
    if (typeof metadata === 'string') {
      try {
        parsedMetadata = JSON.parse(metadata);
      } catch (e) {
        // Ignorar si no es JSON válido
      }
    }

    return this.inboxService.sendMessage(conversationId, {
      type: msgType,
      text: text?.trim() || undefined,
      mediaUrl: mediaUrl?.trim() || undefined,
      filename: filename?.trim() || undefined,
      metadata: parsedMetadata,
      file,
      sentByUserId: sentByUserId?.trim() || undefined,
      replyToWamid: replyToWamid?.trim() || undefined,
    });
  }
 
  /**
   * Obtener sugerencias de datos para el contrato basados en IA
   * GET /api/inbox/:conversationId/suggested-data
   */
  @Get(':conversationId/suggested-data')
  async getSuggestedData(
    @Param('conversationId') conversationId: string,
    @Query('forceFresh') forceFresh?: string,
  ) {
    return this.inboxService.getSuggestedContractData(
      conversationId,
      forceFresh === 'true',
    );
  }


  /**
   * Obtener sugerencias de reserva basadas en IA
   * GET /api/inbox/:conversationId/booking-data
   */
  @Get(':conversationId/booking-data')
  async getSuggestedBookingData(@Param('conversationId') conversationId: string) {
    return this.inboxService.getSuggestedBookingData(conversationId);
  }

  /**
   * Obtener datos precargados para la confirmacion de reserva.
   * GET /api/inbox/:conversationId/reservation-confirmation-data
   */
  @Get(':conversationId/reservation-confirmation-data')
  async getReservationConfirmationData(
    @Param('conversationId') conversationId: string,
  ) {
    return this.inboxService.getReservationConfirmationData(conversationId);
  }

  /**
   * Generar PDF de previsualizacion para confirmacion de reserva.
   * POST /api/inbox/:conversationId/reservation-confirmation-preview
   */
  @Post(':conversationId/reservation-confirmation-preview')
  async generateReservationConfirmationPreview(
    @Param('conversationId') conversationId: string,
    @Body() body: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.inboxService.generateReservationConfirmationPreview(
      conversationId,
      body,
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.filename}"`,
    );
    return new StreamableFile(result.buffer);
  }

  @Post(':conversationId/reservation-confirmation-send')
  async sendReservationConfirmation(
    @Param('conversationId') conversationId: string,
    @Body() body: any,
  ) {
    return this.inboxService.sendReservationConfirmation(conversationId, body);
  }

  /**
   * Crear reserva desde conversación y marcar como resuelta
   * POST /api/inbox/:conversationId/create-booking
   */
  @Post(':conversationId/create-booking')
  @UseInterceptors(
    FilesInterceptor('multimedia', 10, {
      storage: memoryStorage(),
      limits: { fileSize: 16 * 1024 * 1024 }, // 16MB per file
    }),
  )
  async createBookingFromConversation(
    @Param('conversationId') conversationId: string,
    @Body() body: any,
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    return this.inboxService.createBookingFromConversation({
      conversationId,
      ...body,
      multimediaFiles: files,
    });
  }

  /**
   * Marcar como atendida
   * PATCH /api/inbox/:conversationId/attended
   */
  @Patch(':conversationId/attended')
  async markAsAttended(@Param('conversationId') conversationId: string) {
    return this.inboxService.markAsAttended(conversationId);
  }

  /**
   * Marcar conversación como leída en inbox (reinicia contador de no leídos del cliente).
   * PATCH /api/inbox/:conversationId/read
   */
  @Patch(':conversationId/read')
  async markInboxRead(@Param('conversationId') conversationId: string) {
    return this.inboxService.markInboxRead(conversationId);
  }

  /**
   * Etiquetas de negocio (varias por conversación).
   * PATCH /api/inbox/:conversationId/tags
   */
  @Patch(':conversationId/tags')
  async setConversationTags(
    @Param('conversationId') conversationId: string,
    @Body() body: { tags?: string[] },
  ) {
    const tags = Array.isArray(body?.tags) ? body.tags : [];
    return this.inboxService.setConversationTags(conversationId, tags);
  }

  /**
   * Envía al cliente el link de autorrelleno de contrato por WhatsApp.
   * POST /api/inbox/:conversationId/send-contract-fill-link
   * Body opcional: { propertyTitle, propertyLocation, fechaEntrada, fechaSalida, cupo, precioTotal }
   */
  @Post(':conversationId/send-contract-fill-link')
  async sendContractFillLink(
    @Param('conversationId') conversationId: string,
    @Body()
    body?: {
      propertyTitle?: string;
      propertyLocation?: string;
      fechaEntrada?: string;
      fechaSalida?: string;
      cupo?: number;
      precioTotal?: number;
      sentByUserId?: string;
    },
  ) {
    return this.inboxService.sendContractFillLink(conversationId, body ?? {});
  }

  private inferTypeFromFile(file: Express.Multer.File): 'image' | 'audio' | 'document' {
    const mime = (file.mimetype || '').toLowerCase();
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('audio/') || mime.includes('audio')) return 'audio';
    return 'document';
  }
}
