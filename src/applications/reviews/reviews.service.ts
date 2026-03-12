import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ConvexService } from '../shared/services/convex.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';

@Injectable()
export class ReviewsService {
  constructor(private readonly convexService: ConvexService) {}

  async listByProperty(propertyId: string, limit?: number) {
    try {
      const args: any = { propertyId };
      if (limit !== undefined && limit !== null) args.limit = Number(limit);

      return await this.convexService.query('reviews:list', args);
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async getById(id: string) {
    try {
      const review = await this.convexService.query('reviews:getById', { id });
      if (!review) {
        throw new NotFoundException('Reseña no encontrada');
      }
      return review;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException(error.message);
    }
  }

  async create(createDto: CreateReviewDto) {
    try {
      // Destructuramos para asegurar que pasamos un objeto plano a Convex
      // y no una instancia de clase de la DTO (que puede causar errores de serialización)
      return await this.convexService.mutation('reviews:create', {
        ...createDto,
      });
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async update(id: string, updateDto: UpdateReviewDto) {
    try {
      return await this.convexService.mutation('reviews:update', {
        id,
        ...updateDto,
      });
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async remove(id: string) {
    try {
      return await this.convexService.mutation('reviews:remove', { id });
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }
}
