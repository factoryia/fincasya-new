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
   * Alerta cuando un turista sube un soporte de pago en el portal.
   * Producción → fincasecoturisticasdelllano@gmail.com (configurable en admin).
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
        : ['fincasecoturisticasdelllano@gmail.com'];
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

  /**
   * Notifica al admin que el cliente de un link de venta subió el soporte de pago.
   * Incluye botón "Validar Pago" con URL de un solo uso.
   */
  async sendSaleLinkPaymentAlert(data: {
    adminEmail: string;
    clientName: string;
    clientEmail: string;
    clientPhone: string;
    totalValue: number;
    checkIn: number;
    checkOut: number;
    nights: number;
    paymentProofUrl: string;
    proofViewUrl?: string;
    validateUrl: string;
    token: string;
  }): Promise<void> {
    const isDisabled = process.env.DISABLE_EMAIL_SENDING === 'true';
    if (isDisabled || !this.apiKey) {
      this.logger.warn('[sale-link] Email deshabilitado, omitiendo envío de alerta de pago.');
      return;
    }

    const logoUrl = process.env.LOGO_URL || 'https://fincasya.com/logo.png';
    const esc = (s: string | undefined) =>
      (s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    const formatCOP = (n: number) =>
      new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency: 'COP',
        minimumFractionDigits: 0,
      }).format(n);

    const formatDate = (ms: number) =>
      new Date(ms).toLocaleDateString('es-CO', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      });

    const proofViewUrl = data.proofViewUrl || data.paymentProofUrl;
    const isImage = /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(data.paymentProofUrl);

    const htmlContent = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Soporte de Pago - FincasYa</title>
</head>
<body style="margin:0;padding:0;background:#f4f7f9;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7f9;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.06);max-width:600px;">

        <!-- Header -->
        <tr>
          <td style="background:#000000;padding:32px 24px;text-align:center;">
            <img src="${esc(logoUrl)}" alt="FincasYa" style="max-width:140px;height:auto;">
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:40px 40px 32px;">
            <h1 style="margin:0 0 8px;font-size:22px;color:#1a1a1a;">💰 Nuevo soporte de pago recibido</h1>
            <p style="margin:0 0 24px;font-size:15px;color:#555;">
              El cliente <strong>${esc(data.clientName)}</strong> subió un soporte de pago para su reserva.
              Por favor revisa el comprobante y valida si el pago fue recibido.
            </p>

            <!-- Info cliente -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f9fa;border-radius:10px;padding:20px;margin-bottom:24px;">
              <tr>
                <td style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#888;padding-bottom:12px;">
                  Datos del Cliente
                </td>
              </tr>
              <tr><td style="font-size:14px;color:#333;padding:4px 0;"><strong>Nombre:</strong> ${esc(data.clientName)}</td></tr>
              <tr><td style="font-size:14px;color:#333;padding:4px 0;"><strong>Email:</strong> ${esc(data.clientEmail)}</td></tr>
              <tr><td style="font-size:14px;color:#333;padding:4px 0;"><strong>Teléfono:</strong> ${esc(data.clientPhone)}</td></tr>
            </table>

            <!-- Info reserva -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f9fa;border-radius:10px;padding:20px;margin-bottom:24px;">
              <tr>
                <td style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#888;padding-bottom:12px;">
                  Resumen de la Reserva
                </td>
              </tr>
              <tr><td style="font-size:14px;color:#333;padding:4px 0;"><strong>Check-in:</strong> ${formatDate(data.checkIn)}</td></tr>
              <tr><td style="font-size:14px;color:#333;padding:4px 0;"><strong>Check-out:</strong> ${formatDate(data.checkOut)}</td></tr>
              <tr><td style="font-size:14px;color:#333;padding:4px 0;"><strong>Noches:</strong> ${data.nights}</td></tr>
              <tr><td style="font-size:24px;font-weight:700;color:#E8571F;padding:12px 0 4px;">
                Total: ${formatCOP(data.totalValue)}
              </td></tr>
            </table>

            <!-- Soporte de pago -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
              <tr><td align="center" style="padding-bottom:12px;">
                <a href="${esc(proofViewUrl)}"
                   style="display:inline-block;background:#1a1a1a;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:10px;font-size:15px;font-weight:700;">
                  Ver comprobante en el navegador
                </a>
              </td></tr>
              <tr><td align="center">
                <p style="margin:0;font-size:12px;color:#888;">
                  Se abre en una ventana del navegador — no necesitas descargar el archivo.
                </p>
              </td></tr>
            </table>
            ${isImage
      ? `<p style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#888;margin:0 0 12px;text-align:center;">Vista previa</p>
               <img src="${esc(data.paymentProofUrl)}" alt="Comprobante de pago" style="max-width:100%;border-radius:10px;border:1px solid #e2e8f0;display:block;margin:0 auto 24px;">`
      : ''
    }

            <!-- CTA Validar -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#e8f5e9;border-radius:12px;padding:24px;margin-bottom:24px;text-align:center;">
              <tr><td>
                <p style="font-size:15px;color:#2e7d32;margin:0 0 16px;font-weight:600;">
                  ¿Llegó el pago? Haz clic en el botón para confirmar.
                </p>
                <a href="${esc(data.validateUrl)}"
                   style="display:inline-block;background:#2e7d32;color:#ffffff;text-decoration:none;padding:16px 40px;border-radius:8px;font-size:16px;font-weight:700;letter-spacing:0.5px;">
                  ✅ Validar Pago
                </a>
                <p style="font-size:12px;color:#555;margin:12px 0 0;">
                  Este botón es de un solo uso. Al hacer clic se habilitará automáticamente el siguiente paso para el cliente.
                </p>
              </td></tr>
            </table>

            <p style="font-size:12px;color:#999;margin:0;">
              Token del link: <code style="background:#f1f5f9;padding:2px 6px;border-radius:4px;">${esc(data.token)}</code>
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#fafbfc;padding:24px 40px;text-align:center;font-size:13px;color:#718096;border-top:1px solid #edf2f7;">
            FincasYa &nbsp;|&nbsp; Sistema de ventas
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

    try {
      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sender: { name: this.senderName, email: this.senderEmail },
          to: [{ email: data.adminEmail }],
          subject: `💰 Pago recibido — ${data.clientName} — ${formatCOP(data.totalValue)}`,
          htmlContent,
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || 'Error enviando email de alerta de pago');
      }
      this.logger.log(`[sale-link] Alerta de pago enviada a ${data.adminEmail}`);
    } catch (error) {
      this.logger.error(`[sale-link] Error enviando alerta de pago: ${error.message}`);
    }
  }

  /**
   * Avisa al cliente que su pago fue validado y puede continuar la reserva.
   */
  async sendSaleLinkPaymentValidatedClientEmail(data: {
    clientName: string;
    clientEmail: string;
    propertyTitle?: string;
    checkIn?: number;
    checkOut?: number;
    nights?: number;
    ventaUrl: string;
  }): Promise<void> {
    const isDisabled = process.env.DISABLE_EMAIL_SENDING === 'true';
    if (isDisabled || !this.apiKey) {
      this.logger.warn(
        '[sale-link] Email deshabilitado, omitiendo aviso de pago validado al cliente.',
      );
      return;
    }

    const clientEmail = data.clientEmail?.trim();
    if (!clientEmail) {
      this.logger.warn(
        '[sale-link] Sin email del cliente; no se envía aviso de pago validado.',
      );
      return;
    }

    const logoUrl = process.env.LOGO_URL || 'https://fincasya.com/logo.png';
    const esc = (s: string | undefined) =>
      (s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    const formatDate = (ms: number) =>
      new Date(ms).toLocaleDateString('es-CO', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      });

    const propertyLine = data.propertyTitle
      ? `<p style="margin:0 0 8px;font-size:14px;color:#333;"><strong>Finca:</strong> ${esc(data.propertyTitle)}</p>`
      : '';

    const htmlContent = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f7f9;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7f9;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.06);max-width:600px;width:100%;">
        <tr><td style="background:#000000;padding:32px 24px;text-align:center;">
          <img src="${esc(logoUrl)}" alt="FincasYa" style="max-width:160px;height:auto;">
        </td></tr>
        <tr><td style="padding:40px;">
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:#2e7d32;">Pago confirmado</p>
          <h1 style="margin:0 0 16px;font-size:24px;color:#1a1a1a;">¡Ya puedes continuar con tu reserva!</h1>
          <p style="margin:0 0 20px;font-size:15px;color:#555;line-height:1.6;">
            Hola <strong>${esc(data.clientName)}</strong>, confirmamos que tu pago fue validado.
            Ya puedes seguir con el contrato y los siguientes pasos de tu reserva.
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f9fa;border-radius:10px;padding:20px;margin-bottom:24px;">
            <tr><td style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#888;padding-bottom:12px;">Tu reserva</td></tr>
            ${propertyLine}
            <tr><td style="font-size:14px;color:#333;padding:4px 0;"><strong>Entrada:</strong> ${data.checkIn ? esc(formatDate(data.checkIn)) : '—'}</td></tr>
            <tr><td style="font-size:14px;color:#333;padding:4px 0;"><strong>Salida:</strong> ${data.checkOut ? esc(formatDate(data.checkOut)) : '—'}</td></tr>
            <tr><td style="font-size:14px;color:#333;padding:4px 0;"><strong>Noches:</strong> ${Math.max(1, data.nights ?? 1)}</td></tr>
          </table>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
            <tr><td align="center">
              <a href="${esc(data.ventaUrl)}" style="display:inline-block;background:#E8571F;color:#ffffff;text-decoration:none;padding:16px 40px;border-radius:10px;font-size:16px;font-weight:700;">
                Continuar mi reserva
              </a>
            </td></tr>
          </table>
          <p style="font-size:13px;color:#666;margin:0 0 8px;">Si perdiste el enlace, puedes usar este correo o copiar la URL:</p>
          <p style="font-size:12px;color:#1a73e8;margin:0;word-break:break-all;"><a href="${esc(data.ventaUrl)}" style="color:#1a73e8;">${esc(data.ventaUrl)}</a></p>
        </td></tr>
        <tr><td style="background:#fafbfc;padding:24px 40px;text-align:center;font-size:13px;color:#718096;border-top:1px solid #edf2f7;">
          FincasYa — Experiencias inolvidables
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

    try {
      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sender: { name: this.senderName, email: this.senderEmail },
          to: [{ email: clientEmail, name: data.clientName }],
          subject: '¡Tu pago fue confirmado! Continúa tu reserva — FincasYa',
          htmlContent,
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || 'Error enviando email de pago validado');
      }
      this.logger.log(
        `[sale-link] Pago validado: correo enviado al cliente ${clientEmail}`,
      );
    } catch (error) {
      this.logger.error(
        `[sale-link] Error enviando pago validado al cliente: ${error.message}`,
      );
    }
  }

  /**
   * Avisa al propietario que el pago fue validado y debe confirmar en /anfitrion.
   * No envía nada si no hay correo del propietario.
   */
  async sendSaleLinkOwnerAnfitrionEmail(data: {
    ownerName: string;
    ownerTratamiento: string;
    ownerEmail: string;
    propertyTitle?: string;
    clientName: string;
    checkIn?: number;
    checkOut?: number;
    nights?: number;
    guests?: number;
    bookingReference: string;
    anfitrionUrl: string;
  }): Promise<void> {
    const isDisabled = process.env.DISABLE_EMAIL_SENDING === 'true';
    if (isDisabled || !this.apiKey) {
      this.logger.warn(
        '[sale-link] Email deshabilitado, omitiendo aviso de anfitrión al propietario.',
      );
      return;
    }

    const ownerEmail = data.ownerEmail?.trim();
    if (!ownerEmail) {
      this.logger.warn(
        '[sale-link] Sin email del propietario; no se envía link de anfitrión.',
      );
      return;
    }

    const logoUrl = process.env.LOGO_URL || 'https://fincasya.com/logo.png';
    const esc = (s: string | undefined) =>
      (s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    const formatDate = (ms: number) =>
      new Date(ms).toLocaleDateString('es-CO', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      });

    const propertyLine = data.propertyTitle
      ? `<p style="margin:0 0 8px;font-size:14px;color:#333;"><strong>Finca:</strong> ${esc(data.propertyTitle)}</p>`
      : '';
    const guestsLine =
      data.guests != null && data.guests > 0
        ? `<p style="margin:0 0 8px;font-size:14px;color:#333;"><strong>Huéspedes:</strong> ${data.guests}</p>`
        : '';

    const checkInStr = data.checkIn ? formatDate(data.checkIn) : '—';
    const checkOutStr = data.checkOut ? formatDate(data.checkOut) : '—';
    const nights = data.nights ?? 0;

    const htmlContent = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f7f9;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7f9;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.06);max-width:600px;width:100%;">
        <tr><td style="background:#1a73e8;padding:32px 24px;text-align:center;">
          <img src="${esc(logoUrl)}" alt="FincasYa" style="max-width:160px;height:auto;">
          <h1 style="margin:12px 0 0;font-size:22px;color:#ffffff;font-weight:700;">Nueva reserva confirmada</h1>
        </td></tr>
        <tr><td style="padding:40px;">
          <p style="margin:0 0 16px;font-size:16px;color:#333;line-height:1.6;">
            Estimado/a ${esc(data.ownerTratamiento)} <strong>${esc(data.ownerName)}</strong>,
          </p>
          <p style="margin:0 0 20px;font-size:15px;color:#555;line-height:1.6;">
            El pago de una reserva en tu finca fue confirmado. Ingresa al portal de anfitrión para
            <strong>confirmar la reserva</strong> y revisar los detalles.
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f9fb;border-radius:8px;margin-bottom:24px;">
            <tr><td style="padding:20px 24px;">
              ${propertyLine}
              <p style="margin:0 0 8px;font-size:14px;color:#333;"><strong>Cliente:</strong> ${esc(data.clientName)}</p>
              <p style="margin:0 0 8px;font-size:14px;color:#333;"><strong>Entrada:</strong> ${esc(checkInStr)}</p>
              <p style="margin:0 0 8px;font-size:14px;color:#333;"><strong>Salida:</strong> ${esc(checkOutStr)}</p>
              <p style="margin:0 0 8px;font-size:14px;color:#333;"><strong>Noches:</strong> ${nights}</p>
              ${guestsLine}
              <p style="margin:0;font-size:14px;color:#333;"><strong>Referencia:</strong> ${esc(data.bookingReference)}</p>
            </td></tr>
          </table>
          <table cellpadding="0" cellspacing="0" style="margin:0 auto 24px;">
            <tr><td style="background:#1a73e8;border-radius:8px;">
              <a href="${esc(data.anfitrionUrl)}" style="display:inline-block;padding:14px 32px;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;">Confirmar reserva</a>
            </td></tr>
          </table>
          <p style="font-size:13px;color:#718096;margin:0;line-height:1.6;">Si el botón no funciona, copia este enlace:</p>
          <p style="font-size:12px;color:#1a73e8;margin:8px 0 0;word-break:break-all;"><a href="${esc(data.anfitrionUrl)}" style="color:#1a73e8;">${esc(data.anfitrionUrl)}</a></p>
        </td></tr>
        <tr><td style="background:#fafbfc;padding:24px 40px;text-align:center;font-size:13px;color:#718096;border-top:1px solid #edf2f7;">
          FincasYa — Experiencias inolvidables
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

    try {
      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sender: { name: this.senderName, email: this.senderEmail },
          to: [{ email: ownerEmail, name: data.ownerName }],
          subject: `Nueva reserva confirmada — confirma en FincasYa (${data.bookingReference})`,
          htmlContent,
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || 'Error enviando email de anfitrión al propietario');
      }
      this.logger.log(
        `[sale-link] Pago validado: correo de anfitrión enviado a ${ownerEmail}`,
      );
    } catch (error) {
      this.logger.error(
        `[sale-link] Error enviando anfitrión al propietario: ${error.message}`,
      );
    }
  }
}
