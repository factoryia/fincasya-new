import {
  Controller,
  Get,
  Post,
  Patch,
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

@Controller('inbox')
@UseGuards(ConvexAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.ASSISTANT, UserRole.VENDEDOR)
export class InboxController {
  constructor(private readonly inboxService: InboxService) {}

  /**
   * Listar conversaciones (inbox)
   * GET /api/inbox?status=human&priority=urgent&limit=50
   */
  @Get()
  async list(
    @Query('status') status?: 'ai' | 'human' | 'resolved',
    @Query('attended') attended?: string,
    @Query('priority') priority?: 'urgent' | 'low' | 'medium' | 'resolved',
    @Query('limit') limit?: string,
  ) {
    const limitNum = limit ? parseInt(limit, 10) : undefined;
    const attendedBool = attended === 'true' ? true : attended === 'false' ? false : undefined;
    return this.inboxService.listConversations({ 
      status, 
      attended: attendedBool,
      priority, 
      limit: limitNum 
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
  ) {
    const limitNum = limit ? parseInt(limit, 10) : undefined;
    return this.inboxService.getMessages(conversationId, limitNum);
  }

  /**
   * Escalar: cambiar entre IA, humano o resuelto
   * PATCH /api/inbox/:conversationId/status
   * Body: { "status": "human" } | "ai" | "resolved"
   */
  @Patch(':conversationId/status')
  async setStatus(
    @Param('conversationId') conversationId: string,
    @Body() body: { status: 'ai' | 'human' | 'resolved' },
  ) {
    if (!body?.status || !['ai', 'human', 'resolved'].includes(body.status)) {
      throw new BadRequestException('status debe ser ai, human o resolved');
    }
    return this.inboxService.setStatus(conversationId, body.status);
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

  private inferTypeFromFile(file: Express.Multer.File): 'image' | 'audio' | 'document' {
    const mime = (file.mimetype || '').toLowerCase();
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('audio/') || mime.includes('audio')) return 'audio';
    return 'document';
  }
}
