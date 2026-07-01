import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Request } from 'express';
import { SaleLinksService } from './sale-links.service';
import { CreateSaleLinkDto } from './dto/create-sale-link.dto';
import { UpdateSaleLinkDto } from './dto/update-sale-link.dto';
import { UploadPaymentProofDto } from './dto/upload-payment-proof.dto';

@Controller('sale-links')
export class SaleLinksController {
  constructor(private readonly saleLinksService: SaleLinksService) {}

  @Post()
  async create(@Body() dto: CreateSaleLinkDto, @Req() req: Request) {
    const user = (req as unknown as { user?: { id?: string; name?: string } }).user;
    return this.saleLinksService.create(dto, user?.id ?? 'unknown', user?.name);
  }

  @Get()
  async list(
    @Query('createdBy') createdBy?: string,
    @Query('status') status?: string,
  ) {
    return this.saleLinksService.list({ createdBy, status });
  }

  @Get(':token/payment-proof')
  async getPaymentProofMeta(
    @Param('token') token: string,
    @Query('key') key: string,
  ) {
    return this.saleLinksService.getPaymentProofMeta(token, key ?? '');
  }

  @Get(':token/payment-proof-file')
  async getPaymentProofFile(
    @Param('token') token: string,
    @Query('key') key: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const file = await this.saleLinksService.getPaymentProofFile(token, key ?? '');
    res.set({
      'Content-Type': file.mimeType,
      'Content-Disposition': `inline; filename="${file.safeFileName}"`,
      'Cache-Control': 'private, max-age=300',
    });
    return new StreamableFile(file.buffer);
  }

  @Get(':token/document-file')
  async getDocumentFile(
    @Param('token') token: string,
    @Query('type') type: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const file = await this.saleLinksService.getDocumentFile(token, type ?? '');
    res.set({
      'Content-Type': file.mimeType,
      'Content-Disposition': `inline; filename="${file.safeFileName}"`,
      'Cache-Control': 'private, max-age=300',
    });
    return new StreamableFile(file.buffer);
  }

  @Get(':token/cedula-photo-file')
  async getCedulaPhotoFile(
    @Param('token') token: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const file = await this.saleLinksService.getDocumentFile(token, 'cedula-photo');
    res.set({
      'Content-Type': file.mimeType,
      'Content-Disposition': `inline; filename="${file.safeFileName}"`,
      'Cache-Control': 'private, max-age=300',
    });
    return new StreamableFile(file.buffer);
  }

  @Get(':token')
  async getByToken(@Param('token') token: string) {
    return this.saleLinksService.getByToken(token);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateSaleLinkDto) {
    return this.saleLinksService.update(id, dto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.saleLinksService.remove(id);
  }

  @Post(':token/upload-payment-proof')
  async uploadPaymentProof(
    @Param('token') token: string,
    @Body() body: UploadPaymentProofDto,
  ) {
    return this.saleLinksService.uploadPaymentProofJson(token, body);
  }

  @Post(':token/upload-signed-contract')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 20 * 1024 * 1024 },
    }),
  )
  async uploadSignedContract(
    @Param('token') token: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.saleLinksService.uploadSignedContract(token, file);
  }

  @Post(':token/generate-contract')
  async generateContract(@Param('token') token: string) {
    return this.saleLinksService.generateContract(token);
  }

  @Post(':token/generate-cr')
  async generateCr(@Param('token') token: string) {
    return this.saleLinksService.generateCr(token);
  }

  @Post(':id/set-owner-offer')
  async setOwnerOffer(
    @Param('id') id: string,
    @Body() body: { ownerOfferAmount: number },
  ) {
    return this.saleLinksService.setOwnerOffer(id, Number(body.ownerOfferAmount ?? 0));
  }

  @Post(':id/mark-owner-offer-sent')
  async markOwnerOfferSent(@Param('id') id: string) {
    return this.saleLinksService.markOwnerOfferSent(id);
  }

  @Post(':token/validate-payment')
  async validatePayment(
    @Param('token') token: string,
    @Body() body: { validationKey: string; validatedBy?: string },
  ) {
    return this.saleLinksService.validatePayment(token, body.validationKey, body.validatedBy);
  }

  @Post(':token/validate-payment-admin')
  async validatePaymentAdmin(
    @Param('token') token: string,
    @Body() body: { validatedBy: string },
  ) {
    return this.saleLinksService.validatePaymentAsAdmin(token, body.validatedBy);
  }
}
