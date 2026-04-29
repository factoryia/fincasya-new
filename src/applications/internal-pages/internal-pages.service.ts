import { Injectable, BadRequestException } from '@nestjs/common';
import { ConvexService } from '../shared/services/convex.service';
import { S3Service } from '../shared/services/s3.service';
import {
  DEFAULT_CONSULTANT_SYSTEM_PROMPT,
  PROMPT_INTERNAL_PAGE_ID,
} from '../../../convex/lib/consultantPrompt';

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

  async getConsultantPrompt() {
    try {
      const data = await this.convexService.query('internalPages:getById', {
        pageId: PROMPT_INTERNAL_PAGE_ID,
      });
      const customPrompt =
        data && typeof data.prompt === 'string' ? data.prompt : '';

      return {
        pageId: PROMPT_INTERNAL_PAGE_ID,
        prompt:
          customPrompt.trim().length > 0
            ? customPrompt
            : DEFAULT_CONSULTANT_SYSTEM_PROMPT,
        defaultPrompt: DEFAULT_CONSULTANT_SYSTEM_PROMPT,
        isCustomized: customPrompt.trim().length > 0,
        updatedAt:
          data && typeof data.updatedAt === 'number' ? data.updatedAt : null,
      };
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async updateConsultantPrompt(prompt: string) {
    try {
      const cleanPrompt = String(prompt ?? '').trim();
      if (!cleanPrompt) {
        throw new BadRequestException('El prompt no puede estar vacío');
      }

      const content = {
        prompt: cleanPrompt,
        updatedAt: Date.now(),
      };

      await this.convexService.mutation('internalPages:upsert', {
        pageId: PROMPT_INTERNAL_PAGE_ID,
        content,
      });

      return {
        pageId: PROMPT_INTERNAL_PAGE_ID,
        prompt: cleanPrompt,
        defaultPrompt: DEFAULT_CONSULTANT_SYSTEM_PROMPT,
        isCustomized: true,
        updatedAt: content.updatedAt,
      };
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async resetConsultantPrompt() {
    try {
      await this.convexService.mutation('internalPages:removeById', {
        pageId: PROMPT_INTERNAL_PAGE_ID,
      });

      return {
        pageId: PROMPT_INTERNAL_PAGE_ID,
        prompt: DEFAULT_CONSULTANT_SYSTEM_PROMPT,
        defaultPrompt: DEFAULT_CONSULTANT_SYSTEM_PROMPT,
        isCustomized: false,
        updatedAt: null,
      };
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
