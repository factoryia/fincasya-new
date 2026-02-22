import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { ConvexService } from '../shared/services/convex.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import * as https from 'https';
import { URL } from 'url';

@Injectable()
export class AuthService {
  private readonly betterAuthUrl: string;

  constructor(private readonly convexService: ConvexService) {
    this.betterAuthUrl = process.env.CONVEX_SITE_URL || 'https://adventurous-octopus-651.convex.site';
  }

  private async makeRequest(url: string, options: { method?: string; body?: string; headers?: Record<string, string>; cookies?: string } = {}) {
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

      if (options.body) {
        requestOptions.headers['Content-Length'] = Buffer.byteLength(options.body).toString();
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
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              const jsonData = data ? JSON.parse(data) : {};
              resolve({ data: jsonData, headers: responseHeaders });
            } else {
              let errorData: any;
              try {
                errorData = data ? JSON.parse(data) : {};
              } catch {
                errorData = { message: data || `HTTP ${res.statusCode}: ${res.statusMessage}` };
              }
              const errorMessage = errorData.message || errorData.error || `HTTP ${res.statusCode}: ${res.statusMessage}`;
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
      const result = await this.makeRequest(`${this.betterAuthUrl}/api/auth/sign-up/email`, {
        method: 'POST',
        body: JSON.stringify({
          email: registerDto.email,
          password: registerDto.password,
          name: registerDto.name,
        }),
        cookies,
        headers: {
          'Origin': process.env.SITE_URL || 'http://localhost:3001',
        },
      });
      return result;
    } catch (error: any) {
      // Log del error completo para debugging
      console.error('Register error:', error.message);
      throw new BadRequestException(error.message || 'Error al registrar usuario');
    }
  }

  async login(loginDto: LoginDto, cookies: string) {
    try {
      const result = await this.makeRequest(`${this.betterAuthUrl}/api/auth/sign-in/email`, {
        method: 'POST',
        body: JSON.stringify({
          email: loginDto.email,
          password: loginDto.password,
        }),
        cookies,
        headers: {
          'Origin': process.env.SITE_URL || 'http://localhost:3001',
        },
      });
      return result;
    } catch (error: any) {
      throw new UnauthorizedException(error.message || 'Error al iniciar sesión');
    }
  }

  async getSession(cookies: string) {
    try {
      if (!cookies) {
        throw new UnauthorizedException('No se proporcionaron cookies');
      }
      
      // Intentar obtener la sesión desde Better Auth
      // Si falla, intentar usar Convex directamente
      try {
        const result = await this.makeRequest(`${this.betterAuthUrl}/api/auth/session`, {
          method: 'GET',
          cookies,
        });
        return result.data || result;
      } catch (error: any) {
        // Si Better Auth no tiene endpoint de sesión, usar Convex
        const cookieMatch = cookies.match(/better-auth\.convex_jwt=([^;]+)/);
        if (cookieMatch) {
          const convexJwt = cookieMatch[1];
          this.convexService.setAuth(convexJwt);
          const user = await this.convexService.query('auth:getCurrentUser', {});
          if (user) {
            return { user, session: { token: convexJwt } };
          }
        }
        throw error;
      }
    } catch (error: any) {
      console.error('GetSession error:', error.message);
      throw new UnauthorizedException(error.message || 'Error al obtener sesión');
    }
  }

  async logout(cookies: string) {
    try {
      const result = await this.makeRequest(`${this.betterAuthUrl}/api/auth/sign-out`, {
        method: 'POST',
        body: JSON.stringify({}),
        cookies,
        headers: {
          'Origin': process.env.SITE_URL || 'http://localhost:3001',
        },
      });
      return result;
    } catch (error: any) {
      throw new BadRequestException(error.message || 'Error al cerrar sesión');
    }
  }

  async getCurrentUser(cookies: string) {
    try {
      if (!cookies) {
        throw new UnauthorizedException('No se proporcionaron cookies');
      }
      
      // Extraer el JWT de Convex de las cookies
      const cookieMatch = cookies.match(/better-auth\.convex_jwt=([^;]+)/);
      if (!cookieMatch) {
        throw new UnauthorizedException('No se encontró el token de Convex en las cookies');
      }
      
      const convexJwt = cookieMatch[1];
      
      // Usar Convex directamente para obtener el usuario actual
      this.convexService.setAuth(convexJwt);
      const user = await this.convexService.query('auth:getCurrentUser', {});
      
      if (!user) {
        throw new UnauthorizedException('No se pudo obtener el usuario');
      }
      
      return user;
    } catch (error: any) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      console.error('GetCurrentUser error:', error.message);
      throw new UnauthorizedException('Error al obtener usuario actual: ' + error.message);
    }
  }
}
