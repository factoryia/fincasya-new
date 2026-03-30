import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
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

  @Post('google-calendar/disconnect')
  // @UseGuards(ConvexAuthGuard, AdminGuard)
  async disconnect() {
    return this.googleCalendarService.disconnect();
  }
}
