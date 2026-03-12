import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { CatalogsModule } from './catalogs/catalogs.module';
import { FeaturesModule } from './features/features.module';
import { FincasModule } from './fincas/fincas.module';
import { InboxModule } from './inbox/inbox.module';
import { KnowledgeModule } from './knowledge/knowledge.module';
import { UsersModule } from './users/users.module';
import { ReviewsModule } from './reviews/reviews.module';

@Module({
  imports: [
    AuthModule,
    CatalogsModule,
    FeaturesModule,
    FincasModule,
    InboxModule,
    KnowledgeModule,
    UsersModule,
    ReviewsModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
