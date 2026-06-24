import {
  Body,
  Controller,
  Param,
  Post,
  Res,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { ContractLinkService } from './contract-link.service';
import { CompleteContractLinkDto } from './dto/complete-contract-link.dto';

/**
 * En producción, fincasya.com reescribe `/api/*` hacia NestJS.
 * El formulario público `/contrato/:token` llama a este endpoint.
 */
@Controller('contract-link')
export class ContractLinkController {
  constructor(private readonly contractLinkService: ContractLinkService) {}

  @Post(':token/complete')
  async completeContractLink(
    @Param('token') token: string,
    @Body() body: CompleteContractLinkDto,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    await this.contractLinkService.completeContractLink(token, body, res);
  }

  @Post(':token/cedula-photos')
  @UseInterceptors(
    FilesInterceptor('photos', 2, {
      storage: memoryStorage(),
      limits: { fileSize: 8 * 1024 * 1024 },
    }),
  )
  async uploadCedulaPhotos(
    @Param('token') token: string,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    return this.contractLinkService.uploadCedulaPhotos(token, files ?? []);
  }
}
