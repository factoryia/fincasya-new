import { Injectable, Logger } from '@nestjs/common';
import {
  getAdminNotificationTemplate,
  getClientConfirmationTemplate,
  getReminderTemplate,
  getCheckinInvitationTemplate,
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

  /** Por ahora desactivado con DISABLE_EMAIL_SENDING=true en .env */
  private isEmailSendingDisabled(): boolean {
    const flag = (process.env.DISABLE_EMAIL_SENDING ?? '').toLowerCase();
    return flag === 'true' || flag === '1' || flag === 'yes';
  }

  private logEmailSkipped(kind: string, to?: string) {
    this.logger.log(
      `[email] Envío deshabilitado (${kind}${to ? ` → ${to}` : ''}).`,
    );
  }

  async sendBookingConfirmationToClient(data: {
    clientEmail: string;
    clientName: string;
    propertyTitle: string;
    reference: string;
    contractUrl: string;
    confirmationUrl?: string;
  }) {
    if (this.isEmailSendingDisabled()) {
      this.logEmailSkipped('confirmación cliente', data.clientEmail);
      return;
    }

    const htmlContent = getClientConfirmationTemplate({
      logoUrl: this.logoUrl,
      clientName: data.clientName,
      propertyTitle: data.propertyTitle,
      reference: data.reference,
      contractUrl: data.contractUrl,
    });

    try {
      const attachments = [];

      // Attach contract
      if (data.contractUrl) {
        const extension =
          data.contractUrl.split('.').pop()?.split('?')[0] || 'pdf';
        attachments.push({
          url: data.contractUrl,
          name: `Contrato_${data.reference}.${extension}`,
        });
      }

      // Attach confirmation PDF if provided
      if (data.confirmationUrl) {
        attachments.push({
          url: data.confirmationUrl,
          name: `Confirmacion_Reserva_${data.reference}.pdf`,
        });
      }

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
          attachment: attachments,
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
    contractUrl?: string;
    confirmationUrl?: string;
  }) {
    if (this.isEmailSendingDisabled()) {
      this.logEmailSkipped('alerta admin', this.adminEmail);
      return;
    }

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
      const attachments = [];
      if (data.contractUrl) {
        attachments.push({
          url: data.contractUrl,
          name: `Contrato_${data.reference}.pdf`,
        });
      }
      if (data.confirmationUrl) {
        attachments.push({
          url: data.confirmationUrl,
          name: `Confirmacion_Reserva_${data.reference}.pdf`,
        });
      }

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
          attachment: attachments.length > 0 ? attachments : undefined,
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

  /**
   * Alerta a comercial cuando un turista sube un soporte de pago en el portal,
   * para que un asesor entre a revisarlo. Va siempre a los dos correos del área.
   */
  async sendPaymentReceiptAlert(data: {
    reference: string;
    propertyTitle: string;
    clientName: string;
    amount?: number;
    bankName?: string;
    receiptUrl: string;
    precioTotal?: number;
    pagoPendiente?: number;
    adminUrl?: string;
    /** Correos destino (configurables en el admin). */
    emails?: string[];
  }) {
    const list =
      Array.isArray(data.emails) && data.emails.length > 0
        ? data.emails
        : ['comercial@fincasya.com', 'fincasecoturisticasdelllano@gmail.com'];
    const recipients = list.map((email) => ({ email }));
    if (this.isEmailSendingDisabled()) {
      this.logEmailSkipped('alerta soporte de pago', recipients.map((r) => r.email).join(', '));
      return;
    }
    const fmt = (n?: number) =>
      typeof n === 'number'
        ? new Intl.NumberFormat('es-CO', {
            style: 'currency',
            currency: 'COP',
            minimumFractionDigits: 0,
          }).format(n)
        : '—';
    const row = (label: string, value: string) =>
      `<tr><td style="padding:6px 0;color:#666;">${label}</td><td style="padding:6px 0;font-weight:600;text-align:right;">${value}</td></tr>`;
    const htmlContent = `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a;">
        <h2 style="font-size:18px;margin:0 0 4px;">💸 Soporte de pago recibido</h2>
        <p style="color:#666;margin:0 0 16px;">Un turista subió un comprobante en el portal de pago. Por favor revísalo.</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          ${row('Reserva', data.reference)}
          ${row('Finca', data.propertyTitle)}
          ${row('Cliente', data.clientName || '—')}
          ${row('Monto reportado', fmt(data.amount))}
          ${data.bankName ? row('Banco', data.bankName) : ''}
          ${typeof data.precioTotal === 'number' ? row('Total reserva', fmt(data.precioTotal)) : ''}
          ${typeof data.pagoPendiente === 'number' ? row('Saldo pendiente', fmt(data.pagoPendiente)) : ''}
        </table>
        <div style="margin:18px 0;">
          <a href="${data.receiptUrl}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:14px;margin-right:8px;">Ver comprobante</a>
          ${data.adminUrl ? `<a href="${data.adminUrl}" style="display:inline-block;background:#f97316;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:14px;">Revisar en el admin</a>` : ''}
        </div>
        <p style="color:#999;font-size:12px;margin-top:24px;">FincasYa · Notificación automática del portal de pago.</p>
      </div>`;

    try {
      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': this.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sender: { name: 'FincasYa System', email: this.senderEmail },
          to: recipients,
          subject: `💸 Soporte de pago — ${data.propertyTitle} (${data.reference})`,
          htmlContent,
        }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Error desconocido');
      }
      this.logger.log(
        `Alerta de soporte de pago enviada (reserva ${data.reference}).`,
      );
    } catch (error) {
      this.logger.error(
        `Error enviando alerta de soporte de pago: ${(error as Error).message}`,
      );
    }
  }

  async sendReservationReminder(data: {
    clientEmail: string;
    clientName: string;
    propertyTitle: string;
    checkInDate: string;
    checkInTime: string;
    reference: string;
    checkinUrl?: string;
  }) {
    if (this.isEmailSendingDisabled()) {
      this.logEmailSkipped('recordatorio reserva', data.clientEmail);
      return;
    }

    const htmlContent = getReminderTemplate({
      logoUrl: this.logoUrl,
      clientName: data.clientName,
      propertyTitle: data.propertyTitle,
      checkInDate: data.checkInDate,
      checkInTime: data.checkInTime,
      reference: data.reference,
      checkinUrl: data.checkinUrl,
    });

    try {
      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sender: { name: this.senderName, email: this.senderEmail },
          to: [{ email: data.clientEmail, name: data.clientName }],
          subject: `📋 Completa tu check-in para ${data.propertyTitle} — tu llegada se acerca`,
          htmlContent: htmlContent,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          errorData.message || 'Error al enviar recordatorio de email',
        );
      }

      this.logger.log(`Recordatorio enviado a cliente: ${data.clientEmail}`);
    } catch (error) {
      this.logger.error(
        `Error enviando recordatorio a cliente: ${error.message}`,
      );
      throw error;
    }
  }

  /** Invitación al check-in (envío manual desde la ventana de la reserva). */
  async sendCheckinInvitationToClient(data: {
    clientEmail: string;
    clientName: string;
    propertyTitle: string;
    checkInDate: string;
    checkInTime: string;
    reference: string;
    checkinUrl: string;
  }) {
    if (!data.clientEmail) {
      throw new Error('La reserva no tiene correo del cliente');
    }
    if (this.isEmailSendingDisabled()) {
      this.logEmailSkipped('invitación check-in', data.clientEmail);
      return;
    }

    const htmlContent = getCheckinInvitationTemplate({
      logoUrl: this.logoUrl,
      clientName: data.clientName,
      propertyTitle: data.propertyTitle,
      checkInDate: data.checkInDate,
      checkInTime: data.checkInTime,
      reference: data.reference,
      checkinUrl: data.checkinUrl,
    });

    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sender: { name: this.senderName, email: this.senderEmail },
        to: [{ email: data.clientEmail, name: data.clientName }],
        subject: `📋 Completa tu check-in para ${data.propertyTitle}`,
        htmlContent,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.message || 'Error al enviar el correo de check-in',
      );
    }

    this.logger.log(`Correo de check-in enviado a cliente: ${data.clientEmail}`);
  }

  /**
   * Notifica al equipo cuando se recibe una solicitud de Habeas Data
   * (Ley 1581 Colombia). Destino: HABEAS_DATA_EMAIL si está definido,
   * caso contrario ADMIN_EMAIL.
   */
  async sendHabeasDataRequestToAdmin(data: {
    fullName: string;
    documentType: string;
    documentNumber: string;
    email: string;
    phone?: string;
    requestType: string;
    requestTypeLabel: string;
    description: string;
    submittedAt: string;
    requestId: string;
  }) {
    const to =
      process.env.HABEAS_DATA_EMAIL ||
      this.adminEmail ||
      'comercial@fincasya.com';

    if (this.isEmailSendingDisabled()) {
      this.logEmailSkipped('habeas data admin', to);
      return;
    }

    const esc = (s: string | undefined) =>
      (s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    const htmlContent = `<!DOCTYPE html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1a1a;max-width:600px;margin:0 auto;padding:24px;">
  <div style="border-bottom:3px solid #E8571F;padding-bottom:16px;margin-bottom:24px;">
    <h1 style="margin:0;font-size:20px;">Nueva solicitud de Habeas Data</h1>
    <p style="color:#666;font-size:13px;margin:6px 0 0;">
      Tipo: <strong>${esc(data.requestTypeLabel)}</strong><br>
      Recibida: ${esc(data.submittedAt)}<br>
      ID: <code>${esc(data.requestId)}</code>
    </p>
  </div>
  <h2 style="font-size:15px;margin:16px 0 8px;color:#444;">Solicitante</h2>
  <table style="width:100%;border-collapse:collapse;font-size:14px;">
    <tr><td style="padding:6px 0;color:#666;width:140px;">Nombre</td><td><strong>${esc(data.fullName)}</strong></td></tr>
    <tr><td style="padding:6px 0;color:#666;">Documento</td><td>${esc(data.documentType)} ${esc(data.documentNumber)}</td></tr>
    <tr><td style="padding:6px 0;color:#666;">Email</td><td><a href="mailto:${esc(data.email)}">${esc(data.email)}</a></td></tr>
    ${data.phone ? `<tr><td style="padding:6px 0;color:#666;">Teléfono</td><td>${esc(data.phone)}</td></tr>` : ''}
  </table>
  <h2 style="font-size:15px;margin:24px 0 8px;color:#444;">Descripción</h2>
  <div style="background:#f6f6f6;border-radius:8px;padding:16px;font-size:14px;white-space:pre-wrap;">${esc(data.description)}</div>
  <div style="margin-top:32px;padding:16px;background:#FFF3ED;border-radius:8px;font-size:13px;color:#7a3a17;">
    ⏱️ <strong>Plazo legal de respuesta:</strong> 10 días hábiles para consultas, 15 + 8 hábiles para reclamos (Ley 1581 arts. 14-15).
  </div>
</body></html>`;

    try {
      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sender: { name: 'FincasYa Legal', email: this.senderEmail },
          to: [{ email: to }],
          replyTo: { email: data.email, name: data.fullName },
          subject: `📋 Habeas Data — ${data.requestTypeLabel} — ${data.fullName}`,
          htmlContent,
        }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          errorData.message || 'Error enviando notificación de Habeas Data',
        );
      }
      this.logger.log(`Habeas Data notificado a admin: ${to}`);
    } catch (error) {
      this.logger.error(`Error enviando Habeas Data al admin: ${error.message}`);
      // No relanzamos: la solicitud ya quedó persistida; el email es secundario.
    }
  }
}
