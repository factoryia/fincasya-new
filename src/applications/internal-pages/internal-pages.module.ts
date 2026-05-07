import { Module } from '@nestjs/common';
import { InternalPagesController } from './internal-pages.controller';
import { InternalPagesService } from './internal-pages.service';
import { SharedModule } from '../shared/shared.module';
import { AuthModule } from '../auth/auth.module';
import { LegalPagesController } from './legal-pages.controller';
import { ComoFuncionaController } from './como-funciona.controller';
import { PromptController } from './prompt.controller';
import { N8nIntegrationController } from './n8n-integration.controller';
import { N8nIntegrationGuard } from './n8n-integration.guard';

@Module({
  imports: [SharedModule, AuthModule],
  controllers: [
    InternalPagesController,
    LegalPagesController,
    ComoFuncionaController,
    PromptController,
    N8nIntegrationController,
  ],
  providers: [InternalPagesService, N8nIntegrationGuard],
})
export class InternalPagesModule {}
