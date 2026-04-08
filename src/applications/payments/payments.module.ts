import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { FincasModule } from '../fincas/fincas.module';
import { SharedModule } from '../shared/shared.module';

@Module({
  imports: [FincasModule, SharedModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
