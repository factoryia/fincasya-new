import { Controller, Post, Body, Get, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  async register(@Body() registerDto: RegisterDto, @Req() req: Request, @Res() res: Response) {
    try {
      const result = await this.authService.register(registerDto, req.headers.cookie || '');
      // Copiar cookies de la respuesta de Better Auth
      const setCookieHeaders = result.headers?.['set-cookie'];
      if (setCookieHeaders) {
        const cookies = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
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
  async login(@Body() loginDto: LoginDto, @Req() req: Request, @Res() res: Response) {
    try {
      const result = await this.authService.login(loginDto, req.headers.cookie || '');
      // Copiar cookies de la respuesta de Better Auth
      const setCookieHeaders = result.headers?.['set-cookie'];
      if (setCookieHeaders) {
        const cookies = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
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
      const result = await this.authService.getSession(req.headers.cookie || '');
      return res.json(result);
    } catch (error: any) {
      return res.status(401).json({ message: error.message });
    }
  }

  @Post('logout')
  async logout(@Req() req: Request, @Res() res: Response) {
    try {
      const result = await this.authService.logout(req.headers.cookie || '');
      // Copiar cookies de la respuesta de Better Auth (para limpiar la sesión)
      const setCookieHeaders = result.headers?.['set-cookie'];
      if (setCookieHeaders) {
        const cookies = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
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

  @Post('sign-out')
  async signOut(@Req() req: Request, @Res() res: Response) {
    // Alias para logout para mantener compatibilidad con Better Auth
    return this.logout(req, res);
  }

  @Get('me')
  async getCurrentUser(@Req() req: Request, @Res() res: Response) {
    try {
      const user = await this.authService.getCurrentUser(req.headers.cookie || '');
      return res.json(user);
    } catch (error: any) {
      return res.status(401).json({ message: error.message });
    }
  }
}
