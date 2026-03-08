import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ConvexService } from '../shared/services/convex.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { CreateUserDto } from './dto/create-user.dto';
import * as https from 'https';
import { URL } from 'url';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class UsersService {
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

      if (options.body) {
        requestOptions.headers['Content-Length'] = Buffer.byteLength(
          options.body,
        ).toString();
      }

      const req = https.request(requestOptions, (res) => {
        let data = '';

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
              resolve({ data: jsonData });
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

  async list(limit?: number) {
    try {
      return await this.convexService.query('users:list', { limit });
    } catch (error: any) {
      throw new BadRequestException(error.message);
    }
  }

  async getById(id: string) {
    try {
      const user = await this.convexService.query('users:getById', { id });
      if (!user) {
        throw new NotFoundException('Usuario no encontrado');
      }
      return user;
    } catch (error: any) {
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException(error.message);
    }
  }

  async update(id: string, updateUserDto: UpdateUserDto) {
    try {
      const { password, ...updates } = updateUserDto;

      // Handle password update separately if provided
      if (password) {
        await this.updatePassword(id, password);
      }

      // If there are other updates, perform them
      if (Object.keys(updates).length > 0) {
        return await this.convexService.mutation('users:update', {
          id,
          ...updates,
        });
      }

      // If only password was updated, returning the user
      return await this.getById(id);
    } catch (error: any) {
      throw new BadRequestException(error.message);
    }
  }

  async remove(id: string) {
    try {
      return await this.convexService.mutation('users:remove', { id });
    } catch (error: any) {
      throw new BadRequestException(error.message);
    }
  }

  async updatePassword(userId: string, newPassword: string) {
    try {
      // Verify the user exists first
      const user = await this.convexService.query('users:getById', {
        id: userId,
      });
      if (!user) {
        throw new NotFoundException('Usuario no encontrado');
      }

      // Hash the password using bcrypt (same rounds Better Auth uses internally)
      const newPasswordHash = await bcrypt.hash(newPassword, 10);

      // Update the password in the betterAuth `account` table via Convex
      return await this.convexService.mutation('users:updatePassword', {
        userId,
        newPasswordHash,
      });
    } catch (error: any) {
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException(
        error.message || 'Error al actualizar la contraseña',
      );
    }
  }

  async create(createUserDto: CreateUserDto) {
    try {
      // 1. Crear el usuario en Better Auth (registra email, password, name)
      // Se pasa un rol temporal 'user' porque Better Auth maneja el registro seguro
      const result = await this.makeRequest(
        `${this.betterAuthUrl}/api/auth/sign-up/email`,
        {
          method: 'POST',
          body: JSON.stringify({
            email: createUserDto.email,
            password: createUserDto.password,
            name: createUserDto.name,
            role: 'user',
          }),
        },
      );

      const createdUser = result.data.user;

      if (!createdUser || !createdUser.id) {
        throw new Error('No se pudo obtener el ID del usuario creado');
      }

      // 2. Actualizar los campos adicionales llamando a la mutación updateByEmail en Convex
      const updateData: UpdateUserDto = {};
      if (createUserDto.role) updateData.role = createUserDto.role;
      if (createUserDto.phone) updateData.phone = createUserDto.phone;
      if (createUserDto.position) updateData.position = createUserDto.position;
      if (createUserDto.documentId)
        updateData.documentId = createUserDto.documentId;

      if (Object.keys(updateData).length > 0) {
        await this.convexService.mutation('users:updateByEmail', {
          email: createUserDto.email,
          ...updateData,
        });
      }

      // Retornar información consolidada (sin la contraseña)
      return {
        ...createdUser,
        ...updateData,
      };
    } catch (error: any) {
      console.error('Create User error:', error.message);
      throw new BadRequestException(
        error.message || 'Error al crear el usuario',
      );
    }
  }
}
