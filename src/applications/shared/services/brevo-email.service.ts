import { Injectable, Logger } from '@nestjs/common';
import {
  getAdminNotificationTemplate,
  getClientConfirmationTemplate,
} from './email-templates';

@Injectable()
export class BrevoEmailService {
  private readonly logger = new Logger(BrevoEmailService.name);
  private readonly apiKey: string;
  private readonly senderEmail: string;
  private readonly senderName: string;
  private readonly logoUrl: string;
  private readonly adminEmail: string;

  constructor() {
    this.apiKey = process.env.BREVO_API_KEY || '';
    this.senderEmail = process.env.BREVO_SENDER_EMAIL || '';
    this.senderName = process.env.BREVO_SENDER_NAME || 'FincasYA';
    this.logoUrl = process.env.LOGO_URL || '';
    this.adminEmail = process.env.ADMIN_EMAIL || '';
  }

  async sendBookingConfirmationToClient(data: {
    clientEmail: string;
    clientName: string;
    propertyTitle: string;
    reference: string;
    contractUrl: string;
  }) {
    const htmlContent = getClientConfirmationTemplate({
      logoUrl: this.logoUrl,
      clientName: data.clientName,
      propertyTitle: data.propertyTitle,
      reference: data.reference,
      contractUrl: data.contractUrl,
    });

    try {
      const extension =
        data.contractUrl.split('.').pop()?.split('?')[0] || 'pdf';

      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sender: { name: this.senderName, email: this.senderEmail },
          to: [{ email: data.clientEmail, name: data.clientName }],
          subject: `📦 Acción Requerida: Instrucciones para tu reserva en ${data.propertyTitle}`,
          htmlContent: htmlContent,
          attachment: [
            {
              url: data.contractUrl,
              name: `Contrato_${data.reference}.${extension}`,
            },
          ],
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          errorData.message || 'Error desconocido al enviar email',
        );
      }

      const result = await response.json();
      this.logger.log(`Email enviado a cliente: ${data.clientEmail}`);
      return result;
    } catch (error) {
      this.logger.error(`Error enviando email a cliente: ${error.message}`);
      throw error;
    }
  }

  async sendBookingAlertToAdmin(data: {
    clientName: string;
    clientEmail: string;
    clientPhone: string;
    propertyTitle: string;
    checkInDate: string;
    checkOutDate: string;
    totalAmount: number;
    reference: string;
  }) {
    const adminEmail = this.adminEmail;

    const htmlContent = getAdminNotificationTemplate({
      logoUrl: this.logoUrl,
      clientName: data.clientName,
      clientEmail: data.clientEmail,
      clientPhone: data.clientPhone,
      propertyTitle: data.propertyTitle,
      checkInDate: data.checkInDate,
      checkOutDate: data.checkOutDate,
      totalAmount: data.totalAmount,
      reference: data.reference,
    });

    try {
      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sender: { name: 'FincasYa System', email: this.senderEmail },
          to: [{ email: adminEmail }],
          subject: `🚨 NUEVA RESERVA: ${data.propertyTitle} - ${data.clientName}`,
          htmlContent: htmlContent,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Error desconocido');
      }

      this.logger.log(
        `Alerta de reserva enviada al administrador: ${adminEmail}`,
      );
    } catch (error) {
      this.logger.error(`Error enviando alerta al admin: ${error.message}`);
    }
  }
}
