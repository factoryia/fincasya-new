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
} from '@nestjs/common';
import { FilesInterceptor, FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { FincasService } from './fincas.service';
import { CreateFincaDto, PricingItemDto } from './dto/create-finca.dto';
import { UpdateFincaDto } from './dto/update-finca.dto';
import { ListFincasDto } from './dto/list-fincas.dto';

@Controller('fincas')
export class FincasController {
  constructor(private readonly fincasService: FincasService) {}

  @Get()
  async list(@Query() listDto: ListFincasDto) {
    return this.fincasService.list(listDto);
  }

  @Get('search')
  async search(
    @Query('q') query: string,
    @Query('limit') limit?: string,
  ) {
    const limitNum = limit ? parseInt(limit, 10) : undefined;
    return this.fincasService.search(query, limitNum);
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
  @UseInterceptors(
    FilesInterceptor('images', 20, {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB por imagen
    }),
  )
  async create(
    @Body() createDto: CreateFincaDto,
    @UploadedFiles() images?: Express.Multer.File[],
  ) {
    return this.fincasService.create(createDto, images);
  }

  @Post('import')
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
  async addTemporada(
    @Param('id') id: string,
    @Body() body: PricingItemDto,
  ) {
    return this.fincasService.addTemporada(id, body);
  }

  @Put(':id/pricing')
  async setPricing(
    @Param('id') id: string,
    @Body() body: { pricing: PricingItemDto[] },
  ) {
    return this.fincasService.setPricing(id, body.pricing);
  }

  @Patch(':id/pricing/:pricingId')
  async updateTemporada(
    @Param('pricingId') pricingId: string,
    @Body() body: Partial<PricingItemDto>,
  ) {
    return this.fincasService.updateTemporada(pricingId, body);
  }

  @Delete(':id/pricing/:pricingId')
  async removeTemporada(@Param('pricingId') pricingId: string) {
    return this.fincasService.removeTemporada(pricingId);
  }

  @Put(':id')
  @UseInterceptors(
    FilesInterceptor('images', 20, {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB por imagen
    }),
  )
  async update(
    @Param('id') id: string,
    @Body() updateDto: UpdateFincaDto,
    @UploadedFiles() images?: Express.Multer.File[],
  ) {
    return this.fincasService.update(id, updateDto, images);
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    return this.fincasService.delete(id);
  }

  @Post(':id/images')
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
  async removeImage(@Param('imageId') imageId: string) {
    return this.fincasService.removeImage(imageId);
  }

  @Post(':id/features')
  async addFeature(@Param('id') propertyId: string, @Body('name') name: string) {
    return this.fincasService.addFeature(propertyId, name);
  }

  @Delete('features/:featureId')
  async removeFeature(@Param('featureId') featureId: string) {
    return this.fincasService.removeFeature(featureId);
  }

  @Post(':id/video')
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
