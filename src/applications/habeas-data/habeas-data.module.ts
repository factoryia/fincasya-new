import { Module } from '@nestjs/common';
import { HabeasDataService } from './habeas-data.service';
import { HabeasDataController } from './habeas-data.controller';
import { SharedModule } from '../shared/shared.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [SharedModule, AuthModule],
  controllers: [HabeasDataController],
  providers: [HabeasDataService],
  exports: [HabeasDataService],
})
export class HabeasDataModule {}
