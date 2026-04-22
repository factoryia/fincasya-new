import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';

@Injectable()
export class ConvexAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();

    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      if (this.isValidTokenFormat(token)) {
        return true;
      }
    }

    // Fallback: header X-Auth-Token (útil cuando las cookies no se envían cross-origin)
    const xToken = (req.headers['x-auth-token'] ?? req.headers['X-Auth-Token']) as string | undefined;
    if (xToken && this.isValidTokenFormat(xToken.trim())) {
      return true;
    }

    const cookieHeader = (req.headers.cookie ?? (req.headers as any)['Cookie'] ?? '') as string;
    if (cookieHeader) {
      const pairs = cookieHeader.split(';').map((s) => s.trim());
      for (const pair of pairs) {
        const eq = pair.indexOf('=');
        if (eq === -1) continue;
        const name = pair.slice(0, eq).trim();
        const value = pair.slice(eq + 1).trim();
        const nameLower = name.toLowerCase();
        if (nameLower === 'better-auth.convex_jwt' || nameLower.endsWith('.convex_jwt')) {
          const token = this.safeDecode(value);
          if (token && this.isValidTokenFormat(token)) {
            return true;
          }
        }
      }
    }

    throw new UnauthorizedException(
      'No autorizado. Envía la cookie better-auth.convex_jwt, el header Authorization: Bearer <jwt> o X-Auth-Token: <jwt>. Si usas el navegador desde otro origen, incluye credentials: "include" en fetch.',
    );
  }

  private isValidTokenFormat(token: string): boolean {
    return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token);
  }

  private safeDecode(value: string): string | null {
    try {
      return value ? decodeURIComponent(value) : null;
    } catch {
      return value || null;
    }
  }
}

