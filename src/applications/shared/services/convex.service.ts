import { BadGatewayException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../../../../convex/_generated/api';

@Injectable()
export class ConvexService {
  private client: ConvexHttpClient;

  constructor() {
    const convexUrl = process.env.CONVEX_URL || 'https://adventurous-octopus-651.convex.cloud';
    this.client = new ConvexHttpClient(convexUrl);
  }

  async query(path: string, args: Record<string, unknown> = {}, token?: string): Promise<unknown> {
    const [module, functionName] = path.split(':');
    const fullPath = (api as any)[module]?.[functionName];
    if (!fullPath) {
      throw new Error(`Query not found: ${path}`);
    }
    if (token) {
      const convexUrl = process.env.CONVEX_URL || 'https://adventurous-octopus-651.convex.cloud';
      const res = await fetch(`${convexUrl}/api/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ path, args, format: 'json' }),
      });
      if (!res.ok) {
        const err = await res.text();
        if (res.status === 401) {
          throw new UnauthorizedException('Token de Convex inválido o expirado.');
        }
        throw new Error(`Convex query failed: ${res.status} ${err}`);
      }
      const data = (await res.json()) as { status: string; value?: unknown };
      return data.value;
    }
    return this.client.query(fullPath, args);
  }

  async mutation(path: string, args: any) {
    const [module, functionName] = path.split(':');
    const fullPath = (api as any)[module]?.[functionName];
    if (!fullPath) {
      throw new Error(`Mutation not found: ${path}`);
    }
    return this.client.mutation(fullPath, args);
  }

  /**
   * Ejecuta una action de Convex (vía HTTP runAction).
   * Necesario para knowledge:addFile y otras actions que pueden recibir bytes.
   */
  async action(path: string, args: Record<string, unknown>, token?: string): Promise<unknown> {
    const convexUrl = process.env.CONVEX_URL || 'https://adventurous-octopus-651.convex.cloud';
    const auth = token ?? (this.client as any)._auth?.();
    const res = await fetch(`${convexUrl}/api/action`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
      },
      body: JSON.stringify({ path, args, format: 'json' }),
    });
    if (!res.ok) {
      const err = await res.text();
      const isHtml = err.trimStart().startsWith('<!');
      if (res.status === 401) {
        throw new UnauthorizedException(
          'Token de Convex inválido o expirado. Usa el valor real de la cookie better-auth.convex_jwt (tras iniciar sesión), no el placeholder TU_JWT.',
        );
      }
      if (res.status === 502 || res.status === 503) {
        throw new BadGatewayException(
          'El servicio de Convex no está disponible. Intenta de nuevo en unos minutos.',
        );
      }
      if (res.status === 524) {
        throw new BadGatewayException(
          'La operación tardó demasiado (timeout). Prueba con un archivo más pequeño o inténtalo de nuevo.',
        );
      }
      throw new Error(isHtml ? `Convex action failed: ${res.status}` : `Convex action failed: ${res.status} ${err}`);
    }
    const data = (await res.json()) as { status: string; value?: unknown; errorMessage?: string };
    if (data.status === 'error') {
      throw new Error(data.errorMessage ?? 'Convex action error');
    }
    return data.value;
  }

  setAuth(token: string) {
    this.client.setAuth(token);
  }

  clearAuth() {
    this.client.clearAuth();
  }
}
