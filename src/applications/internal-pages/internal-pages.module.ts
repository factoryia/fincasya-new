import { Module } from '@nestjs/common';
import { InternalPagesController } from './internal-pages.controller';
import { InternalPagesService } from './internal-pages.service';
import { SharedModule } from '../shared/shared.module';
import { AuthModule } from '../auth/auth.module';
import { LegalPagesController } from './legal-pages.controller';
import { ComoFuncionaController } from './como-funciona.controller';

@Module({
  imports: [SharedModule, AuthModule],
  controllers: [InternalPagesController, LegalPagesController, ComoFuncionaController],
  providers: [InternalPagesService],
})
export class InternalPagesModule {}
