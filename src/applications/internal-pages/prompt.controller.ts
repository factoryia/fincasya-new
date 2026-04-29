import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../shared/guards/admin.guard';
import { ConvexAuthGuard } from '../shared/guards/convex-auth.guard';
import { InternalPagesService } from './internal-pages.service';

@Controller('prompt')
@UseGuards(ConvexAuthGuard, AdminGuard)
export class PromptController {
  constructor(private readonly internalPagesService: InternalPagesService) {}

  @Get()
  async getPrompt() {
    return await this.internalPagesService.getConsultantPrompt();
  }

  @Patch()
  async updatePrompt(@Body() body: { prompt?: string }) {
    return await this.internalPagesService.updateConsultantPrompt(
      body?.prompt ?? '',
    );
  }

  @Delete()
  async resetPrompt() {
    return await this.internalPagesService.resetConsultantPrompt();
  }
}
