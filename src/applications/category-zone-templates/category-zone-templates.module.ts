import { Module } from '@nestjs/common';
import { CategoryZoneTemplatesController } from './category-zone-templates.controller';
import { CategoryZoneTemplatesService } from './category-zone-templates.service';
import { SharedModule } from '../shared/shared.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [SharedModule, AuthModule],
  controllers: [CategoryZoneTemplatesController],
  providers: [CategoryZoneTemplatesService],
})
export class CategoryZoneTemplatesModule {}
