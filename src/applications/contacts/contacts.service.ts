import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConvexService } from '../shared/services/convex.service';
import {
  buildContactsExcelBuffer,
  buildContactsExportFilename,
} from './contacts-export';

@Injectable()
export class ContactsService {
  constructor(private readonly convexService: ConvexService) {}

  async list(search?: string, limit?: number) {
    try {
      return await this.convexService.query('contacts:list', { search, limit });
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async exportExcel(
    search?: string,
    scope: 'todos' | 'clientes' | 'leads' = 'todos',
  ) {
    const contacts = await this.list(search, 10_000);
    return {
      buffer: buildContactsExcelBuffer(contacts, scope),
      filename: buildContactsExportFilename(scope, search),
    };
  }

  async getById(id: string) {
    try {
      const contact = await this.convexService.query('contacts:getById', { contactId: id });
      if (!contact) throw new NotFoundException('Contacto no encontrado');
      return contact;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException(error.message);
    }
  }

  async getWithHistory(id: string) {
    try {
      const history = await this.convexService.query('contacts:getWithHistory', { contactId: id });
      if (!history) throw new NotFoundException('Contacto no encontrado');
      return history;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException(error.message);
    }
  }

  async setTags(id: string, tags: string[]) {
    try {
      return await this.convexService.mutation('contacts:setTagsForContact', {
        contactId: id,
        tags: Array.isArray(tags) ? tags : [],
      });
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }
}
