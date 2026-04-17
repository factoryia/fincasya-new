import { Module, forwardRef } from '@nestjs/common';
import { BookingsController } from './bookings.controller';
import { SharedModule } from '../shared/shared.module';
import { AuthModule } from '../auth/auth.module';
import { FincasModule } from '../fincas/fincas.module';
import { BookingsSyncService } from './bookings-sync.service';

@Module({
  imports: [SharedModule, AuthModule, forwardRef(() => FincasModule)],
  controllers: [BookingsController],
  providers: [BookingsSyncService],
  exports: [BookingsSyncService],
})
export class BookingsModule {}
