import { Module } from '@nestjs/common';
import { QuienesSomosController } from './quienes-somos.controller';
import { QuienesSomosService } from './quienes-somos.service';
import { SharedModule } from '../shared/shared.module';

@Module({
  imports: [SharedModule],
  controllers: [QuienesSomosController],
  providers: [QuienesSomosService],
})
export class QuienesSomosModule {}
