import { Controller, Get, Query, Param, UseGuards } from '@nestjs/common';
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

  @Get(':id')
  async getById(@Param('id') id: string) {
    return this.contactsService.getById(id);
  }

  @Get(':id/history')
  async getWithHistory(@Param('id') id: string) {
    return this.contactsService.getWithHistory(id);
  }
}
