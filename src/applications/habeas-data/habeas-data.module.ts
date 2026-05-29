import { Module } from '@nestjs/common';
import { HabeasDataService } from './habeas-data.service';
import { HabeasDataController } from './habeas-data.controller';
import { SharedModule } from '../shared/shared.module';

@Module({
  imports: [SharedModule],
  controllers: [HabeasDataController],
  providers: [HabeasDataService],
  exports: [HabeasDataService],
})
export class HabeasDataModule {}
