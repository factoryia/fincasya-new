import { Module } from '@nestjs/common';
import { FincasController } from './fincas.controller';
import { FincasService } from './fincas.service';
import { SharedModule } from '../shared/shared.module';

@Module({
  imports: [SharedModule],
  controllers: [FincasController],
  providers: [FincasService],
  exports: [FincasService],
})
export class FincasModule {}
