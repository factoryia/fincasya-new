// Cargar variables de entorno antes que nada (NestJS no las carga por defecto)
require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: '.env' });

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './applications/app.module';
const cookieParser = require('cookie-parser');

import { json, urlencoded } from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  app.use(json({ 
    limit: '150mb',
    verify: (req: any, res, buf) => {
      const url = req.originalUrl || req.url || '';
      if (url.includes('/payments/bold-webhook')) {
        req.rawBody = buf;
      }
    }
  }));
  app.use(urlencoded({ 
    limit: '150mb', 
    extended: true,
    verify: (req: any, res, buf) => {
      const url = req.originalUrl || req.url || '';
      if (url.includes('/payments/bold-webhook')) {
        req.rawBody = buf;
      }
    }
  }));
  
  // Establecer prefijo global para todas las rutas
  app.setGlobalPrefix('api');
  
  // Habilitar cookie parser
  app.use(cookieParser());
  
  // Habilitar CORS
  app.enableCors({
    origin: true,
    credentials: true,
  });

  // Habilitar validación global
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = process.env.PORT ?? 3001;
  await app.listen(port, '0.0.0.0');
  console.log(`[DEBUG] Application is running on: http://localhost:${port}/api - V2 Slugs Active`);
}
bootstrap();
