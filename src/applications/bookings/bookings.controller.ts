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
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { BookingsSyncService } from '../shared/services/bookings-sync.service';
import { ConvexAuthGuard } from '../shared/guards/convex-auth.guard';
import { AdminGuard } from '../shared/guards/admin.guard';
import { OwnerOrAdminGuard } from '../shared/guards/owner-or-admin.guard';

@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookingsSyncService: BookingsSyncService) {}

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
}
