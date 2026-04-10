import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { InternalPagesService } from './internal-pages.service';
import { ConvexAuthGuard } from '../shared/guards/convex-auth.guard';
import { AdminGuard } from '../shared/guards/admin.guard';

@Controller('como-funciona')
export class ComoFuncionaController {
  constructor(private readonly internalPagesService: InternalPagesService) {}

  @Get()
  async get() {
    return await this.internalPagesService.get('como-funciona');
  }

  @Patch()
  @UseGuards(ConvexAuthGuard, AdminGuard)
  async update(@Body() body: any) {
    return await this.internalPagesService.update('como-funciona', body);
  }
}

