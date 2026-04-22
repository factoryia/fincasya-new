/**
 * Email Templates for FincasYa
 * Estilo Premium: Enfoque en legibilidad, jerarquía visual y branding "FincasYa".
 */

interface BaseLayoutProps {
  logoUrl: string;
  preheader?: string;
  content: string;
  footerText?: string;
}

const getBaseLayout = ({ logoUrl, preheader, content, footerText }: BaseLayoutProps) => `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FincasYa Notification</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
  <style>
    body { 
      margin: 0; 
      padding: 0; 
      width: 100% !important; 
      -webkit-text-size-adjust: 100%; 
      -ms-text-size-adjust: 100%; 
      background-color: #f4f7f9;
      font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    }
    img { border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
    table { border-collapse: collapse !important; }
    
    .container { 
      max-width: 600px; 
      margin: 0 auto; 
      background-color: #ffffff; 
      border-radius: 16px;
      overflow: hidden;
      margin-top: 40px;
      margin-bottom: 40px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.05);
    }
    
    .header { 
      background-color: #000000; 
      padding: 40px 20px; 
      text-align: center; 
    }
    .header img { 
      max-width: 160px; 
      height: auto; 
    }
    
    .main-content { 
      padding: 40px 40px 30px 40px; 
    }
    
    .footer { 
      background-color: #fafbfc; 
      padding: 30px 40px; 
      text-align: center; 
      font-size: 13px; 
      color: #718096; 
      border-top: 1px solid #edf2f7; 
    }
    
    .btn { 
      display: inline-block; 
      padding: 18px 36px; 
      background-color: #f15a24; 
      color: #ffffff !important; 
      text-decoration: none; 
      border-radius: 12px; 
      font-weight: 700; 
      margin: 30px 0; 
      text-transform: uppercase; 
      letter-spacing: 1px;
      font-size: 14px;
      box-shadow: 0 4px 12px rgba(241, 90, 36, 0.3);
    }
    
    .title { 
      color: #1a202c; 
      font-size: 28px; 
      font-weight: 800; 
      margin-bottom: 24px; 
      text-align: center; 
      line-height: 1.25; 
      letter-spacing: -0.5px;
    }
    
    .subtitle {
      color: #4a5568;
      font-size: 16px;
      line-height: 1.6;
      margin-bottom: 24px;
      text-align: center;
    }
    
    .card { 
      background-color: #ffffff; 
      border: 1px solid #e2e8f0; 
      border-radius: 16px; 
      padding: 30px; 
      margin: 25px 0; 
      border-top: 4px solid #f15a24; 
    }
    
    .instruction-item { 
      margin-bottom: 20px; 
      font-size: 15px; 
      color: #2d3748;
      display: flex;
      align-items: flex-start;
    }
    
    .icon-box {
      width: 24px;
      margin-right: 12px;
      text-align: center;
      font-size: 18px;
    }
    
    .detail-table {
      width: 100%;
      margin: 20px 0;
    }
    .detail-row td {
      padding: 12px 0;
      border-bottom: 1px solid #f1f5f9;
      font-size: 14px;
    }
    .detail-label {
      font-weight: 600;
      color: #718096;
      width: 40%;
    }
    .detail-value {
      color: #1a202c;
      text-align: right;
      font-weight: 500;
    }
    
    .alert-box {
      padding: 20px;
      background-color: #fffaf0;
      border-radius: 12px;
      border-left: 4px solid #fbd38d;
      color: #c05621;
      font-size: 14px;
      margin-top: 30px;
    }
    
    .preheader {
      display: none;
      max-height: 0px;
      overflow: hidden;
      mso-hide: all;
    }

    @media only screen and (max-width: 620px) {
      .container { width: 100% !important; border-radius: 0; margin-top: 0; margin-bottom: 0; }
      .main-content { padding: 30px 20px; }
      .title { font-size: 24px; }
    }
  </style>
</head>
<body>
  ${preheader ? `<div class="preheader">${preheader}</div>` : ''}
  <div class="container">
    <div class="header">
      <img src="${logoUrl}" alt="FincasYa Logo">
    </div>
    <div class="main-content">
      ${content}
    </div>
    <div class="footer">
      <p style="margin-bottom: 15px;"><strong>FincasYa - Experiencias inolvidables.</strong></p>
      <div style="margin-bottom: 15px;">
        <a href="https://fincasya.com" style="color: #f15a24; text-decoration: none; margin: 0 10px;">Sitio Web</a>
        <a href="#" style="color: #f15a24; text-decoration: none; margin: 0 10px;">Mis Viajes</a>
        <a href="#" style="color: #f15a24; text-decoration: none; margin: 0 10px;">Soporte</a>
      </div>
      <p style="font-size: 11px; line-height: 1.5; color: #a0aec0;">
        &copy; ${new Date().getFullYear()} FincasYa. Todos los derechos reservados.<br>
        ${footerText || 'Has recibido este correo porque realizaste una reserva en nuestra plataforma.'}<br>
        No respondas a este mensaje, es una notificación automática.
      </p>
    </div>
  </div>
</body>
</html>
`;

export const getClientConfirmationTemplate = (data: {
  logoUrl: string;
  clientName: string;
  propertyTitle: string;
  reference: string;
  contractUrl: string;
}) => {
  const preheader = `¡Acción requerida! Descarga tu contrato para la reserva en ${data.propertyTitle}.`;
  
  const content = `
    <div class="title">¡Tu reserva en <span style="color: #f15a24">${data.propertyTitle}</span> está casi lista! 🎉</div>
    
    <div class="subtitle">
      Hola <strong>${data.clientName}</strong>, nos alegra confirmarte que hemos recibido tu reserva con éxito. 
      Sigue estos pasos finales para asegurar tu estancia.
    </div>
    
    <div class="card">
      <div style="font-size: 18px; font-weight: 700; margin-bottom: 20px; color: #1a202c;">Próximos Pasos Obligatorios</div>
      
      <div class="instruction-item">
        <div class="icon-box">📄</div>
        <div><strong>Descarga el contrato</strong> usando el botón de abajo o el archivo adjunto.</div>
      </div>
      
      <div class="instruction-item">
        <div class="icon-box">✍️</div>
        <div><strong>Fírmalo</strong> manuscritamente o con una herramienta de firma digital.</div>
      </div>
      
      <div class="instruction-item">
        <div class="icon-box">📸</div>
        <div><strong>Sube tu documentación:</strong> Ingresa a "Mis Viajes" y carga el contrato firmado junto con la foto de tu cédula.</div>
      </div>
    </div>

    <div style="text-align: center;">
      <a href="${data.contractUrl}" class="btn">Descargar Contrato</a>
    </div>

    <div class="alert-box">
      <strong>💡 Importante:</strong> Tres días antes de tu reserva, te enviaremos un correo con la ubicación exacta de la finca, contraseñas de WiFi y detalles adicionales para tu llegada.
    </div>
    
    <p style="text-align: center; color: #718096; font-size: 13px; margin-top: 30px;">
      Referencia de reserva: <span style="font-family: monospace; font-weight: bold; color: #1a202c;">${data.reference}</span>
    </p>
  `;

  return getBaseLayout({ logoUrl: data.logoUrl, preheader, content });
};

export const getAdminNotificationTemplate = (data: {
  logoUrl: string;
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  propertyTitle: string;
  checkInDate: string;
  checkOutDate: string;
  totalAmount: number;
  reference: string;
}) => {
  const preheader = `Nueva reserva confirmada: ${data.propertyTitle} por ${data.clientName}.`;
  
  const content = `
    <div class="title" style="text-align: left; font-size: 24px;">🚀 Nueva Reserva Recibida</div>
    <p style="color: #4a5568;">Se ha validado satisfactoriamente el depósito inicial del 50% para la siguiente propiedad.</p>
    
    <div class="card" style="border-top-color: #1a202c;">
      <div style="font-size: 16px; font-weight: 700; margin-bottom: 20px; color: #1a202c; border-bottom: 2px solid #f15a24; padding-bottom: 8px; display: inline-block;">
        RESUMEN DE RESERVA
      </div>
      
      <table class="detail-table">
        <tr class="detail-row">
          <td class="detail-label">Propiedad</td>
          <td class="detail-value">${data.propertyTitle}</td>
        </tr>
        <tr class="detail-row">
          <td class="detail-label">Cliente</td>
          <td class="detail-value">${data.clientName}</td>
        </tr>
        <tr class="detail-row">
          <td class="detail-label">Email</td>
          <td class="detail-value">${data.clientEmail}</td>
        </tr>
        <tr class="detail-row">
          <td class="detail-label">Teléfono</td>
          <td class="detail-value">${data.clientPhone}</td>
        </tr>
        <tr class="detail-row">
          <td class="detail-label">Fechas</td>
          <td class="detail-value">${data.checkInDate} - ${data.checkOutDate}</td>
        </tr>
        <tr class="detail-row" style="border-bottom: none;">
          <td class="detail-label">Total Gral.</td>
          <td class="detail-value" style="font-size: 20px; color: #f15a24; font-weight: 800;">$${data.totalAmount.toLocaleString('es-CO')}</td>
        </tr>
      </table>
      
      <div style="margin-top: 15px; font-size: 12px; color: #a0aec0; text-align: center;">
        REF: ${data.reference}
      </div>
    </div>

    <div style="text-align: center; margin-top: 30px;">
      <a href="https://admin.fincasya.com" style="color: #f15a24; font-weight: 600; text-decoration: none;">Ver en el Panel Administrador &rarr;</a>
    </div>
  `;

  return getBaseLayout({
    logoUrl: data.logoUrl,
    preheader,
    content,
    footerText: 'Has recibido este correo como parte de las notificaciones administrativas de FincasYa.',
  });
};

export const getReminderTemplate = (data: {
  logoUrl: string;
  clientName: string;
  propertyTitle: string;
  checkInDate: string;
  checkInTime: string;
  reference: string;
}) => {
  const preheader = `¡Faltan 3 días para tu reserva en ${data.propertyTitle}! Revisa los detalles de llegada.`;

  const content = `
    <div class="title">¡Tu aventura en <span style="color: #f15a24">${data.propertyTitle}</span> comienza pronto! 🏡</div>
    
    <div class="subtitle">
      Hola <strong>${data.clientName}</strong>, falta muy poco para tu llegada. 
      Queremos asegurarnos de que tengas todo listo para una experiencia inolvidable.
    </div>
    
    <div class="card">
      <div style="font-size: 18px; font-weight: 700; margin-bottom: 20px; color: #1a202c; border-bottom: 2px solid #f15a24; padding-bottom: 8px; display: inline-block;">
        DETALLES DE TU LLEGADA
      </div>
      
      <table class="detail-table">
        <tr class="detail-row">
          <td class="detail-label">Fecha de Entrada</td>
          <td class="detail-value">${data.checkInDate}</td>
        </tr>
        <tr class="detail-row">
          <td class="detail-label">Hora de Entrada</td>
          <td class="detail-value">${data.checkInTime}</td>
        </tr>
        <tr class="detail-row">
          <td class="detail-label">Referencia</td>
          <td class="detail-value">${data.reference}</td>
        </tr>
      </table>
      
      <div style="margin-top: 20px;">
        <div class="instruction-item">
          <div class="icon-box">📍</div>
          <div><strong>Ubicación:</strong> Puedes encontrar la ubicación exacta en la sección "Mis Viajes" de nuestra plataforma.</div>
        </div>
        <div class="instruction-item">
          <div class="icon-box">🔑</div>
          <div><strong>Acceso:</strong> El encargado de la finca te recibirá en la hora acordada. No olvides tener tu documento de identidad a la mano.</div>
        </div>
        <div class="instruction-item">
          <div class="icon-box">📶</div>
          <div><strong>WiFi:</strong> Las credenciales de acceso estarán disponibles dentro de la propiedad.</div>
        </div>
      </div>
    </div>

    <div style="text-align: center;">
      <a href="https://fincasya.com" class="btn">Ir a Mis Viajes</a>
    </div>

    <div class="alert-box">
      <strong>⚠️ Recordatorio:</strong> Si aún no has subido tu contrato firmado o la foto de tu cédula, por favor hazlo hoy mismo para evitar retrasos en tu ingreso.
    </div>
    
    <p style="text-align: center; color: #718096; font-size: 13px; margin-top: 30px;">
      Si tienes alguna duda, contáctanos a través de nuestro soporte por WhatsApp.
    </p>
  `;

  return getBaseLayout({ logoUrl: data.logoUrl, preheader, content });
};
