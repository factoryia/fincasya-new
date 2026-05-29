import {
  Body,
  Controller,
  Get,
  Headers,
  Ip,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { HabeasDataService } from './habeas-data.service';
import { CreateHabeasDataDto } from './dto/create-habeas-data.dto';
import { UpdateHabeasDataStatusDto } from './dto/update-habeas-data-status.dto';
import { ConvexAuthGuard } from '../shared/guards/convex-auth.guard';
import { AdminGuard } from '../shared/guards/admin.guard';

@Controller('habeas-data')
export class HabeasDataController {
  constructor(private readonly habeasDataService: HabeasDataService) {}

  /**
   * Endpoint PÚBLICO. Cualquier titular puede crear una solicitud.
   * El IP/UA se guardan para auditoría (Ley 1581 — trazabilidad).
   */
  @Post()
  async create(
    @Body() dto: CreateHabeasDataDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.habeasDataService.create(dto, {
      ipAddress: ip,
      userAgent,
    });
  }

  /**
   * Endpoints ADMIN — listar, ver detalle, cambiar estado.
   * Protegidos por ConvexAuthGuard + AdminGuard como el resto del admin.
   */

  @Get()
  @UseGuards(ConvexAuthGuard, AdminGuard)
  list(@Query('status') status?: string, @Query('limit') limit?: number) {
    return this.habeasDataService.list(status, limit);
  }

  @Get('count-pending')
  @UseGuards(ConvexAuthGuard, AdminGuard)
  countPending() {
    return this.habeasDataService.countPending();
  }

  @Get(':id')
  @UseGuards(ConvexAuthGuard, AdminGuard)
  getById(@Param('id') id: string) {
    return this.habeasDataService.getById(id);
  }

  @Patch(':id/status')
  @UseGuards(ConvexAuthGuard, AdminGuard)
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateHabeasDataStatusDto,
  ) {
    return this.habeasDataService.updateStatus(id, dto);
  }
}
