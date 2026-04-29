import { Module } from '@nestjs/common';
import { AccountingManagersController } from './accounting-managers.controller';
import { AccountingManagersService } from './accounting-managers.service';
import { SharedModule } from '../shared/shared.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [SharedModule, AuthModule],
  controllers: [AccountingManagersController],
  providers: [AccountingManagersService],
})
export class AccountingManagersModule {}
