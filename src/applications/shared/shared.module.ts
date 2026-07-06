import { Module } from '@nestjs/common';
import { ConvexService } from './services/convex.service';
import { S3Service } from './services/s3.service';
import { GoogleCalendarService } from './services/google-calendar.service';
import { BrevoEmailService } from './services/brevo-email.service';

import { PdfService } from './services/pdf.service';
import { ConvexSiteProxyService } from './services/convex-site-proxy.service';
import { AudioWhatsappService } from './services/audio-whatsapp.service';

@Module({
  providers: [
    ConvexService,
    ConvexSiteProxyService,
    S3Service,
    GoogleCalendarService,
    BrevoEmailService,
    PdfService,
    AudioWhatsappService,
  ],
  exports: [
    ConvexService,
    ConvexSiteProxyService,
    S3Service,
    GoogleCalendarService,
    BrevoEmailService,
    PdfService,
    AudioWhatsappService,
  ],
})
export class SharedModule {}
