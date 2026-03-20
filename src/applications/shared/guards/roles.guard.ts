import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { AuthService } from '../../auth/auth.service';
import { UserRole } from '../constants/user-role';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly authService: AuthService,
    private reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles) {
      return true;
    }

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
      const role = user?.role as UserRole;

      if (!requiredRoles.includes(role)) {
        throw new ForbiddenException(
          `Acceso denegado. Se requiere uno de los roles: ${requiredRoles.join(', ')}. Tu rol actual: ${role ?? 'user'}.`,
        );
      }

      return true;
    } catch (err) {
      if (err instanceof ForbiddenException) throw err;
      throw new ForbiddenException('No se pudo verificar el acceso del usuario.');
    }
  }
}
