import {
  Controller,
  Get,
  Patch,
  Body,
  UseGuards,
  Post,
  UseInterceptors,
  UploadedFiles,
  UploadedFile,
} from '@nestjs/common';
import { FilesInterceptor, FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { QuienesSomosService } from './quienes-somos.service';
import { UpdateQuienesSomosDto } from './dto/update-quienes-somos.dto';

@Controller('quienes-somos')
export class QuienesSomosController {
  constructor(private readonly quienesSomosService: QuienesSomosService) {}

  @Get()
  async get() {
    return await this.quienesSomosService.get();
  }

  @Patch()
  async update(@Body() updateDto: UpdateQuienesSomosDto) {
    return await this.quienesSomosService.update(updateDto);
  }

  @Post('images')
  @UseInterceptors(
    FilesInterceptor('images', 10, {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB per image
    }),
  )
  async uploadImages(@UploadedFiles() files: Express.Multer.File[]) {
    return await this.quienesSomosService.uploadImages(files);
  }

  @Post('video')
  @UseInterceptors(
    FileInterceptor('video', {
      storage: memoryStorage(),
      limits: { fileSize: 150 * 1024 * 1024 }, // 150MB per video
    }),
  )
  async uploadVideo(@UploadedFile() file: Express.Multer.File) {
    return await this.quienesSomosService.uploadVideo(file);
  }
}
