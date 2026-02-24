import { Injectable, BadRequestException } from '@nestjs/common';
import { ConvexService } from '../shared/services/convex.service';

@Injectable()
export class CatalogsService {
  constructor(private readonly convexService: ConvexService) {}

  async list() {
    try {
      return await this.convexService.query('whatsappCatalogs:list', {});
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }
}
