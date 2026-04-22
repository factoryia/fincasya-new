import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from '../../auth/auth.service';
import { UserRole } from '../constants/user-role';

@Injectable()
export class OwnerOrAdminGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const cookies = (req.headers.cookie ??
      (req.headers as any)['Cookie'] ??
      '') as string;

    if (!cookies) {
      throw new ForbiddenException(
        'No se encontraron cookies de sesión. Inicia sesión para continuar.',
      );
    }

    try {
      const result = await this.authService.getSession(cookies);
      const data = result?.data ?? result;
      const user = data?.user;
      const role = user?.role;

      const allowedRoles = [
        UserRole.ADMIN,
        UserRole.ASSISTANT,
        UserRole.VENDEDOR,
        UserRole.PROPIETARIO,
      ];

      if (!role || !allowedRoles.includes(role as UserRole)) {
        throw new ForbiddenException(
          `Acceso denegado. Rol actual: ${role ?? 'user'}.`,
        );
      }

      return true;
    } catch (err) {
      if (err instanceof ForbiddenException) throw err;
      throw new ForbiddenException('No se pudo verificar el rol del usuario.');
    }
  }
}
