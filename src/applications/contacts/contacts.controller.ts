import {
  Controller,
  Get,
  Patch,
  Query,
  Param,
  Body,
  UseGuards,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ContactsService } from './contacts.service';
import { ConvexAuthGuard } from '../shared/guards/convex-auth.guard';
import { AdminGuard } from '../shared/guards/admin.guard';

@Controller('contacts')
@UseGuards(ConvexAuthGuard, AdminGuard)
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  @Get()
  async list(@Query('search') search?: string, @Query('limit') limit?: string) {
    const limitNum = limit ? parseInt(limit, 10) : undefined;
    return this.contactsService.list(search, limitNum);
  }

  @Get('export/excel')
  async exportExcel(
    @Query('search') search?: string,
    @Query('scope') scope?: 'todos' | 'clientes' | 'leads',
    @Res() res?: Response,
  ) {
    const exportScope = scope ?? 'todos';
    const { buffer, filename } = await this.contactsService.exportExcel(
      search,
      exportScope,
    );
    res!.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res!.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res!.send(buffer);
  }

  @Get(':id')
  async getById(@Param('id') id: string) {
    return this.contactsService.getById(id);
  }

  @Get(':id/history')
  async getWithHistory(@Param('id') id: string) {
    return this.contactsService.getWithHistory(id);
  }

  @Patch(':id/tags')
  async setTags(@Param('id') id: string, @Body() body: { tags?: string[] }) {
    return this.contactsService.setTags(id, body?.tags ?? []);
  }
}
