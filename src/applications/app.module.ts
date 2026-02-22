import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { FincasModule } from './fincas/fincas.module';
import { KnowledgeModule } from './knowledge/knowledge.module';

@Module({
  imports: [AuthModule, FincasModule, KnowledgeModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
