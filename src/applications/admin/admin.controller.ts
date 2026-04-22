import { Controller, Get, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { GoogleCalendarService } from '../shared/services/google-calendar.service';

// URI canónico único registrado en Google Cloud Console.
// Debe coincidir exactamente con handleConnect() en el frontend y con route.ts.
const PROD_REDIRECT_URI = 'https://app.fincasya.cloud/api/admin/calendar-callback';
const LOCAL_REDIRECT_URI = 'http://localhost:3000/api/admin/calendar-callback';

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
   * Callback directo para producción cuando /api/* va al NestJS sin pasar por Next.js.
   * Usa siempre el URI canónico fijo para que coincida con el que generó la auth URL.
   */
  @Get('calendar-callback')
  async legacyCalendarCallback(
    @Query('code') code: string,
    @Query('error') error: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    // Detectar entorno para el redirect de vuelta al dashboard del usuario
    const host =
      (req.headers['x-forwarded-host'] as string) ||
      req.headers['host'] ||
      '';
    const isLocalhost = host.includes('localhost');

    // URI canónico: el MISMO que se usó en generateAuthUrl y en route.ts
    const redirectUri = isLocalhost ? LOCAL_REDIRECT_URI : PROD_REDIRECT_URI;

    // URL base para redirigir al usuario de vuelta al frontend
    const appUrl = isLocalhost
      ? 'http://localhost:3000'
      : 'https://fincasya.com';

    console.log('[calendar-callback] redirectUri usado:', redirectUri);

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
