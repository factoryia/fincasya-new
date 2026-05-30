import { Module } from '@nestjs/common';
import { SharedModule } from '../shared/shared.module';
import { FincasModule } from '../fincas/fincas.module';
import { ContractLinkController } from './contract-link.controller';
import { ContractLinkService } from './contract-link.service';

@Module({
  imports: [SharedModule, FincasModule],
  controllers: [ContractLinkController],
  providers: [ContractLinkService],
})
export class ContractLinkModule {}
