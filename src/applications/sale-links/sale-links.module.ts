import { Module } from '@nestjs/common';
import { SharedModule } from '../shared/shared.module';
import { FincasModule } from '../fincas/fincas.module';
import { SaleLinksController } from './sale-links.controller';
import { SaleLinksService } from './sale-links.service';

@Module({
  imports: [SharedModule, FincasModule],
  controllers: [SaleLinksController],
  providers: [SaleLinksService],
  exports: [SaleLinksService],
})
export class SaleLinksModule {}
