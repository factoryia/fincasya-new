import { Injectable, BadRequestException } from '@nestjs/common';
import { ConvexService } from '../shared/services/convex.service';
import { S3Service } from '../shared/services/s3.service';

@Injectable()
export class QuienesSomosService {
  constructor(
    private readonly convexService: ConvexService,
    private readonly s3Service: S3Service,
  ) {}

  async get() {
    try {
      return await this.convexService.query('quienes_somos:get', {});
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async update(data: any) {
    try {
      // Fallback sanitization for legacy HTML strings fragmented by useFieldArray
      const sanitizeArray = (arr: any[]) => {
        if (!Array.isArray(arr)) return [];
        // Detect if useFieldArray split a string into single characters
        if (arr.length > 0 && arr.every(item => typeof item === 'string' && item.length === 1)) {
          const joined = arr.join('');
          if (joined.startsWith('<')) return [];
          return [joined];
        }
        return arr;
      };

      if (data.objetivos) data.objetivos = sanitizeArray(data.objetivos);
      if (data.politicas) data.politicas = sanitizeArray(data.politicas);

      return await this.convexService.mutation('quienes_somos:update', data);
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async uploadImages(files: Express.Multer.File[]) {
    try {
      if (!files || files.length === 0) return [];
      const imageUrls = await this.s3Service.uploadImages(files);
      return imageUrls;
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }
}
