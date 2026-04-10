import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { InternalPagesService } from './internal-pages.service';
import { ConvexAuthGuard } from '../shared/guards/convex-auth.guard';
import { AdminGuard } from '../shared/guards/admin.guard';

@Controller('legal-pages')
export class LegalPagesController {
  constructor(private readonly internalPagesService: InternalPagesService) {}

  @Get(':pageId')
  async get(@Param('pageId') pageId: string) {
    return await this.internalPagesService.get(pageId);
  }

  @Patch(':pageId')
  @UseGuards(ConvexAuthGuard, AdminGuard)
  async update(@Param('pageId') pageId: string, @Body() body: any) {
    return await this.internalPagesService.update(pageId, body);
  }
}

