import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { google, calendar_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { ConvexService } from './convex.service';

@Injectable()
export class GoogleCalendarService {
  private oauth2Client: OAuth2Client;

  constructor(private readonly convexService: ConvexService) {
    this.oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
    );
  }

  /**
   * Obtiene un cliente de calendario autorizado recuperando el token de Convex.
   */
  private async getAuthorizedCalendar(): Promise<calendar_v3.Calendar> {
    const gc = await this.convexService.query('googleCalendar:getForSync', {});
    
    if (!gc?.connected || !gc.refreshToken) {
      throw new Error('Google Calendar no está conectado');
    }

    let accessToken = gc.accessToken;

    // Si el token expiró, lo refrescamos vía Convex (o lo intentamos aquí si no queremos delegar todo)
    // Para simplificar, configuramos el refresh token y dejamos que la librería lo maneje o usamos el de Convex
    this.oauth2Client.setCredentials({
      refresh_token: gc.refreshToken,
      access_token: gc.accessToken,
      expiry_date: gc.expiresAt,
    });

    return google.calendar({ version: 'v3', auth: this.oauth2Client });
  }

  /**
   * Generar URL para iniciar OAuth.
   */
  async getAuthUrl(redirectUri: string): Promise<string> {
    return this.convexService.action('googleCalendar:generateAuthUrl', { redirectUri }) as Promise<string>;
  }

  /**
   * Intercambiar código por tokens.
   */
  async exchangeCode(code: string, redirectUri: string) {
    return this.convexService.action('googleCalendar:exchangeCodeForTokens', { code, redirectUri });
  }

  /**
   * Desconectar la integración.
   */
  async disconnect() {
    return this.convexService.mutation('googleCalendar:disconnect', {});
  }

  /**
   * Validar la conexión con Google Calendar (Leyendo de Convex).
   */
  async validateConnection(): Promise<{ connected: boolean; calendarId: string; connectedEmail?: string; connectedName?: string; error?: string; needsReauth?: boolean }> {
    try {
      const gc = await this.convexService.query('googleCalendar:get', {});
      
      if (!gc || !gc.connected) {
        return {
          connected: false,
          calendarId: 'primary',
          error: 'No conectado'
        };
      }

      return {
        connected: true,
        calendarId: gc.calendarId || 'primary',
        connectedEmail: gc.connectedEmail,
        connectedName: gc.connectedName,
        needsReauth: !!gc.needsReauth,
      };
    } catch (error: any) {
      console.error('Error validating Google connection from Convex:', error);
      return {
        connected: false,
        calendarId: 'primary',
        error: error.message,
      };
    }
  }

  // Los métodos de creación/edición de eventos ahora son opcionales aquí 
  // ya que Convex los maneja en background, pero los dejo por si se llaman desde NestJS directamente.
  
  async createEvent(params: { summary: string; description?: string; start: Date; end: Date; location?: string }): Promise<string> {
    const calendar = await this.getAuthorizedCalendar();
    const response = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: {
        summary: params.summary,
        location: params.location,
        description: params.description,
        start: { dateTime: params.start.toISOString() },
        end: { dateTime: params.end.toISOString() },
      },
    });
    return response.data.id || '';
  }

  async updateEvent(eventId: string, params: { summary?: string; description?: string; start?: Date; end?: Date; location?: string }): Promise<void> {
    const calendar = await this.getAuthorizedCalendar();
    const requestBody: calendar_v3.Schema$Event = {};
    if (params.summary) requestBody.summary = params.summary;
    if (params.location) requestBody.location = params.location;
    if (params.description) requestBody.description = params.description;
    if (params.start) requestBody.start = { dateTime: params.start.toISOString() };
    if (params.end) requestBody.end = { dateTime: params.end.toISOString() };

    await calendar.events.patch({
      calendarId: 'primary',
      eventId,
      requestBody,
    });
  }

  async deleteEvent(eventId: string): Promise<void> {
    const calendar = await this.getAuthorizedCalendar();
    try {
      await calendar.events.delete({
        calendarId: 'primary',
        eventId,
      });
    } catch (e: any) {
      console.error(`Failed to delete Google Calendar Event (${eventId}):`, e.message);
    }
  }
}
