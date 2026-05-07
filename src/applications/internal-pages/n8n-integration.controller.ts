import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { InternalPagesService } from './internal-pages.service';
import { N8nIntegrationGuard } from './n8n-integration.guard';

/**
 * Endpoints para automatizaciones externas (n8n) sin sesión de admin.
 */
@Controller('integrations/n8n')
@UseGuards(N8nIntegrationGuard)
export class N8nIntegrationController {
  constructor(private readonly internalPagesService: InternalPagesService) {}

  /**
   * Guardar en BD el texto que n8n ya mandó por YCloud (después del nodo HTTP de envío).
   * Opcional: antes en n8n puedes pasar el texto por un modelo pequeño y mandar aquí solo el resumen.
   */
  @Post('log-outbound-assistant')
  async logOutboundAssistant(
    @Body()
    body: {
      phone: string;
      customerName?: string;
      content: string;
      messageType?: 'text' | 'product';
      metadata?: unknown;
    },
  ) {
    if (!String(body?.phone ?? '').trim()) {
      throw new BadRequestException('phone es requerido');
    }
    if (!String(body?.content ?? '').trim()) {
      throw new BadRequestException('content es requerido');
    }
    return this.internalPagesService.logOutboundAssistantMessage(body);
  }

  /**
   * Guardar mensaje **entrante** del cliente (misma conversación que el bot Convex).
   * Llamar desde n8n justo después de Parse YCloud Event (texto, imagen, audio, video, documento, pedido catálogo).
   */
  @Post('log-inbound-user')
  async logInboundUser(
    @Body()
    body: {
      phone: string;
      customerName?: string;
      content: string;
      messageType: string;
      mediaUrl?: string;
      metadata?: unknown;
    },
  ) {
    if (!String(body?.phone ?? '').trim()) {
      throw new BadRequestException('phone es requerido');
    }
    if (!String(body?.content ?? '').trim()) {
      throw new BadRequestException('content es requerido');
    }
    if (!String(body?.messageType ?? '').trim()) {
      throw new BadRequestException('messageType es requerido');
    }
    return this.internalPagesService.logInboundUserMessage(body);
  }

  /**
   * ¿Puede el flujo n8n contestar con IA? `false` si la conversación en Convex está en modo humano.
   */
  @Get('should-bot-reply')
  async shouldBotReply(@Query('phone') phone: string) {
    if (!String(phone ?? '').trim()) {
      throw new BadRequestException('phone es requerido');
    }
    return this.internalPagesService.getN8nBotReplyAllowed(phone);
  }

  /**
   * Marcar conversación como atendida por humano (mensaje saliente YCloud / WhatsApp Business).
   * Llamar desde n8n cuando `body.type === whatsapp.outbound_message.sent`.
   */
  @Post('mark-outbound-human')
  async markOutboundHuman(@Body() body: { phone: string }) {
    if (!String(body?.phone ?? '').trim()) {
      throw new BadRequestException('phone es requerido');
    }
    return this.internalPagesService.markOutboundHumanFromN8n(body.phone);
  }

  /** Volver la conversación a modo IA (opcional: comando interno o segunda automatización). */
  @Post('resume-ai')
  async resumeAi(@Body() body: { phone: string }) {
    if (!String(body?.phone ?? '').trim()) {
      throw new BadRequestException('phone es requerido');
    }
    return this.internalPagesService.resumeAiByPhoneFromN8n(body.phone);
  }

  /**
   * Prompt del consultor para automatizaciones.
   *
   * Query `source`:
   * - omitido o `effective`: igual que Convex — custom en admin (internal page) o default del repo.
   * - `file`: siempre el default empaquetado en consultantPrompt.ts (ignora custom en BD).
   */
  @Get('consultant-prompt')
  async consultantPrompt(@Query('source') source?: string) {
    const normalized =
      String(source || '')
        .trim()
        .toLowerCase() === 'file'
        ? 'file'
        : 'effective';
    const data = await this.internalPagesService.getConsultantPrompt({
      source: normalized,
    });
    return {
      pageId: data.pageId,
      isCustomized: data.isCustomized,
      prompt: data.prompt,
      promptOrigin: data.promptOrigin,
    };
  }
}
