import { Body, Controller, Param, Post, Res } from '@nestjs/common';
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
}
