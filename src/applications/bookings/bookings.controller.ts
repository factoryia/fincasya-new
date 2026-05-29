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
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request } from 'express';
import { FilesInterceptor, FileInterceptor } from '@nestjs/platform-express';
import { BookingsSyncService } from './bookings-sync.service';
import { BookingsRemindersService } from './bookings-reminders.service';
import { ConvexAuthGuard } from '../shared/guards/convex-auth.guard';
import { AdminGuard } from '../shared/guards/admin.guard';
import { OwnerOrAdminGuard } from '../shared/guards/owner-or-admin.guard';
import { RolesGuard } from '../shared/guards/roles.guard';
import { Roles } from '../shared/decorators/roles.decorator';
import { UserRole } from '../shared/constants/user-role';
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

  @Get('count')
  @UseGuards(ConvexAuthGuard, AdminGuard)
  async count() {
    return this.bookingsSyncService.countBookings();
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

  @Get('by-contract')
  @UseGuards(ConvexAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.ASSISTANT, UserRole.VENDEDOR)
  async getByContractNumber(@Query('contractNumber') contractNumber: string) {
    if (!contractNumber?.trim()) {
      return null;
    }
    try {
      return await this.bookingsSyncService.getBookingByContractNumber(
        contractNumber.trim(),
      );
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : typeof err === 'string' ? err : 'Error desconocido';
      throw new HttpException(
        {
          error: 'Fallo al consultar reservas en Convex.',
          message: msg,
        },
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  @Get('contract-codes')
  @UseGuards(ConvexAuthGuard, AdminGuard)
  async listContractCodes(
    @Query('propertyId') propertyId?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('page') page?: string,
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) : undefined;
    const parsedPage = page ? parseInt(page, 10) : undefined;
    return this.bookingsSyncService.listContractCodes({
      propertyId: propertyId?.trim() || undefined,
      search: search?.trim() || undefined,
      limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
      page: Number.isFinite(parsedPage) ? parsedPage : undefined,
    });
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
   * Rangos ocupados para deshabilitar fechas en el calendario público.
   */
  @Get('blocked-dates-public')
  async getBlockedDatesPublic(
    @Query('propertyId') propertyId: string,
    @Query('monthsAhead') monthsAhead?: string,
  ) {
    if (!propertyId) {
      throw new HttpException(
        'propertyId es requerido',
        HttpStatus.BAD_REQUEST,
      );
    }
    const months = monthsAhead ? parseInt(monthsAhead, 10) : 12;
    return this.bookingsSyncService.getBlockedDateRanges(
      propertyId,
      Number.isFinite(months) ? months : 12,
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

  @Post('contract-snapshot')
  @UseGuards(ConvexAuthGuard, AdminGuard)
  async saveContractSnapshot(
    @Body()
    body: {
      contractNumber: string;
      propertyId: string;
      payload: Record<string, unknown>;
    },
  ) {
    return this.bookingsSyncService.saveContractSnapshot(body);
  }

  @Post('finalize-contract-snapshot')
  @UseGuards(ConvexAuthGuard, AdminGuard)
  async finalizeContractSnapshot(
    @Body()
    body: {
      snapshotId: string;
      paymentStatus: string;
    },
  ) {
    return this.bookingsSyncService.finalizeContractSnapshot(body);
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
