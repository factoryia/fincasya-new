import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Query,
  Param,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
  UploadedFile,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { FilesInterceptor, FileInterceptor } from '@nestjs/platform-express';
import { BookingsSyncService } from './bookings-sync.service';
import { BookingsRemindersService } from './bookings-reminders.service';
import { ConvexAuthGuard } from '../shared/guards/convex-auth.guard';
import { AdminGuard } from '../shared/guards/admin.guard';
import { OwnerOrAdminGuard } from '../shared/guards/owner-or-admin.guard';
import { AuthService } from '../auth/auth.service';

@Controller('bookings')
export class BookingsController {
  constructor(
    private readonly bookingsSyncService: BookingsSyncService,
    private readonly authService: AuthService,
    private readonly remindersService: BookingsRemindersService,
  ) {}

  @Post('trigger-reminders')
  @UseGuards(ConvexAuthGuard, AdminGuard)
  async triggerReminders() {
    return this.remindersService.triggerRemindersManually();
  }

  @Get('my-bookings')
  @UseGuards(ConvexAuthGuard)
  async getMyBookings(@Req() req: Request) {
    const cookies = (req.headers.cookie ?? (req.headers as any)['Cookie'] ?? '') as string;
    const authHeader = req.headers.authorization;
    const session = await this.authService.getSession(cookies, authHeader);
    const sessionData = session?.data ?? session;
    const userEmail = sessionData?.user?.email;
    
    if (!userEmail) {
      throw new Error('No se pudo identificar el correo del usuario');
    }
    
    // We only pass userEmail. Passing userId (BetterAuth string) would cause the database to
    // look for a Contact with that ID, resulting in an empty list.
    return this.bookingsSyncService.listBookings({ userEmail });
  }

  @Get()
  @UseGuards(ConvexAuthGuard, OwnerOrAdminGuard)
  async list(@Query() query: any) {
    return this.bookingsSyncService.listBookings(query);
  }

  @Post('check-availability')
  @UseGuards(ConvexAuthGuard, AdminGuard)
  async checkAvailability(
    @Body()
    body: {
      propertyId: string;
      fechaEntrada: number;
      fechaSalida: number;
    },
  ) {
    return this.bookingsSyncService.checkAvailability(
      body.propertyId,
      body.fechaEntrada,
      body.fechaSalida,
    );
  }

  /**
   * Endpoint público para verificar disponibilidad (desde la web)
   */
  @Post('check-availability-public')
  async checkAvailabilityPublic(
    @Body()
    body: {
      propertyId: string;
      fechaEntrada: number;
      fechaSalida: number;
    },
  ) {
    return this.bookingsSyncService.checkAvailability(
      body.propertyId,
      body.fechaEntrada,
      body.fechaSalida,
    );
  }

  /**
   * Endpoint público para reservas directas (desde la web)
   */
  @Post('direct')
  async createDirect(@Body() body: any) {
    return this.bookingsSyncService.createBooking(body);
  }

  @Get('status/:reference')
  async getStatus(@Param('reference') reference: string) {
    return this.bookingsSyncService.checkPaymentStatus(reference);
  }

  @Post()
  @UseGuards(ConvexAuthGuard, AdminGuard)
  @UseInterceptors(FilesInterceptor('multimedia'))
  async create(
    @Body() body: any,
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    return this.bookingsSyncService.createBooking(body, files);
  }

  @Delete(':id')
  @UseGuards(ConvexAuthGuard, AdminGuard)
  async remove(@Param('id') id: string) {
    return this.bookingsSyncService.deleteBooking(id);
  }

  @Post(':id/multimedia')
  @UseGuards(ConvexAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  async uploadMultimedia(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.bookingsSyncService.uploadMultimedia(id, file);
  }

  @Delete(':id/multimedia')
  @UseGuards(ConvexAuthGuard)
  async removeMultimedia(
    @Param('id') id: string,
    @Body('url') url: string,
  ) {
    return this.bookingsSyncService.removeMultimedia(id, url);
  }
}
