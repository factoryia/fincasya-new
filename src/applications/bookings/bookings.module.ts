import { Module } from '@nestjs/common';
import { BookingsController } from './bookings.controller';
import { SharedModule } from '../shared/shared.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [SharedModule, AuthModule],
  controllers: [BookingsController],
  providers: [],
  exports: [],
})
export class BookingsModule {}
