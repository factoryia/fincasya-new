import { Module } from '@nestjs/common';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';
import { SharedModule } from '../shared/shared.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [SharedModule, AuthModule],
  controllers: [RolesController],
  providers: [RolesService],
  exports: [RolesService],
})
export class RolesModule {}