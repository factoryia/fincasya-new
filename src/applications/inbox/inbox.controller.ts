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
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
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
    @Query('priority') priority?: 'urgent' | 'low' | 'medium' | 'resolved',
    @Query('limit') limit?: string,
  ) {
    const limitNum = limit ? parseInt(limit, 10) : undefined;
    return this.inboxService.listConversations({ status, priority, limit: limitNum });
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
    @Body('type') type?: 'text' | 'image' | 'audio' | 'document',
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const msgType = (type || (file ? this.inferTypeFromFile(file) : 'text'));

    return this.inboxService.sendMessage(conversationId, {
      type: msgType,
      text: text?.trim() || undefined,
      file,
    });
  }
 
  /**
   * Obtener sugerencias de datos para el contrato basados en IA
   * GET /api/inbox/:conversationId/suggested-data
   */
  @Get(':conversationId/suggested-data')
  async getSuggestedData(@Param('conversationId') conversationId: string) {
    return this.inboxService.getSuggestedContractData(conversationId);
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

  private inferTypeFromFile(file: Express.Multer.File): 'image' | 'audio' | 'document' {
    const mime = (file.mimetype || '').toLowerCase();
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('audio/') || mime.includes('audio')) return 'audio';
    return 'document';
  }
}
