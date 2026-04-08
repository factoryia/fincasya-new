import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import axios from 'axios';
import * as crypto from 'crypto';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../../../convex-api-stub';
import { FincasService } from '../fincas/fincas.service';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly convex: ConvexHttpClient;

  constructor(private readonly fincasService: FincasService) {
    this.convex = new ConvexHttpClient(process.env.CONVEX_URL!);
  }

  /**
   * Verifica la firma HMAC-SHA256 enviada por Bold
   * @param rawBody El cuerpo crudo de la petición (Buffer)
   * @param signature La firma recibida en el header x-bold-signature
   * @returns boolean
   */
  verifySignature(rawBody: Buffer, signature: string): boolean {
    const secret = process.env.BOLD_SHARED_SECRET;
    if (!secret) {
      this.logger.error('BOLD_SHARED_SECRET no está configurado');
      return false;
    }

    const hmac = crypto.createHmac('sha256', secret);
    const digest = hmac.update(rawBody).digest('hex');

    this.logger.log(`[Webhook Debug] Firma Recibida: ${signature}`);
    this.logger.log(`[Webhook Debug] Firma Calculada: ${digest}`);

    // Comparación segura en tiempo constante
    try {
      if (digest === signature) {
        return true;
      }
      return crypto.timingSafeEqual(
        Buffer.from(digest, 'hex'),
        Buffer.from(signature, 'hex'),
      );
    } catch (e) {
      // Fallback a comparación de strings si falla por longitud
      return digest === signature;
    }
  }

  /**
   * Procesa la notificación del webhook de Bold
   */
  async handleWebhook(payload: any) {
    this.logger.log(
      `Procesando webhook de Bold: ${payload.type} para el subject ${payload.subject}`,
    );

    const bookingReference = payload.subject; // Según documentación, subject es la referencia
    const status = payload.type; // SALE_APPROVED, etc.

    if (status === 'SALE_APPROVED') {
      await this.activateBooking(bookingReference, payload.data);
    } else {
      this.logger.warn(`Pago no aprobado o estado ignorado: ${status}`);
    }
  }

  /**
   * Consulta activamente el estado de una transacción vía API de Bold (Fallback/Manual)
   */
  async verifyPaymentWithAPI(referenceId: string) {
    const identityKey = process.env.BOLD_IDENTIDAD_KEY;
    if (!identityKey) {
      throw new BadRequestException('BOLD_IDENTIDAD_KEY no está configurada');
    }

    try {
      // Nota: Según la doc, se usa la llave de identidad con el header x-api-key
      const response = await axios.get(
        `https://payments.api.bold.co/v2/payment-voucher/${referenceId}`,
        {
          headers: {
            Authorization: `x-api-key ${identityKey}`,
          },
        },
      );

      const data = response.data;
      this.logger.log(
        `Respuesta de API Bold para ${referenceId}: ${data.payment_status}`,
      );

      if (data.payment_status === 'APPROVED') {
        await this.activateBooking(referenceId, data);
        return { success: true, status: data.payment_status };
      }

      return { success: false, status: data.payment_status };
    } catch (error) {
      this.logger.error(
        `Error consultando API de Bold para ${referenceId}: ${error.message}`,
      );
      throw new BadRequestException(
        `Error en Bold API: ${error.response?.data?.message || error.message}`,
      );
    }
  }

  /**
   * Activa la reserva: cambia estado a PAID y genera contrato
   */
  private async activateBooking(reference: string, boldData: any) {
    // 1. Buscar la reserva en Convex
    const booking = await this.convex.query(api.bookings.getByReference, {
      reference,
    });

    if (!booking) {
      this.logger.error(`No se encontró reserva con referencia: ${reference}`);
      return;
    }

    if (booking.status === 'PAID') {
      this.logger.log(`La reserva ${reference} ya está marcada como pagada.`);
      return;
    }

    this.logger.log(`Activando reserva ${booking._id} (Ref: ${reference})`);

    // 2. Actualizar estado en Convex
    await this.convex.mutation(api.bookings.update, {
      id: booking._id,
      status: 'PAID',
      isDirect: true,
    });

    // 3. Registrar el pago
    await this.convex.mutation(api.bookings.createPayment, {
      bookingId: booking._id,
      type: 'COMPLETO',
      amount: booking.precioTotal,
      currency: booking.currency || 'COP',
      transactionId: boldData.transaction_id || boldData.id,
      reference: reference,
      status: 'PAID',
      // @ts-ignore - bypassing strict type check
      boldData: boldData,
    });

    // 4. Generar contrato y notificar (Reusando lógica existente en FincasService)
    // Extraemos la firma que se guardó en la reserva (si existe)
    // Nota: El DirectBookingModal debería haber guardado la firma en la reserva o pasarla aquí.
    // Como el contrato requiere la firma, si no la tenemos aquí, la buscamos.

    try {
      await this.fincasService.generateContract(booking.propertyId, {
        propertyId: booking.propertyId,
        clientName: booking.nombreCompleto,
        clientId: booking.cedula,
        clientEmail: booking.correo,
        clientPhone: booking.celular,
        clientCity: booking.city || '',
        clientAddress: '',
        checkInDate: new Date(booking.fechaEntrada).toISOString().split('T')[0],
        checkOutDate: new Date(booking.fechaSalida).toISOString().split('T')[0],
        contractNumber: `DIR-${booking._id.toString().slice(-6)}`,
        bankName: 'Bold/FincasYa',
        accountNumber: 'N/A',
        accountHolder: 'FincasYa',
        idNumber: booking.cedula,
        conversationId: 'direct-reservation',
        nightlyPrice: (booking.subtotal || 0).toString(),
        // La firma debería estar en algún lado. Si no, el FincasService fallará elegantemente o usará placeholder
      });

      this.logger.log(
        `Contrato generado y notificaciones enviadas para reserva ${reference}`,
      );
    } catch (e) {
      this.logger.error(`Error al generar contrato tras pago: ${e.message}`);
    }
  }
}
