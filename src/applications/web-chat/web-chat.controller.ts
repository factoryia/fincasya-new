import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ConvexSiteProxyService } from '../shared/services/convex-site-proxy.service';

/**
 * En producción, fincasya.com reescribe `/api/*` sin handler en Next hacia Nest.
 * Estas rutas proxean a Convex HTTP (`convex/http.ts`).
 */
@Controller('web-chat')
export class WebChatController {
  constructor(private readonly convexProxy: ConvexSiteProxyService) {}

  @Get('messages')
  async listMessages(
    @Query('sessionId') sessionId: string,
    @Query('since') since?: string,
    @Query('limit') limit?: string,
  ) {
    const qs = new URLSearchParams();
    if (sessionId) qs.set('sessionId', sessionId);
    if (since) qs.set('since', since);
    if (limit) qs.set('limit', limit);
    const q = qs.toString();
    return this.convexProxy.forwardJson(
      'GET',
      `/api/web-chat/messages${q ? `?${q}` : ''}`,
    );
  }

  @Post('send')
  async sendMessage(
    @Body() body: { sessionId?: string; text?: string; displayName?: string },
  ) {
    return this.convexProxy.forwardJson('POST', '/api/web-chat/send', body);
  }
}
