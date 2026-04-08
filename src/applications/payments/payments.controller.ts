<<<<<<< HEAD
import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  Headers,
  Logger,
  HttpStatus,
  HttpCode,
  Param,
} from '@nestjs/common';
=======
import { Controller, Post, Get, Body, Req, Headers, Logger, HttpStatus, HttpCode, Param } from '@nestjs/common';
>>>>>>> a54323cd7029aaa2b1d36e7099c65661d52107ab
import { PaymentsService } from './payments.service';

@Controller('payments')
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(private readonly paymentsService: PaymentsService) {}

  /**
   * Recibe notificaciones automáticas de Bold mediante Webhook
   */
  @Post('bold-webhook')
  @HttpCode(HttpStatus.OK)
  async boldWebhook(
    @Req() req: any,
    @Headers('x-bold-signature') signature: string,
    @Body() payload: any,
  ) {
    this.logger.log(`Recibida petición de webhook de Bold`);

    // 1. Validar la firma HMAC-SHA256
    const rawBody = req.rawBody;
    if (!rawBody || !signature) {
      this.logger.error('Falta el cuerpo crudo o la firma en el webhook');
      return { status: 'invalid_request' };
    }

    const isValid = this.paymentsService.verifySignature(rawBody, signature);
    if (!isValid) {
      this.logger.error('Firma de webhook inválida');
      return { status: 'unauthorized' };
    }

    // 2. Procesar el payload de forma asíncrona
    // No esperamos el resultado para responder rápido a Bold (evitar retries innecesarios)
<<<<<<< HEAD
    this.paymentsService.handleWebhook(payload).catch((e) => {
      this.logger.error(`Error procesando webhook async: ${e.message}`);
=======
    this.paymentsService.handleWebhook(payload).catch(e => {
        this.logger.error(`Error procesando webhook async: ${e.message}`);
>>>>>>> a54323cd7029aaa2b1d36e7099c65661d52107ab
    });

    return { status: 'received' };
  }

  /**
   * Endpoint de verificación manual de pago (Para el Admin o fallback)
   * Útil para pruebas locales donde el webhook no llega.
   */
  @Get('verify/:referenceId')
  async verifyManualPayment(@Param('referenceId') referenceId: string) {
<<<<<<< HEAD
    this.logger.log(
      `Verificación manual de pago solicitada para: ${referenceId}`,
    );
=======
    this.logger.log(`Verificación manual de pago solicitada para: ${referenceId}`);
>>>>>>> a54323cd7029aaa2b1d36e7099c65661d52107ab
    return this.paymentsService.verifyPaymentWithAPI(referenceId);
  }
}
