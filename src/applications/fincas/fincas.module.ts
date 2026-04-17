import { Module, forwardRef } from '@nestjs/common';
import { FincasController } from './fincas.controller';
import { PropertiesSimpleController } from './properties-simple.controller';
import { FincasService } from './fincas.service';
import { SharedModule } from '../shared/shared.module';
import { AuthModule } from '../auth/auth.module';
import { InboxModule } from '../inbox/inbox.module';

@Module({
  imports: [SharedModule, AuthModule, forwardRef(() => InboxModule)],
  controllers: [FincasController, PropertiesSimpleController],
  providers: [FincasService],
  exports: [FincasService],
})
export class FincasModule {}
