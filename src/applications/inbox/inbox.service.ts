import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import sharp from 'sharp';
import { ConvexService } from '../shared/services/convex.service';
import { S3Service } from '../shared/services/s3.service';

@Injectable()
export class InboxService {
  constructor(
    private readonly convexService: ConvexService,
    private readonly s3Service: S3Service,
  ) {}

  async listConversations(params: {
    status?: 'ai' | 'human' | 'resolved';
    priority?: 'urgent' | 'low' | 'medium' | 'resolved';
    limit?: number;
  }) {
    return this.convexService.query('conversations:list', params);
  }

  async getMessages(conversationId: string, limit?: number) {
    return this.convexService.query('messages:listRecent', {
      conversationId,
      limit,
    });
  }

  async setStatus(conversationId: string, status: 'ai' | 'human' | 'resolved') {
    if (status === 'ai') {
      return this.convexService.mutation('conversations:setToAiPublic', {
        conversationId,
      });
    }
    if (status === 'human') {
      return this.convexService.mutation('conversations:escalateToHuman', {
        conversationId,
      });
    }
    if (status === 'resolved') {
      return this.convexService.mutation('conversations:resolveConversation', {
        conversationId,
      });
    }
    throw new BadRequestException('status debe ser ai, human o resolved');
  }

  async setPriority(
    conversationId: string,
    priority: 'urgent' | 'low' | 'medium' | 'resolved',
  ) {
    return this.convexService.mutation('conversations:setPriority', {
      conversationId,
      priority,
    });
  }

  async sendMessage(
    conversationId: string,
    params: {
      type: 'text' | 'image' | 'audio' | 'document';
      text?: string;
      mediaUrl?: string;
      file?: Express.Multer.File;
    },
  ) {
    const { type, text, mediaUrl, file } = params;
    if (type === 'text' && !text?.trim()) {
      throw new BadRequestException(
        'Texto requerido para mensaje de tipo text',
      );
    }
    if (type !== 'text' && !file && !mediaUrl?.trim()) {
      throw new BadRequestException(
        'Archivo o mediaUrl requerido para imagen/audio/documento',
      );
    }
    const conv = await this.convexService.query('conversations:getById', {
      conversationId,
    });
    if (!conv) throw new NotFoundException('Conversación no encontrada');
    const contact = await this.convexService.query('contacts:getById', {
      contactId: conv.contactId,
    });
    if (!contact) throw new NotFoundException('Contacto no encontrado');
    const phone = this.normalizePhoneE164(contact.phone);

    let finalMediaUrl = mediaUrl;
    let mediaUrlForStorage: string | undefined;
    let filename: string | undefined;
    if (file && type !== 'text') {
      let fileToUpload = file;
      if (type === 'image') {
        fileToUpload = await this.ensureImageCompatible(file);
      }
      const publicUrl = await this.s3Service.uploadFile(fileToUpload, 'inbox');
      filename = fileToUpload.originalname;
      mediaUrlForStorage = publicUrl;
      // URL pre-firmada para que Convex pueda descargar (bucket puede ser privado)
      const key = publicUrl.split('.com/')[1];
      finalMediaUrl = key
        ? await this.s3Service.getPresignedDownloadUrl(key)
        : publicUrl;
    }

    const result = await this.convexService.action('inbox:sendMessage', {
      conversationId,
      phone,
      type,
      text: text?.trim() || undefined,
      mediaUrl: finalMediaUrl,
      mediaUrlForStorage,
      filename,
    });
    return result ?? { ok: true };
  }

  /** Convierte WebP y otros formatos no soportados por WhatsApp a JPEG */
  private async ensureImageCompatible(
    file: Express.Multer.File,
  ): Promise<Express.Multer.File> {
    const mime = (file.mimetype || '').toLowerCase();
    if (['image/jpeg', 'image/png'].includes(mime)) {
      return file;
    }
    if (!file.buffer) {
      throw new BadRequestException('El archivo no tiene buffer en memoria');
    }
    try {
      const jpegBuffer = await sharp(file.buffer)
        .jpeg({ quality: 90 })
        .toBuffer();
      const baseName = (file.originalname || 'image').replace(/\.[^.]+$/, '');
      return {
        ...file,
        buffer: jpegBuffer,
        mimetype: 'image/jpeg',
        originalname: `${baseName}.jpg`,
      } as Express.Multer.File;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new BadRequestException(
        `No se pudo convertir la imagen a JPEG: ${msg}. Use JPEG o PNG.`,
      );
    }
  }

  private normalizePhoneE164(phone: string): string {
    let p = (phone || '').replace(/\D/g, '');
    if (p.startsWith('57') && p.length <= 12) {
      // Colombia: asegurar que tenga código país
    } else if (p.length === 10 && p.startsWith('3')) {
      p = '57' + p; // Colombia local
    }
    return p ? `+${p}` : phone;
  }
}
