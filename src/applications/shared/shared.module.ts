import { Module } from '@nestjs/common';
import { ConvexService } from './services/convex.service';
import { S3Service } from './services/s3.service';
import { GoogleCalendarService } from './services/google-calendar.service';

@Module({
  providers: [
    ConvexService,
    S3Service,
    GoogleCalendarService,
  ],
  exports: [
    ConvexService,
    S3Service,
    GoogleCalendarService,
  ],
})
export class SharedModule {}
