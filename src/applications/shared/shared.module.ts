import { Module } from '@nestjs/common';
import { ConvexService } from './services/convex.service';
import { S3Service } from './services/s3.service';
import { BookingsSyncService } from './services/bookings-sync.service';
import { GoogleCalendarService } from './services/google-calendar.service';

@Module({
  providers: [
    ConvexService,
    S3Service,
    BookingsSyncService,
    GoogleCalendarService,
  ],
  exports: [
    ConvexService,
    S3Service,
    BookingsSyncService,
    GoogleCalendarService,
  ],
})
export class SharedModule {}
