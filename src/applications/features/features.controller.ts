import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
  UseGuards,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { FeaturesService } from './features.service';
import {
  CreateFeatureDto,
  UpdateFeatureDto,
  BulkCreateFeaturesDto,
} from './dto/feature.dto';
import { ConvexAuthGuard } from '../shared/guards/convex-auth.guard';
import { AdminGuard } from '../shared/guards/admin.guard';

@Controller('features')
export class FeaturesController {
  constructor(private readonly featuresService: FeaturesService) {}

  @Get()
  async list() {
    return this.featuresService.list();
  }

  @Get(':id')
  async getById(@Param('id') id: string) {
    return this.featuresService.getById(id);
  }

  @Post()
  @UseGuards(ConvexAuthGuard, AdminGuard)
  @UseInterceptors(
    FileInterceptor('icon', {
      storage: memoryStorage(),
      limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
    }),
  )
  async create(
    @Body() createDto: CreateFeatureDto,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 2 * 1024 * 1024 }),
          new FileTypeValidator({ fileType: /(svg|xml)/ }),
        ],
        fileIsRequired: false,
      }),
    )
    icon?: Express.Multer.File,
  ) {
    return this.featuresService.create(createDto.name, createDto.emoji, icon);
  }

  @Post('bulk')
  @UseGuards(ConvexAuthGuard, AdminGuard)
  @UseInterceptors(
    FilesInterceptor('icons', 1000, {
      storage: memoryStorage(),
      limits: { fileSize: 2 * 1024 * 1024 }, // 2MB por archivo
    }),
  )
  async bulkUpload(@UploadedFiles() files: Express.Multer.File[]) {
    if (!files || files.length === 0) {
      throw new Error('No se proporcionaron archivos');
    }
    return this.featuresService.bulkUpload(files);
  }

  @Post('bulk-json')
  @UseGuards(ConvexAuthGuard, AdminGuard)
  async bulkCreateJson(@Body() bulkDto: BulkCreateFeaturesDto) {
    return this.featuresService.bulkCreate(bulkDto.features);
  }

  @Patch(':id')
  @UseGuards(ConvexAuthGuard, AdminGuard)
  @UseInterceptors(
    FileInterceptor('icon', {
      storage: memoryStorage(),
      limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
    }),
  )
  async update(
    @Param('id') id: string,
    @Body() updateDto: UpdateFeatureDto,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 2 * 1024 * 1024 }),
          new FileTypeValidator({ fileType: /(svg|xml)/ }),
        ],
        fileIsRequired: false,
      }),
    )
    icon?: Express.Multer.File,
  ) {
    return this.featuresService.update(
      id,
      updateDto.name,
      updateDto.emoji,
      icon,
    );
  }

  @Delete(':id')
  @UseGuards(ConvexAuthGuard, AdminGuard)
  async remove(@Param('id') id: string) {
    return this.featuresService.remove(id);
  }
}
