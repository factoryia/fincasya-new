import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseInterceptors,
  UploadedFiles,
  UploadedFile,
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
  UseGuards,
  Header,
} from '@nestjs/common';
import {
  FilesInterceptor,
  FileInterceptor,
  FileFieldsInterceptor,
} from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { FincasService } from './fincas.service';
import { CreateFincaDto, PricingItemDto } from './dto/create-finca.dto';
import { UpdateFincaDto } from './dto/update-finca.dto';
import { ListFincasDto } from './dto/list-fincas.dto';
import { ConvexAuthGuard } from '../shared/guards/convex-auth.guard';
import { AdminGuard } from '../shared/guards/admin.guard';

@Controller('fincas')
export class FincasController {
  constructor(private readonly fincasService: FincasService) {}

  @Get()
  async list(@Query() listDto: ListFincasDto) {
    return this.fincasService.list(listDto);
  }

  @Get('search')
  async search(@Query('q') query: string, @Query('limit') limit?: string) {
    const limitNum = limit ? parseInt(limit, 10) : undefined;
    return this.fincasService.search(query, limitNum);
  }

  /** Feed de catálogo en CSV para Meta/Commerce Manager. URL para configurar como "origen de datos" del catálogo. */
  @Get('feed')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="catalog.csv"')
  async getCatalogFeed(): Promise<string> {
    return this.fincasService.getCatalogFeedCsv();
  }

  @Get(':id')
  async getById(
    @Param('id') id: string,
    @Query('activasOnly') activasOnly?: string,
  ) {
    return this.fincasService.getById(id, activasOnly === 'true');
  }

  @Get('code/:code')
  async getByCode(@Param('code') code: string) {
    return this.fincasService.getByCode(code);
  }

  @Post()
  @UseGuards(ConvexAuthGuard, AdminGuard)
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'images', maxCount: 20 },
        { name: 'video', maxCount: 1 },
      ],
      {
        storage: memoryStorage(),
        limits: { fileSize: 100 * 1024 * 1024 }, // 100MB para video
      },
    ),
  )
  async create(
    @Body() createDto: CreateFincaDto,
    @UploadedFiles()
    files?: { images?: Express.Multer.File[]; video?: Express.Multer.File[] },
  ) {
    return this.fincasService.create(
      createDto,
      files?.images,
      files?.video?.[0],
    );
  }

  @Post('import')
  @UseGuards(ConvexAuthGuard, AdminGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    }),
  )
  async importExcel(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 }),
          new FileTypeValidator({
            fileType:
              /^application\/vnd\.(openxmlformats-officedocument\.spreadsheetml\.sheet|ms-excel)(;.*)?$/,
          }),
        ],
        fileIsRequired: true,
      }),
    )
    file: Express.Multer.File,
  ) {
    return this.fincasService.importFromExcel(file.buffer);
  }

  @Post(':id/pricing')
  @UseGuards(ConvexAuthGuard, AdminGuard)
  async addTemporada(@Param('id') id: string, @Body() body: PricingItemDto) {
    return this.fincasService.addTemporada(id, body);
  }

  @Put(':id/pricing')
  @UseGuards(ConvexAuthGuard, AdminGuard)
  async setPricing(
    @Param('id') id: string,
    @Body() body: { pricing: PricingItemDto[] },
  ) {
    return this.fincasService.setPricing(id, body.pricing);
  }

  @Patch(':id/pricing/:pricingId')
  @UseGuards(ConvexAuthGuard, AdminGuard)
  async updateTemporada(
    @Param('pricingId') pricingId: string,
    @Body() body: Partial<PricingItemDto>,
  ) {
    return this.fincasService.updateTemporada(pricingId, body);
  }

  @Delete(':id/pricing/:pricingId')
  @UseGuards(ConvexAuthGuard, AdminGuard)
  async removeTemporada(@Param('pricingId') pricingId: string) {
    return this.fincasService.removeTemporada(pricingId);
  }

  @Put(':id')
  @UseGuards(ConvexAuthGuard, AdminGuard)
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'images', maxCount: 20 },
        { name: 'video', maxCount: 1 },
      ],
      {
        storage: memoryStorage(),
        limits: {
          fileSize: 100 * 1024 * 1024, // 100MB para video / 10MB típico imágenes
        },
      },
    ),
  )
  async update(
    @Param('id') id: string,
    @Body() updateDto: UpdateFincaDto,
    @UploadedFiles()
    files?: { images?: Express.Multer.File[]; video?: Express.Multer.File[] },
  ) {
    return this.fincasService.update(
      id,
      updateDto,
      files?.images,
      files?.video?.[0],
    );
  }

  @Delete(':id')
  @UseGuards(ConvexAuthGuard, AdminGuard)
  async delete(@Param('id') id: string) {
    return this.fincasService.delete(id);
  }

  @Post(':id/images')
  @UseGuards(ConvexAuthGuard, AdminGuard)
  @UseInterceptors(
    FileInterceptor('image', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    }),
  )
  async addImage(
    @Param('id') propertyId: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 10 * 1024 * 1024 }), // 10MB
          new FileTypeValidator({ fileType: /(jpg|jpeg|png|webp)$/ }),
        ],
      }),
    )
    image: Express.Multer.File,
  ) {
    return this.fincasService.addImage(propertyId, image);
  }

  @Delete('images/:imageId')
  @UseGuards(ConvexAuthGuard, AdminGuard)
  async removeImage(@Param('imageId') imageId: string) {
    return this.fincasService.removeImage(imageId);
  }

  @Post(':id/features')
  @UseGuards(ConvexAuthGuard, AdminGuard)
  async addFeature(
    @Param('id') propertyId: string,
    @Body('name') name: string,
    @Body('featureId') featureId?: string,
  ) {
    return this.fincasService.addFeature(propertyId, name, featureId);
  }

  @Post(':id/features/unlink')
  @UseGuards(ConvexAuthGuard, AdminGuard)
  async unlinkFeature(
    @Param('id') propertyId: string,
    @Body('name') name?: string,
    @Body('featureId') featureId?: string,
  ) {
    return this.fincasService.unlinkFeature(propertyId, name, featureId);
  }

  @Delete('features/:featureId')
  @UseGuards(ConvexAuthGuard, AdminGuard)
  async removeFeature(@Param('featureId') featureId: string) {
    return this.fincasService.removeFeature(featureId);
  }

  @Post(':id/video')
  @UseGuards(ConvexAuthGuard, AdminGuard)
  @UseInterceptors(
    FileInterceptor('video', {
      storage: memoryStorage(),
      limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
    }),
  )
  async uploadVideo(
    @Param('id') id: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 100 * 1024 * 1024 }), // 100MB
          new FileTypeValidator({ fileType: /(mp4|webm|mov)$/ }),
        ],
      }),
    )
    video: Express.Multer.File,
  ) {
    return this.fincasService.update(id, {}, undefined, video);
  }
}
