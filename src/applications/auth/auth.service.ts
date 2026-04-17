import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { ConvexService } from '../shared/services/convex.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import * as https from 'https';
import { URL } from 'url';

@Injectable()
export class AuthService {
  private readonly betterAuthUrl: string;

  constructor(private readonly convexService: ConvexService) {
    this.betterAuthUrl =
      process.env.CONVEX_SITE_URL ||
      'https://adventurous-octopus-651.convex.site';
  }

  private async makeRequest(
    url: string,
    options: {
      method?: string;
      body?: string;
      headers?: Record<string, string>;
      cookies?: string;
      authorization?: string;
    } = {},
  ) {
    return new Promise<any>((resolve, reject) => {
      const urlObj = new URL(url);
      const requestOptions: any = {
        hostname: urlObj.hostname,
        port: urlObj.port || 443,
        path: urlObj.pathname + urlObj.search,
        method: options.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
      };

      // Agregar cookies si están presentes
      if (options.cookies) {
        requestOptions.headers['Cookie'] = options.cookies;
      }

      // Agregar authorization header
      if (options.authorization) {
        requestOptions.headers['Authorization'] = options.authorization;
      }

      if (options.body) {
        requestOptions.headers['Content-Length'] = Buffer.byteLength(
          options.body,
        ).toString();
      }

      const req = https.request(requestOptions, (res) => {
        let data = '';
        const responseHeaders: any = {};

        // Capturar headers de respuesta, especialmente Set-Cookie
        Object.keys(res.headers).forEach((key) => {
          const lowerKey = key.toLowerCase();
          // Set-Cookie puede venir como array, mantenerlo como array
          if (lowerKey === 'set-cookie') {
            responseHeaders[lowerKey] = Array.isArray(res.headers[key])
              ? res.headers[key]
              : [res.headers[key]];
          } else {
            responseHeaders[lowerKey] = res.headers[key];
          }
        });

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            if (
              res.statusCode &&
              res.statusCode >= 200 &&
              res.statusCode < 300
            ) {
              const jsonData = data ? JSON.parse(data) : {};
              resolve({ data: jsonData, headers: responseHeaders });
            } else {
              let errorData: any;
              try {
                errorData = data ? JSON.parse(data) : {};
              } catch {
                errorData = {
                  message:
                    data || `HTTP ${res.statusCode}: ${res.statusMessage}`,
                };
              }
              const errorMessage =
                errorData.message ||
                errorData.error ||
                `HTTP ${res.statusCode}: ${res.statusMessage}`;
              reject(new Error(errorMessage));
            }
          } catch (error: any) {
            reject(new Error(`Error parsing response: ${error.message}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(new Error(`Request error: ${error.message}`));
      });

      if (options.body) {
        req.write(options.body);
      }

      req.end();
    });
  }

  async register(registerDto: RegisterDto, cookies: string) {
    try {
      const result = await this.makeRequest(
        `${this.betterAuthUrl}/api/auth/sign-up/email`,
        {
          method: 'POST',
          body: JSON.stringify({
            email: registerDto.email,
            password: registerDto.password,
            name: registerDto.name,
            documentId: registerDto.documentId,
            phone: registerDto.phone,
            city: registerDto.city,
            address: registerDto.address,
          }),


          cookies,
          headers: {
            Origin: process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
          },
        },
      );
      return this.ensureUserRoleInResponse(result);
    } catch (error: any) {
      // Log del error completo para debugging
      console.error('Register error:', error.message);
      throw new BadRequestException(
        error.message || 'Error al registrar usuario',
      );
    }
  }

  async login(loginDto: LoginDto, cookies: string) {
    try {
      const result = await this.makeRequest(
        `${this.betterAuthUrl}/api/auth/sign-in/email`,
        {
          method: 'POST',
          body: JSON.stringify({
            email: loginDto.email,
            password: loginDto.password,
          }),
          cookies,
          headers: {
            Origin: process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
          },
        },
      );
      return this.ensureUserRoleInResponse(result);
    } catch (error: any) {
      throw new UnauthorizedException(
        error.message || 'Error al iniciar sesión',
      );
    }
  }

  async getSession(cookies: string, authorization?: string) {
    try {
      if (!cookies && !authorization) {
        throw new UnauthorizedException('No se proporcionaron credenciales');
      }

      // Intentar obtener la sesión desde Better Auth
      // Si falla, intentar usar Convex directamente
      try {
        const result = await this.makeRequest(
          `${this.betterAuthUrl}/api/auth/get-session`,
          {
            method: 'GET',
            cookies,
            authorization,
          },
        );
        const data = result.data || result;
        const body = this.ensureUserRoleInData(data);
        return { ...body, _headers: result.headers };
      } catch (error: any) {
        // Si Better Auth no tiene endpoint de sesión, usar Convex
        const cookieMatch = cookies.match(/better-auth\.convex_jwt=([^;]+)/);
        if (cookieMatch) {
          const convexJwt = cookieMatch[1];
          this.convexService.setAuth(convexJwt);
          const user = await this.convexService.query(
            'auth:getCurrentUser',
            {},
          );
          if (user) {
            return this.ensureUserRoleInData({
              user,
              session: { token: convexJwt },
            });
          }
        }
        throw error;
      }
    } catch (error: any) {
      console.error('GetSession error:', error.message);
      throw new UnauthorizedException(
        error.message || 'Error al obtener sesión',
      );
    }
  }

  async refresh(cookies: string, authorization?: string) {
    try {
      if (!cookies && !authorization) {
        throw new UnauthorizedException('No se proporcionaron credenciales');
      }

      const result = await this.makeRequest(
        `${this.betterAuthUrl}/api/auth/get-session`,
        {
          method: 'GET',
          cookies,
          authorization,
        },
      );

      const data = result.data || result;
      const body = this.ensureUserRoleInData(data);
      return { ...body, _headers: result.headers };
    } catch (error: any) {
      console.error('Refresh error:', error.message);
      throw new UnauthorizedException(
        error.message || 'Error al refrescar la sesión',
      );
    }
  }

  async logout(cookies: string, authorization?: string) {
    try {
      const result = await this.makeRequest(
        `${this.betterAuthUrl}/api/auth/sign-out`,
        {
          method: 'POST',
          body: JSON.stringify({}),
          cookies,
          authorization,
          headers: {
            Origin: process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
          },
        },
      );
      return result;
    } catch (error: any) {
      throw new BadRequestException(error.message || 'Error al cerrar sesión');
    }
  }

  async getCurrentUser(cookies: string, authorization?: string) {
    try {
      if (!cookies && !authorization) {
        throw new UnauthorizedException('No se proporcionaron credenciales');
      }

      // Intentar obtener usuario desde Better Auth usando el header API OAuth
      try {
        const result = await this.makeRequest(
          `${this.betterAuthUrl}/api/auth/get-session`,
          {
            method: 'GET',
            cookies,
            authorization,
          },
        );
        if (result.data?.user) {
          return this.ensureUserRole(result.data.user);
        }
      } catch (e) {
        // Ignorar y caer al fallback de Convex
      }

      // Si no pudimos obtener con Better Auth, es posible que el cookie sea el especial de Convex
      if (!cookies) {
        throw new UnauthorizedException('No hay credenciales válidas');
      }

      // Extraer el JWT de Convex de las cookies
      const cookieMatch = cookies.match(/better-auth\.convex_jwt=([^;]+)/);
      if (!cookieMatch) {
        throw new UnauthorizedException(
          'No se encontró el token de Convex en las cookies',
        );
      }

      const convexJwt = cookieMatch[1];

      // Usar Convex directamente para obtener el usuario actual
      this.convexService.setAuth(convexJwt);
      const user = await this.convexService.query('auth:getCurrentUser', {});

      if (!user) {
        throw new UnauthorizedException('No se pudo obtener el usuario');
      }

      return this.ensureUserRole(user);
    } catch (error: any) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      console.error('GetCurrentUser error:', error.message);
      throw new UnauthorizedException(
        'Error al obtener usuario actual: ' + error.message,
      );
    }
  }

  /** Asegura que user.role esté definido; por defecto "user". Para getCurrentUser (objeto plano) o { user }. */
  private ensureUserRole<T>(obj: T): T {
    if (!obj || typeof obj !== 'object') return obj;
    const o = obj as Record<string, unknown>;
    if ('user' in o && o.user && typeof o.user === 'object') {
      const u = o.user as Record<string, unknown>;
      if (u.role === undefined || u.role === null) u.role = 'user';
    } else if (o.role === undefined || o.role === null) {
      o.role = 'user';
    }
    return obj;
  }

  /** Asegura que user.role esté en la data (sesión o respuesta con user en cualquier nivel). */
  private ensureUserRoleInData<T extends Record<string, unknown>>(data: T): T {
    if (data?.user && typeof data.user === 'object') {
      const u = data.user as Record<string, unknown>;
      if (u.role === undefined || u.role === null) u.role = 'user';
    }
    return data;
  }

  /** Para respuestas de Better Auth: { data: { user? }, headers } o { user }. */
  private ensureUserRoleInResponse<T extends Record<string, unknown>>(
    res: T,
  ): T {
    const data = res?.data;
    if (data && typeof data === 'object') {
      this.ensureUserRoleInData(data as Record<string, unknown>);
    }
    if (res?.user && typeof res.user === 'object') {
      const u = res.user as Record<string, unknown>;
      if (u.role === undefined || u.role === null) u.role = 'user';
    }
    return res;
  }
}
