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

  // Callback legacy/directo para producción donde /api/* va directo al backend
  @Get('calendar-callback')
  async legacyCalendarCallback(
    @Query('code') code: string,
    @Query('error') error: string,
    @Res() res: Response,
  ) {
    // Verificar la URL del frontend (priorizar env, pero asegurar que no sea la de la API)
    let appUrl = process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://app.fincasya.cloud';
    
    // Si la URL apunta accidentalmente al puerto de la API (3001), forzar la de producción en el despliegue
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
      // Usar exactamente el mismo URI que el frontend para validar ante Google
      const redirectUri = `${appUrl}/api/admin/calendar-callback`;
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
