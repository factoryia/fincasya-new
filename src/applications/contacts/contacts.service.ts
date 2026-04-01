import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConvexService } from '../shared/services/convex.service';

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
}
