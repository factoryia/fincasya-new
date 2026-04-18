import { Module } from '@nestjs/common';
import { ConvexService } from './services/convex.service';
import { S3Service } from './services/s3.service';
import { GoogleCalendarService } from './services/google-calendar.service';
import { BrevoEmailService } from './services/brevo-email.service';

@Module({
  providers: [
    ConvexService,
    S3Service,
    GoogleCalendarService,
    BrevoEmailService,
  ],
  exports: [
    ConvexService,
    S3Service,
    GoogleCalendarService,
    BrevoEmailService,
  ],
})
export class SharedModule {}
