import {
  Controller,
  Delete,
  Get,
  Post,
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

  @Get('crm/list')
  async listForCrm(
    @Query('search') search?: string,
    @Query('streakFilter') streakFilter?: string,
    @Query('birthdayMonth') birthdayMonth?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('limit') limit?: string,
  ) {
    return this.contactsService.listForCrm({
      search,
      streakFilter: streakFilter || undefined,
      birthdayMonth: birthdayMonth === 'true' ? true : undefined,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize
        ? parseInt(pageSize, 10)
        : limit
          ? parseInt(limit, 10)
          : undefined,
    });
  }

  @Get('pipeline/deals')
  async listPipelineDeals(
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    return this.contactsService.listPipelineDeals(
      status,
      limit ? parseInt(limit, 10) : undefined,
    );
  }

  @Get('pipeline/stats')
  async getPipelineStats() {
    return this.contactsService.getPipelineStats();
  }

  @Get('broadcast/templates')
  async listBroadcastTemplates() {
    return this.contactsService.listBroadcastTemplates();
  }

  @Post('broadcast/check-eligible')
  async checkEligible(@Body() body: { contactIds?: string[] }) {
    return this.contactsService.checkEligibleContacts(body?.contactIds ?? []);
  }

  @Post('broadcast/send')
  async sendBroadcast(
    @Body()
    body: {
      contactIds?: string[];
      templateKey?: string;
      bodyParams?: string[];
      sentByUserId?: string;
      logToInbox?: boolean;
    },
  ) {
    return this.contactsService.sendBroadcast({
      contactIds: body?.contactIds ?? [],
      templateKey: body?.templateKey ?? '',
      bodyParams: body?.bodyParams,
      sentByUserId: body?.sentByUserId,
      logToInbox: body?.logToInbox,
    });
  }

  @Get('broadcast/history')
  async listBroadcasts(@Query('limit') limit?: string) {
    const limitNum = limit ? parseInt(limit, 10) : undefined;
    return this.contactsService.listBroadcasts(limitNum);
  }

  @Get(':id')
  async getById(@Param('id') id: string) {
    return this.contactsService.getById(id);
  }

  @Get(':id/history')
  async getWithHistory(@Param('id') id: string) {
    return this.contactsService.getWithHistory(id);
  }

  @Get(':id/timeline')
  async getTimeline(
    @Param('id') id: string,
    @Query('limit') limit?: string,
  ) {
    return this.contactsService.getTimeline(
      id,
      limit ? parseInt(limit, 10) : undefined,
    );
  }

  @Get(':id/profile')
  async getProfile(@Param('id') id: string) {
    return this.contactsService.getProfile(id);
  }

  @Get(':id/notes')
  async listNotes(@Param('id') id: string) {
    return this.contactsService.listNotes(id);
  }

  @Post(':id/notes')
  async createNote(
    @Param('id') id: string,
    @Body() body: { content?: string; authorUserId?: string; authorName?: string },
  ) {
    return this.contactsService.createNote(id, {
      content: body?.content ?? '',
      authorUserId: body?.authorUserId,
      authorName: body?.authorName,
    });
  }

  @Patch('notes/:noteId')
  async updateNote(
    @Param('noteId') noteId: string,
    @Body() body: { content?: string },
  ) {
    return this.contactsService.updateNote(noteId, body?.content ?? '');
  }

  @Delete('notes/:noteId')
  async deleteNote(@Param('noteId') noteId: string) {
    return this.contactsService.deleteNote(noteId);
  }

  @Patch(':id/tags')
  async setTags(@Param('id') id: string, @Body() body: { tags?: string[] }) {
    return this.contactsService.setTags(id, body?.tags ?? []);
  }

  @Patch(':id')
  async updateContact(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      cedula?: string;
      email?: string;
      city?: string;
      address?: string;
      fechaNacimiento?: string;
      crmType?: 'lead' | 'client';
    },
  ) {
    return this.contactsService.updateContact(id, body);
  }

  @Delete(':id')
  async deleteContact(@Param('id') id: string) {
    return this.contactsService.deleteContact(id);
  }
}
