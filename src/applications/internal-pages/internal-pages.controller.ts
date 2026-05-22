import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { InternalPagesService } from './internal-pages.service';
import { ConvexAuthGuard } from '../shared/guards/convex-auth.guard';
import { AdminGuard } from '../shared/guards/admin.guard';

@Controller('internal-pages')
export class InternalPagesController {
  constructor(private readonly internalPagesService: InternalPagesService) {}

  @Get(':pageId')
  async get(@Param('pageId') pageId: string) {
    return await this.internalPagesService.get(pageId);
  }

  @Patch(':pageId')
  @UseGuards(ConvexAuthGuard, AdminGuard)
  async update(@Param('pageId') pageId: string, @Body() body: any) {
    return await this.internalPagesService.update(pageId, body);
  }

  @Post('images')
  @UseGuards(ConvexAuthGuard, AdminGuard)
  @UseInterceptors(
    FilesInterceptor('images', 10, {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  async uploadImages(@UploadedFiles() files: Express.Multer.File[]) {
    return await this.internalPagesService.uploadImages(files);
  }

  @Post('video')
  @UseGuards(ConvexAuthGuard, AdminGuard)
  @UseInterceptors(
    FileInterceptor('video', {
      storage: memoryStorage(),
      limits: { fileSize: 150 * 1024 * 1024 },
    }),
  )
  async uploadVideo(@UploadedFile() file: Express.Multer.File) {
    return await this.internalPagesService.uploadVideo(file);
  }
}

