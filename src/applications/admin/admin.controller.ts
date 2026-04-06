import { Controller, Get, Post, Query, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { GoogleCalendarService } from '../shared/services/google-calendar.service';

@Controller('admin')
export class AdminController {
  constructor(private readonly googleCalendarService: GoogleCalendarService) {}

  @Get('google-calendar/status')
  async getGoogleCalendarStatus() {
    return this.googleCalendarService.validateConnection();
  }

  /** Alias que llama el frontend: /api/admin/calendar-status */
  @Get('calendar-status')
  async getCalendarStatus() {
    return this.googleCalendarService.validateConnection();
  }

  @Get('google-calendar/auth-url')
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

  /**
   * Callback directo de Google OAuth para producción
   * (donde /api/* va al backend sin pasar por Next.js).
   *
   * El redirectUri DEBE ser idéntico al que se usó en generateAuthUrl.
   * Lo reconstruimos desde el host real de la request entrante para soportar
   * cualquier dominio registrado en GCP (fincasya.com, app.fincasya.cloud, etc.)
   */
  @Get('calendar-callback')
  async legacyCalendarCallback(
    @Query('code') code: string,
    @Query('error') error: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    // Detectar proto y host reales (detrás de proxy/CDN)
    const proto = (req.headers['x-forwarded-proto'] as string) || 'https';
    const host =
      (req.headers['x-forwarded-host'] as string) ||
      req.headers['host'] ||
      'app.fincasya.cloud';

    // Debe coincidir exactamente con el URI que generó la auth URL
    const redirectUri = `${proto}://${host}/api/admin/calendar-callback`;

    // URL base para redirigir al usuario de vuelta al dashboard
    const appUrl = `${proto}://${host}`;

    console.log('[calendar-callback] redirectUri reconstruido:', redirectUri);

    if (error) {
      return res.redirect(`${appUrl}/admin/reservations?error=${error}`);
    }

    if (!code) {
      return res.redirect(`${appUrl}/admin/reservations?error=no_code`);
    }

    try {
      await this.googleCalendarService.exchangeCode(code, redirectUri);
      return res.redirect(`${appUrl}/admin/reservations?success=true`);
    } catch (err) {
      console.error('[calendar-callback] Error intercambiando código:', err);
      const msg = (err as any).message || 'exchange_failed';
      return res.redirect(
        `${appUrl}/admin/reservations?error=${encodeURIComponent(msg)}`,
      );
    }
  }

  @Post('google-calendar/disconnect')
  async disconnect() {
    return this.googleCalendarService.disconnect();
  }
}
