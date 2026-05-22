import { Body, Controller, Get, Post } from '@nestjs/common';
import { ConvexSiteProxyService } from '../shared/services/convex-site-proxy.service';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly convexProxy: ConvexSiteProxyService) {}

  @Post('page-view')
  async recordPageView(@Body() body: { path?: string }) {
    return this.convexProxy.forwardJson('POST', '/api/analytics/page-view', body);
  }

  @Get('stats')
  async getStats() {
    return this.convexProxy.forwardJson('GET', '/api/analytics/stats');
  }
}
