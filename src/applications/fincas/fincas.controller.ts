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
  Req,
} from '@nestjs/common';
import {
  FilesInterceptor,
  FileInterceptor,
  FileFieldsInterceptor,
} from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { FincasService } from './fincas.service';
import { CreateFincaDto, PricingItemDto } from './dto/create-finca.dto';
import { GlobalPricingRuleDto, UpdateGlobalPricingRuleDto } from './dto/global-pricing.dto';
import { UpdateFincaDto } from './dto/update-finca.dto';
import { ListFincasDto } from './dto/list-fincas.dto';
import { UpdateOwnerInfoDto } from './dto/owner-info.dto';
import { ConvexAuthGuard } from '../shared/guards/convex-auth.guard';
import { AdminGuard } from '../shared/guards/admin.guard';

@Controller('fincas')
export class FincasController {
  constructor(private readonly fincasService: FincasService) {}

  @Get('slug/:slug')
  async getBySlug(@Param('slug') slug: string) {
    return this.fincasService.getBySlug(slug);
  }

  @Get('code/:code')
  async getByCode(@Param('code') code: string) {
    return this.fincasService.getByCode(code);
  }

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
        limits: { fileSize: 3000 * 1024 * 1024 }, // 3GB total para video e imágenes
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
          fileSize: 3000 * 1024 * 1024, // 3GB total para video e imágenes
        },
      },
    ),
  )
  async update(
    @Param('id') id: string,
    @Body() updateDto: UpdateFincaDto,
    @Req() req: any,
    @UploadedFiles()
    files?: { images?: Express.Multer.File[]; video?: Express.Multer.File[] },
  ) {
    console.log('[DEBUG] Raw body features:', req.body.features);
    console.log('[DEBUG] UpdateFincaDto features:', updateDto.features);
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
      limits: { fileSize: 3000 * 1024 * 1024 }, // 3GB
    }),
  )
  async addImage(
    @Param('id') propertyId: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 3000 * 1024 * 1024 }), // 3GB
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

  @Put(':id/images/reorder')
  @UseGuards(ConvexAuthGuard, AdminGuard)
  async reorderImages(
    @Param('id') id: string,
    @Body('imageOrders') imageOrders: { id: string; order: number }[],
  ) {
    return this.fincasService.reorderImages(imageOrders);
  }

  @Get('tab-order/:tabId')
  async getTabOrder(@Param('tabId') tabId: string) {
    return this.fincasService.getTabOrder(tabId);
  }

  @Put('tab-order/:tabId')
  @UseGuards(ConvexAuthGuard, AdminGuard)
  async reorderTab(
    @Param('tabId') tabId: string,
    @Body('propertyIds') propertyIds: string[],
  ) {
    return this.fincasService.updateTabOrder(tabId, propertyIds);
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
          new MaxFileSizeValidator({ maxSize: 3000 * 1024 * 1024 }), // 3GB
          new FileTypeValidator({ fileType: /(mp4|webm|mov)$/ }),
        ],
      }),
    )
    video: Express.Multer.File,
  ) {
    return this.fincasService.update(id, {}, undefined, video);
  }


  // --- Global Pricing Rules ---

  @Get('global-pricing')
  async listGlobalPricingRules() {
    return this.fincasService.listGlobalPricingRules();
  }

  @Get('global-pricing/:id')
  async getGlobalPricingRuleById(@Param('id') id: string) {
    return this.fincasService.getGlobalPricingRuleById(id);
  }

  @Post('global-pricing')
  @UseGuards(ConvexAuthGuard, AdminGuard)
  async createGlobalPricingRule(@Body() dto: GlobalPricingRuleDto) {
    return this.fincasService.createGlobalPricingRule(dto);
  }

  @Put('global-pricing/:id')
  @UseGuards(ConvexAuthGuard, AdminGuard)
  async updateGlobalPricingRule(
    @Param('id') id: string,
    @Body() dto: UpdateGlobalPricingRuleDto,
  ) {
    return this.fincasService.updateGlobalPricingRule(id, dto);
  }

  @Delete('global-pricing/:id')
  @UseGuards(ConvexAuthGuard, AdminGuard)
  async deleteGlobalPricingRule(@Param('id') id: string) {
    return this.fincasService.deleteGlobalPricingRule(id);
  }

  @Get(':id')
  async getById(
    @Param('id') id: string,
    @Query('activasOnly') activasOnly?: string,
  ) {
    return this.fincasService.getById(id, activasOnly === 'true');
  }

  @Get(':id/owner')
  @UseGuards(ConvexAuthGuard, AdminGuard)
  async getOwnerInfo(@Param('id') id: string) {
    return this.fincasService.getOwnerInfo(id);
  }

  @Post(':id/owner')
  @UseGuards(ConvexAuthGuard, AdminGuard)
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'bankCertification', maxCount: 1 },
        { name: 'idCopy', maxCount: 1 },
        { name: 'rntPdf', maxCount: 1 },
        { name: 'chamberOfCommerce', maxCount: 1 },
      ],
      {
        storage: memoryStorage(),
        limits: { fileSize: 50 * 1024 * 1024 }, // 50MB por documento
      },
    ),
  )
  async upsertOwnerInfo(
    @Param('id') id: string,
    @Body() dto: UpdateOwnerInfoDto,
    @UploadedFiles()
    files?: {
      bankCertification?: Express.Multer.File[];
      idCopy?: Express.Multer.File[];
      rntPdf?: Express.Multer.File[];
      chamberOfCommerce?: Express.Multer.File[];
    },
  ) {
    return this.fincasService.upsertOwnerInfo(id, dto, {
      bankCertification: files?.bankCertification?.[0],
      idCopy: files?.idCopy?.[0],
      rntPdf: files?.rntPdf?.[0],
      chamberOfCommerce: files?.chamberOfCommerce?.[0],
    });
  }
}
