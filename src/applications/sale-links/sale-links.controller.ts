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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Request } from 'express';
import { SaleLinksService } from './sale-links.service';
import { CreateSaleLinkDto } from './dto/create-sale-link.dto';
import { UpdateSaleLinkDto } from './dto/update-sale-link.dto';

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
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  async uploadPaymentProof(
    @Param('token') token: string,
    @UploadedFile() file: Express.Multer.File,
    @Body()
    body: {
      nombre: string;
      cedula: string;
      email: string;
      telefono: string;
      direccion: string;
      ciudad?: string;
      paymentAmount?: string;
    },
  ) {
    return this.saleLinksService.uploadPaymentProof(token, file, {
      ...body,
      paymentAmount: body.paymentAmount ? Number(body.paymentAmount) : undefined,
    });
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

  @Post(':token/validate-payment')
  async validatePayment(
    @Param('token') token: string,
    @Body() body: { validationKey: string; validatedBy?: string },
  ) {
    return this.saleLinksService.validatePayment(token, body.validationKey, body.validatedBy);
  }
}
