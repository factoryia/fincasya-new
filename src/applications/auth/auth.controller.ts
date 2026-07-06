import {
  Controller,
  Post,
  Body,
  Get,
  Req,
  Res,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ConvexAuthGuard } from '../shared/guards/convex-auth.guard';
import { AdminGuard } from '../shared/guards/admin.guard';

function clientIp(req: Request): string | undefined {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]?.trim();
  }
  return req.ip || undefined;
}

function clientUserAgent(req: Request): string | undefined {
  const ua = req.headers['user-agent'];
  return typeof ua === 'string' ? ua.slice(0, 512) : undefined;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  async register(
    @Body() registerDto: RegisterDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    try {
      const result = await this.authService.register(
        registerDto,
        req.headers.cookie || '',
      );
      // Copiar cookies de la respuesta de Better Auth
      const setCookieHeaders = result.headers?.['set-cookie'];
      if (setCookieHeaders) {
        const cookies = Array.isArray(setCookieHeaders)
          ? setCookieHeaders
          : [setCookieHeaders];
        // Establecer cada cookie individualmente
        cookies.forEach((cookie: string) => {
          if (cookie) {
            res.append('Set-Cookie', cookie);
          }
        });
      }
      return res.json(result.data || result);
    } catch (error: any) {
      return res.status(400).json({ message: error.message });
    }
  }

  @Post('login')
  async login(
    @Body() loginDto: LoginDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    try {
      const result = await this.authService.login(
        loginDto,
        req.headers.cookie || '',
        {
          ipAddress: clientIp(req),
          userAgent: clientUserAgent(req),
        },
      );
      // Copiar cookies de la respuesta de Better Auth
      const setCookieHeaders = result.headers?.['set-cookie'];
      if (setCookieHeaders) {
        const cookies = Array.isArray(setCookieHeaders)
          ? setCookieHeaders
          : [setCookieHeaders];
        // Establecer cada cookie individualmente usando append para múltiples valores
        cookies.forEach((cookie: string) => {
          if (cookie) {
            res.append('Set-Cookie', cookie);
          }
        });
      }
      return res.json(result.data || result);
    } catch (error: any) {
      return res.status(401).json({ message: error.message });
    }
  }

  @Get('session')
  async getSession(@Req() req: Request, @Res() res: Response) {
    try {
      const result = await this.authService.getSession(
        req.headers.cookie || '',
        req.headers.authorization,
      );
      const { _headers, ...data } = result as Record<string, unknown>;
      if (
        _headers &&
        typeof _headers === 'object' &&
        'set-cookie' in _headers
      ) {
        const setCookie = (_headers as Record<string, unknown>)['set-cookie'];
        const cookies = Array.isArray(setCookie)
          ? setCookie
          : setCookie
            ? [setCookie]
            : [];
        cookies.forEach((c: unknown) => {
          if (typeof c === 'string' && c) res.append('Set-Cookie', c);
        });
      }
      return res.json(data);
    } catch (error: any) {
      return res.status(401).json({ message: error.message });
    }
  }

  @Post('refresh')
  async refresh(@Req() req: Request, @Res() res: Response) {
    try {
      const result = await this.authService.refresh(
        req.headers.cookie || '',
        req.headers.authorization,
      );
      const { _headers, ...data } = result as Record<string, unknown>;
      if (
        _headers &&
        typeof _headers === 'object' &&
        'set-cookie' in _headers
      ) {
        const setCookie = (_headers as Record<string, unknown>)['set-cookie'];
        const cookies = Array.isArray(setCookie)
          ? setCookie
          : setCookie
            ? [setCookie]
            : [];
        cookies.forEach((c: unknown) => {
          if (typeof c === 'string' && c) res.append('Set-Cookie', c);
        });
      }
      return res.json(data);
    } catch (error: any) {
      return res.status(401).json({ message: error.message });
    }
  }

  @Post('logout')
  async logout(@Req() req: Request, @Res() res: Response) {
    try {
      const result = await this.authService.logout(
        req.headers.cookie || '',
        req.headers.authorization,
        {
          ipAddress: clientIp(req),
          userAgent: clientUserAgent(req),
        },
      );
      // Copiar cookies de la respuesta de Better Auth (para limpiar la sesión)
      const setCookieHeaders = result.headers?.['set-cookie'];
      if (setCookieHeaders) {
        const cookies = Array.isArray(setCookieHeaders)
          ? setCookieHeaders
          : [setCookieHeaders];
        cookies.forEach((cookie: string) => {
          if (cookie) {
            res.append('Set-Cookie', cookie);
          }
        });
      }
      // Asegurarnos de eliminar las cookies locales de Better Auth
      const incomingCookies = req.headers.cookie;
      if (incomingCookies) {
        const cookieNames = incomingCookies
          .split(';')
          .map((c) => c.trim().split('=')[0]);
        cookieNames.forEach((name) => {
          if (name.startsWith('better-auth.')) {
            res.clearCookie(name, {
              path: '/',
              httpOnly: true,
              secure: true,
              sameSite: 'lax',
            });
          }
        });
      }
      return res.json(result.data || result);
    } catch (error: any) {
      return res.status(400).json({ message: error.message });
    }
  }

  @Post('sign-out')
  async signOut(@Req() req: Request, @Res() res: Response) {
    // Alias para logout para mantener compatibilidad con Better Auth
    return this.logout(req, res);
  }

  @Get('me')
  async getCurrentUser(@Req() req: Request, @Res() res: Response) {
    try {
      const user = await this.authService.getCurrentUser(
        req.headers.cookie || '',
        req.headers.authorization,
      );
      return res.json(user);
    } catch (error: any) {
      return res.status(401).json({ message: error.message });
    }
  }

  /**
   * Devuelve el JWT de Convex (cookie `better-auth.convex_jwt`) para clientes
   * que no pueden leer cookies (React Native). El móvil llama a este endpoint
   * después del login y pasa el token a ConvexReactClient.setAuth().
   */
  @Get('convex-token')
  convexToken(@Req() req: Request, @Res() res: Response) {
    const cookies = req.headers.cookie || '';
    const match = cookies.match(/better-auth\.convex_jwt=([^;]+)/);
    if (!match) {
      return res.status(401).json({ token: null });
    }
    return res.json({ token: decodeURIComponent(match[1]) });
  }

  /** Historial de accesos al panel (solo admin). */
  @Get('session-logs')
  @UseGuards(ConvexAuthGuard, AdminGuard)
  async listSessionLogs(
    @Query('limit') limit?: string,
    @Query('userId') userId?: string,
  ) {
    const parsed = Number(limit);
    return this.authService.listSessionLogs({
      limit: Number.isFinite(parsed) ? parsed : 100,
      userId: userId?.trim() || undefined,
    });
  }
}
