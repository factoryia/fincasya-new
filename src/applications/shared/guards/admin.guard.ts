import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from '../../auth/auth.service';
import { UserRole } from '../constants/user-role';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const cookies = (req.headers.cookie ??
      (req.headers as any)['Cookie'] ??
      '') as string;

    if (!cookies) {
      throw new ForbiddenException(
        'No se encontraron cookies de sesión. Inicia sesión como administrador.',
      );
    }

    try {
      const result = await this.authService.getSession(cookies);
      const data = result?.data ?? result;
      const user = data?.user;
      const role = user?.role ?? UserRole.ASSISTANT;

      if (role !== UserRole.ADMIN) {
        throw new ForbiddenException(
          `Acceso denegado. Se requiere rol "admin". Tu rol actual: ${role ?? 'user'}.`,
        );
      }

      return true;
    } catch (err) {
      if (err instanceof ForbiddenException) throw err;
      throw new ForbiddenException('No se pudo verificar el rol del usuario.');
    }
  }
}
