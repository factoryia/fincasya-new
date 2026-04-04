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

@Controller('bookings')
@UseGuards(ConvexAuthGuard, AdminGuard)
export class BookingsController {
  constructor(private readonly bookingsSyncService: BookingsSyncService) {}

  @Get()
  async list(@Query() query: any) {
    return this.bookingsSyncService.listBookings(query);
  }

  @Post('check-availability')
  async checkAvailability(@Body() body: { propertyId: string; fechaEntrada: number; fechaSalida: number }) {
    return this.bookingsSyncService.checkAvailability(body.propertyId, body.fechaEntrada, body.fechaSalida);
  }

  @Post()
  @UseInterceptors(FilesInterceptor('multimedia'))
  async create(
    @Body() body: any,
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    return this.bookingsSyncService.createBooking(body, files);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.bookingsSyncService.deleteBooking(id);
  }
}
