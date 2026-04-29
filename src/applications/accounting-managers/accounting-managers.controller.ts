import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { AccountingManagersService } from './accounting-managers.service';
import { ConvexAuthGuard } from '../shared/guards/convex-auth.guard';
import { AdminGuard } from '../shared/guards/admin.guard';

@Controller('accounting-managers')
export class AccountingManagersController {
  constructor(private readonly managersService: AccountingManagersService) {}

  @Get()
  async list() {
    return this.managersService.list();
  }

  @Get(':id')
  async getById(@Param('id') id: string) {
    return this.managersService.getById(id);
  }

  @Post()
  @UseGuards(ConvexAuthGuard, AdminGuard)
  async create(@Body() payload: any) {
    return this.managersService.create(payload);
  }

  @Patch(':id')
  @UseGuards(ConvexAuthGuard, AdminGuard)
  async update(@Param('id') id: string, @Body() payload: any) {
    return this.managersService.update(id, payload);
  }

  @Delete(':id')
  @UseGuards(ConvexAuthGuard, AdminGuard)
  async remove(@Param('id') id: string) {
    return this.managersService.remove(id);
  }
}
