import { Controller, Get, Post, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { GoogleCalendarService } from '../shared/services/google-calendar.service';
// import { ConvexAuthGuard } from '../shared/guards/convex-auth.guard';
// import { AdminGuard } from '../shared/guards/admin.guard';

@Controller('admin')
export class AdminController {
  constructor(private readonly googleCalendarService: GoogleCalendarService) {}

  @Get('google-calendar/status')
  // @UseGuards(ConvexAuthGuard, AdminGuard)
  async getGoogleCalendarStatus() {
    return this.googleCalendarService.validateConnection();
  }

  @Get('google-calendar/auth-url')
  // @UseGuards(ConvexAuthGuard, AdminGuard)
  async getAuthUrl(@Query('redirectUri') redirectUri: string) {
    const url = await this.googleCalendarService.getAuthUrl(redirectUri);
    return { url };
  }

  @Get('google-calendar/callback')
  async googleCallback(
    @Query('code') code: string,
    @Query('redirectUri') redirectUri: string,
  ) {
    return this.googleCalendarService.exchangeCode(code, redirectUri);
  }

  @Get('calendar-callback')
  async legacyCalendarCallback(
    @Query('code') code: string,
    @Query('error') error: string,
    @Res() res: Response,
  ) {
    // URL del frontend para redirigir al usuario después del OAuth
    let appUrl =
      process.env.SITE_URL ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      'https://app.fincasya.cloud';

    // Nunca redirigir al usuario al puerto del backend (3001)
    if (appUrl.includes(':3001')) {
      appUrl = 'https://app.fincasya.cloud';
    }
    appUrl = appUrl.replace(/\/$/, '');

    if (error) {
      return res.redirect(`${appUrl}/admin/reservations?error=${error}`);
    }

    if (!code) {
      return res.redirect(`${appUrl}/admin/reservations?error=no_code`);
    }

    try {
      // URI exacto registrado en Google Cloud Console (Authorized redirect URIs)
      const redirectUri = `https://app.fincasya.cloud/api/admin/calendar-callback`;

      await this.googleCalendarService.exchangeCode(code, redirectUri);
      return res.redirect(`${appUrl}/admin/reservations?success=true`);
    } catch (err) {
      console.error('Error exchanging code in backend:', err);
      const msg = err.message || 'exchange_failed';
      return res.redirect(`${appUrl}/admin/reservations?error=${encodeURIComponent(msg)}`);
    }
  }

  @Post('google-calendar/disconnect')
  // @UseGuards(ConvexAuthGuard, AdminGuard)
  async disconnect() {
    return this.googleCalendarService.disconnect();
  }
}
