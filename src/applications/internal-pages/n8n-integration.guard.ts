import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';

/**
 * Protege rutas usadas por integraciones (p. ej. n8n) con un secreto compartido.
 * Configurar en el servidor: N8N_INTEGRATION_KEY
 * Cliente: header x-n8n-integration-key con el mismo valor.
 */
@Injectable()
export class N8nIntegrationGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.N8N_INTEGRATION_KEY?.trim();
    if (!expected) {
      throw new ForbiddenException(
        'Integración n8n no configurada (falta N8N_INTEGRATION_KEY en el entorno).',
      );
    }
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers['x-n8n-integration-key'];
    const key = typeof header === 'string' ? header.trim() : '';
    if (key !== expected) {
      throw new ForbiddenException('Clave de integración inválida.');
    }
    return true;
  }
}
