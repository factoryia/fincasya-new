import dotenv from 'dotenv';
import { BrevoEmailService } from '../src/applications/shared/services/brevo-email.service';

// Cargar variables de entorno de .env.local
dotenv.config({ path: '.env.local' });

async function testEmail() {
  // Instanciamos el servicio directamente ya que no tiene dependencias complejas
  const emailService = new BrevoEmailService();

  console.log('--- Probando envío de correo (Modo Directo) ---');
  console.log('Usando Sender:', (emailService as any).senderEmail);

  try {
    // Prueba para el cliente
    console.log('Enviando correo de prueba al cliente...');
    await emailService.sendBookingConfirmationToClient({
      clientEmail: 'jamesrgal@gmail.com',
      clientName: 'James Rodriguez (Test)',
      propertyTitle: 'Finca El Paraíso (Prueba)',
      reference: 'FY-TEST-123',
      contractUrl:
        'https://fincasya.s3.us-east-1.amazonaws.com/app-assets/fincas-ya-logo-2.png',
    });

    // Prueba para el administrador
    console.log('Enviando correo de prueba al administrador...');
    await emailService.sendBookingAlertToAdmin({
      clientName: 'Juan Pérez (Test)',
      clientEmail: 'jamesrgal@gmail.com',
      clientPhone: '3001234567',
      propertyTitle: 'Finca El Paraíso (Prueba)',
      checkInDate: '20-04-2026',
      checkOutDate: '25-04-2026',
      totalAmount: 5000000,
      reference: 'FY-TEST-123',
    });

    console.log('✅ Correos de prueba enviados exitosamente.');
    console.log('Revisa la bandeja de entrada de jamesrgal@gmail.com');
  } catch (err: any) {
    console.error('❌ Error enviando correos de prueba:', err.message);
    if (err.message.includes('401') || err.message.includes('Unauthorized')) {
      console.error(
        'CONSEJO: Verifica que tu BREVO_API_KEY sea válida en .env.local',
      );
    }
  }
}

testEmail();
