import { Injectable, BadRequestException } from '@nestjs/common';
import { ConvexService } from '../shared/services/convex.service';
import { S3Service } from '../shared/services/s3.service';

@Injectable()
export class InternalPagesService {
  constructor(
    private readonly convexService: ConvexService,
    private readonly s3Service: S3Service,
  ) {}

  async get(pageId: string) {
    try {
      return await this.convexService.query('internalPages:getById', { pageId });
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async update(pageId: string, content: any) {
    try {
      return await this.convexService.mutation('internalPages:upsert', {
        pageId,
        content,
      });
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async uploadImages(files: Express.Multer.File[]) {
    try {
      if (!files || files.length === 0) return [];
      return await this.s3Service.uploadImages(files);
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }
}
