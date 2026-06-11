import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CheckinMessagingService } from './checkin-messaging.service';

/**
 * Portal público de pago del turista.
 * Ruta expuesta como `/api/payment/:reference` (producción reescribe /api/* al backend Nest).
 */
@Controller('payment')
export class PaymentPortalController {
  constructor(private readonly checkinMessaging: CheckinMessagingService) {}

  @Get(':key')
  async getPortal(@Param('key') key: string) {
    const data = await this.checkinMessaging.getPaymentPortalByReference(key);
    if (!data) {
      throw new HttpException(
        { error: 'not_found', message: 'No encontramos esta reserva.' },
        HttpStatus.NOT_FOUND,
      );
    }
    return { ok: true, ...data };
  }

  @Post(':key')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 900_000 },
    }),
  )
  async submitReceipt(
    @Param('key') key: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body()
    body: {
      bankAccountId?: string;
      bankName?: string;
      amount?: string;
    },
  ) {
    if (!file) {
      throw new HttpException(
        { error: 'Adjunta el comprobante en el campo "file"' },
        HttpStatus.BAD_REQUEST,
      );
    }

    const amountRaw = String(body?.amount ?? '').trim();
    const amount = amountRaw
      ? Math.max(0, Math.floor(Number(amountRaw) || 0))
      : undefined;

    return this.checkinMessaging.submitPaymentPortalReceipt(key, {
      file,
      bankAccountId: body?.bankAccountId?.trim() || undefined,
      bankName: body?.bankName?.trim() || undefined,
      amount: amount && amount > 0 ? amount : undefined,
    }).catch((err: unknown) => {
      const message =
        err instanceof Error ? err.message : 'No se pudo enviar el comprobante';
      throw new HttpException({ error: message }, HttpStatus.BAD_REQUEST);
    });
  }
}
