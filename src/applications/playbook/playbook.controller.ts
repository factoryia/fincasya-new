import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ConvexSiteProxyService } from '../shared/services/convex-site-proxy.service';

/**
 * Proxea `/api/playbook/*` → Convex HTTP (mismo patrón que Knowledge).
 * Necesario mientras el frontend en prod reescribe rutas desconocidas al Nest
 * (`next.config.ts` fallback). Cuando FincasYaWeb despliegue sus route handlers
 * locales, estas rutas quedan como respaldo.
 */
@Controller('playbook')
export class PlaybookController {
  constructor(private readonly convexProxy: ConvexSiteProxyService) {}

  @Get('list')
  async list() {
    return this.convexProxy.forwardJson('GET', '/api/playbook/list');
  }

  @Get('conversations')
  async conversations(
    @Query('search') search?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('numItems') numItems?: string,
  ) {
    const qs = new URLSearchParams();
    if (search) qs.set('search', search);
    if (cursor) qs.set('cursor', cursor);
    qs.set('numItems', numItems ?? limit ?? '25');
    const q = qs.toString();
    return this.convexProxy.forwardJson(
      'GET',
      `/api/playbook/conversations${q ? `?${q}` : ''}`,
    );
  }

  @Get('conversation')
  async conversation(@Query('conversationId') conversationId?: string) {
    const qs = new URLSearchParams({
      conversationId: conversationId ?? '',
    });
    return this.convexProxy.forwardJson(
      'GET',
      `/api/playbook/conversation?${qs.toString()}`,
    );
  }

  @Post('upsert')
  async upsert(@Body() body: Record<string, unknown>) {
    return this.convexProxy.forwardJson('POST', '/api/playbook/upsert', body);
  }

  @Post('delete')
  async delete(@Body() body: Record<string, unknown>) {
    return this.convexProxy.forwardJson('POST', '/api/playbook/delete', body);
  }

  @Post('enabled')
  async enabled(@Body() body: Record<string, unknown>) {
    return this.convexProxy.forwardJson('POST', '/api/playbook/enabled', body);
  }

  @Post('analyze')
  async analyze(@Body() body: Record<string, unknown>) {
    return this.convexProxy.forwardJson('POST', '/api/playbook/analyze', body);
  }

  @Post('sync')
  async sync() {
    return this.convexProxy.forwardJson('POST', '/api/playbook/sync');
  }

  @Post('seed')
  async seed() {
    return this.convexProxy.forwardJson('POST', '/api/playbook/seed');
  }
}
