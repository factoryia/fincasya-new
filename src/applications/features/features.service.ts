import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ConvexService } from '../shared/services/convex.service';
import { S3Service } from '../shared/services/s3.service';

@Injectable()
export class FeaturesService {
  constructor(
    private readonly convexService: ConvexService,
    private readonly s3Service: S3Service,
  ) {}

  async list() {
    try {
      return await this.convexService.query('features:list', {});
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async getById(id: string) {
    try {
      const feature = await this.convexService.query('features:getById', {
        id,
      });
      if (!feature) {
        throw new NotFoundException('Feature no encontrada');
      }
      return feature;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException(error.message);
    }
  }

  async create(name?: string, emoji?: string, icon?: Express.Multer.File) {
    try {
      let iconUrl: string | undefined;
      if (icon) {
        iconUrl = await this.s3Service.uploadFile(icon, 'features');
      }
      return await this.convexService.mutation('features:create', {
        name,
        emoji,
        iconUrl,
      });
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async bulkUpload(files: Express.Multer.File[]) {
    try {
      // Subir todos los archivos a S3
      const uploadResults = await Promise.all(
        files.map(async (file) => {
          const iconUrl = await this.s3Service.uploadFile(file, 'features');
          // Nombre = filename sin extensión
          const name = file.originalname.replace(/\.svg$/i, '');
          return { name, iconUrl };
        }),
      );

      // Crear todos los registros en Convex
      const ids = await this.convexService.mutation('features:bulkCreate', {
        features: uploadResults,
      });

      return {
        created: uploadResults.length,
        features: uploadResults.map((f, i) => ({
          id: ids[i],
          name: f.name,
          iconUrl: f.iconUrl,
        })),
      };
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async update(
    id: string,
    name?: string,
    emoji?: string,
    icon?: Express.Multer.File,
  ) {
    try {
      // Verificar que existe
      const existing = await this.convexService.query('features:getById', {
        id,
      });
      if (!existing) {
        throw new NotFoundException('Feature no encontrada');
      }

      const updateData: Record<string, unknown> = {};
      if (name !== undefined) updateData.name = name;
      if (emoji !== undefined) updateData.emoji = emoji;

      if (icon) {
        // Eliminar icono anterior de S3
        if (existing.iconUrl) {
          await this.s3Service.deleteFile(existing.iconUrl).catch(() => {});
        }
        const iconUrl = await this.s3Service.uploadFile(icon, 'features');
        updateData.iconUrl = iconUrl;
      }

      return await this.convexService.mutation('features:update', {
        id,
        ...updateData,
      });
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException(error.message);
    }
  }

  async remove(id: string) {
    try {
      // Obtener feature para eliminar icono de S3
      const feature = await this.convexService.query('features:getById', {
        id,
      });
      if (feature?.iconUrl) {
        await this.s3Service.deleteFile(feature.iconUrl).catch(() => {});
      }

      return await this.convexService.mutation('features:remove', { id });
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }
}
