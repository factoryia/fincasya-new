require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: '.env' });

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/applications/app.module';
import { BrevoEmailService } from '../src/applications/shared/services/brevo-email.service';

async function bootstrap() {
  console.log('🚀 Iniciando script de prueba de correo de recordatorio...');
  
  try {
    const app = await NestFactory.createApplicationContext(AppModule);
    const emailService = app.get(BrevoEmailService);

    const testEmail = 'jamesrgal@gmail.com';
    const testData = {
      clientEmail: testEmail,
      clientName: 'James Galvis (Test)',
      propertyTitle: 'Finca La Esperanza - Premium',
      checkInDate: 'Sábado, 25 de Abril de 2026',
      checkInTime: '03:00 PM',
      reference: 'TEST-REM-123',
    };

    console.log(`📧 Enviando correo de prueba a: ${testEmail}...`);
    
    await emailService.sendReservationReminder(testData);

    console.log('✅ Correo enviado exitosamente. ¡Revisa tu bandeja de entrada!');
    await app.close();
  } catch (error) {
    console.error('❌ Error enviando el correo de prueba:', error);
    process.exit(1);
  }
}

bootstrap();
