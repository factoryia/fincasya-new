import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ConvexService } from '../shared/services/convex.service';

@Injectable()
export class AccountingManagersService {
  constructor(private readonly convexService: ConvexService) {}

  async list() {
    try {
      return await this.convexService.query('accountingManagers:list', {});
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async getById(id: string) {
    try {
      const manager = await this.convexService.query('accountingManagers:getById', { id });
      if (!manager) {
        throw new NotFoundException('Encargado no encontrado');
      }
      return manager;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException(error.message);
    }
  }

  async create(payload: any) {
    try {
      return await this.convexService.mutation('accountingManagers:create', payload);
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async update(id: string, payload: any) {
    try {
      return await this.convexService.mutation('accountingManagers:update', {
        id,
        ...payload,
      });
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async remove(id: string) {
    try {
      return await this.convexService.mutation('accountingManagers:remove', { id });
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }
}
