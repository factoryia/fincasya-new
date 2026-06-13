import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { GoogleCalendarService } from '../shared/services/google-calendar.service';
import { ConvexSiteProxyService } from '../shared/services/convex-site-proxy.service';

// URI canónico único registrado en Google Cloud Console.
// Debe coincidir exactamente con handleConnect() en el frontend y con route.ts.
const PROD_REDIRECT_URI = 'https://app.fincasya.cloud/api/admin/calendar-callback';
const LOCAL_REDIRECT_URI = 'http://localhost:3000/api/admin/calendar-callback';

@Controller('admin')
export class AdminController {
  constructor(
    private readonly googleCalendarService: GoogleCalendarService,
    private readonly convexProxy: ConvexSiteProxyService,
  ) {}

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
      const result = await this.googleCalendarService.exchangeCode(code, redirectUri);
      const shouldMigrate =
        result && typeof result === 'object' && 'shouldResync' in result && result.shouldResync
          ? '1'
          : '0';
      return res.redirect(
        `${appUrl}/admin/reservations?success=true&migrate=${shouldMigrate}`,
      );
    } catch (err) {
      console.error('[calendar-callback] Error intercambiando código:', err);
      const msg = (err).message || 'exchange_failed';
      return res.redirect(
        `${appUrl}/admin/reservations?error=${encodeURIComponent(msg)}`,
      );
    }
  }

  @Post('google-calendar/disconnect')
  async disconnect() {
    return this.googleCalendarService.disconnect();
  }

  @Post('google-calendar/resync')
  async resyncGoogleCalendar(@Body() body: { includePast?: boolean }) {
    return this.googleCalendarService.resyncAllBookings(body?.includePast ?? true);
  }

  /**
   * Ajustes globales del contrato (cuentas, cláusulas). Proxea a Convex HTTP porque
   * en producción `/api/*` cae en NestJS vía rewrite de Next.js.
   */
  @Get('contract-settings')
  async getContractSettings() {
    return this.convexProxy.forwardJson('GET', '/api/admin/contract-settings');
  }

  @Put('contract-settings')
  async putContractSettings(@Body() body: Record<string, unknown>) {
    return this.convexProxy.forwardJson(
      'PUT',
      '/api/admin/contract-settings',
      body,
    );
  }

  /**
   * Crea un link público de contrato. Proxea a Convex HTTP porque en producción
   * `/api/*` cae en NestJS (no en los route handlers de Next.js).
   */
  @Post('contract-link')
  async createContractLink(@Body() body: Record<string, unknown>) {
    return this.convexProxy.forwardJson(
      'POST',
      '/api/admin/contract-link',
      body,
    );
  }
}
