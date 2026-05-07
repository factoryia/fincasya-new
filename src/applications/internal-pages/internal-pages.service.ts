import { Injectable, BadRequestException } from '@nestjs/common';
import { ConvexService } from '../shared/services/convex.service';
import { S3Service } from '../shared/services/s3.service';
import {
  DEFAULT_CONSULTANT_SYSTEM_PROMPT,
  PROMPT_INTERNAL_PAGE_ID,
} from '../../lib/consultantPrompt';

@Injectable()
export class InternalPagesService {
  constructor(
    private readonly convexService: ConvexService,
    private readonly s3Service: S3Service,
  ) {}

  async get(pageId: string) {
    try {
      return await this.convexService.query('internalPages:getById', { pageId });
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  /**
   * Registra en Convex el mensaje del asistente ya enviado por n8n/YCloud (inbox).
   */
  async logOutboundAssistantMessage(body: {
    phone: string;
    customerName?: string;
    content: string;
    messageType?: 'text' | 'product';
    metadata?: unknown;
  }) {
    try {
      return await this.convexService.mutation(
        'n8nIntegration:logOutboundAssistantMessage',
        {
          phone: String(body.phone ?? '').trim(),
          ...(body.customerName != null && String(body.customerName).trim()
            ? { customerName: String(body.customerName).trim() }
            : {}),
          content: String(body.content ?? '').trim(),
          ...(body.messageType ? { messageType: body.messageType } : {}),
          ...(body.metadata != null ? { metadata: body.metadata } : {}),
        },
      );
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /** Mensaje entrante del cliente (texto/imagen/audio…) vía n8n → Convex `messages` como sender user. */
  async logInboundUserMessage(body: {
    phone: string;
    customerName?: string;
    content: string;
    messageType: string;
    mediaUrl?: string;
    metadata?: unknown;
  }) {
    try {
      return await this.convexService.mutation(
        'n8nIntegration:logInboundUserMessage',
        {
          phone: String(body.phone ?? '').trim(),
          ...(body.customerName != null && String(body.customerName).trim()
            ? { customerName: String(body.customerName).trim() }
            : {}),
          content: String(body.content ?? '').trim(),
          messageType: String(body.messageType ?? 'text').trim() || 'text',
          ...(body.mediaUrl != null && String(body.mediaUrl).trim()
            ? { mediaUrl: String(body.mediaUrl).trim() }
            : {}),
          ...(body.metadata != null ? { metadata: body.metadata } : {}),
        },
      );
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async getN8nBotReplyAllowed(phone: string) {
    try {
      return await this.convexService.query('n8nIntegration:getN8nBotReplyAllowed', {
        phone: String(phone ?? '').trim(),
      });
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async markOutboundHumanFromN8n(phone: string) {
    try {
      return await this.convexService.mutation('n8nIntegration:markOutboundHumanFromN8n', {
        phone: String(phone ?? '').trim(),
      });
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async resumeAiByPhoneFromN8n(phone: string) {
    try {
      return await this.convexService.mutation('n8nIntegration:resumeAiByPhoneFromN8n', {
        phone: String(phone ?? '').trim(),
      });
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /**
   * @param opts.source
   * - `effective` (default): igual que el bot en Convex — prompt personalizado en internalPages si existe, si no el default del repo.
   * - `file`: siempre el default empaquetado (`DEFAULT_CONSULTANT_SYSTEM_PROMPT` desde consultantPrompt.ts), útil para n8n cuando quieres ignorar un borrador corto en BD.
   */
  async getConsultantPrompt(opts?: { source?: 'effective' | 'file' }) {
    try {
      const source = opts?.source === 'file' ? 'file' : 'effective';

      if (source === 'file') {
        return {
          pageId: PROMPT_INTERNAL_PAGE_ID,
          prompt: DEFAULT_CONSULTANT_SYSTEM_PROMPT,
          defaultPrompt: DEFAULT_CONSULTANT_SYSTEM_PROMPT,
          isCustomized: false,
          promptOrigin: 'consultantPrompt.ts' as const,
          updatedAt: null,
        };
      }

      const data = await this.convexService.query('internalPages:getById', {
        pageId: PROMPT_INTERNAL_PAGE_ID,
      });
      const customPrompt =
        data && typeof data.prompt === 'string' ? data.prompt : '';
      const trimmed = customPrompt.trim();

      return {
        pageId: PROMPT_INTERNAL_PAGE_ID,
        prompt:
          trimmed.length > 0 ? customPrompt : DEFAULT_CONSULTANT_SYSTEM_PROMPT,
        defaultPrompt: DEFAULT_CONSULTANT_SYSTEM_PROMPT,
        isCustomized: trimmed.length > 0,
        promptOrigin:
          trimmed.length > 0
            ? ('convex_internal_page' as const)
            : ('consultantPrompt.ts' as const),
        updatedAt:
          data && typeof data.updatedAt === 'number' ? data.updatedAt : null,
      };
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async updateConsultantPrompt(prompt: string) {
    try {
      const cleanPrompt = String(prompt ?? '').trim();
      if (!cleanPrompt) {
        throw new BadRequestException('El prompt no puede estar vacío');
      }

      const content = {
        prompt: cleanPrompt,
        updatedAt: Date.now(),
      };

      await this.convexService.mutation('internalPages:upsert', {
        pageId: PROMPT_INTERNAL_PAGE_ID,
        content,
      });

      return {
        pageId: PROMPT_INTERNAL_PAGE_ID,
        prompt: cleanPrompt,
        defaultPrompt: DEFAULT_CONSULTANT_SYSTEM_PROMPT,
        isCustomized: true,
        updatedAt: content.updatedAt,
      };
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async resetConsultantPrompt() {
    try {
      await this.convexService.mutation('internalPages:removeById', {
        pageId: PROMPT_INTERNAL_PAGE_ID,
      });

      return {
        pageId: PROMPT_INTERNAL_PAGE_ID,
        prompt: DEFAULT_CONSULTANT_SYSTEM_PROMPT,
        defaultPrompt: DEFAULT_CONSULTANT_SYSTEM_PROMPT,
        isCustomized: false,
        updatedAt: null,
      };
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async update(pageId: string, content: any) {
    try {
      return await this.convexService.mutation('internalPages:upsert', {
        pageId,
        content,
      });
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async uploadImages(files: Express.Multer.File[]) {
    try {
      if (!files || files.length === 0) return [];
      return await this.s3Service.uploadImages(files);
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }
}
