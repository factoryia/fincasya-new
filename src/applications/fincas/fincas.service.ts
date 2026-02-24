import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConvexService } from '../shared/services/convex.service';
import { S3Service } from '../shared/services/s3.service';
import { CreateFincaDto } from './dto/create-finca.dto';
import { UpdateFincaDto } from './dto/update-finca.dto';
import { ListFincasDto } from './dto/list-fincas.dto';
import { parseExcelToFincas } from './excel-parser';

@Injectable()
export class FincasService {
  constructor(
    private readonly convexService: ConvexService,
    private readonly s3Service: S3Service,
  ) {}

  async list(listDto: ListFincasDto) {
    try {
      // Filtrar propiedades undefined para evitar errores en Convex
      const args = Object.fromEntries(
        Object.entries(listDto).filter(([_, value]) => value !== undefined && value !== null && value !== '')
      );
      return await this.convexService.query('fincas:list', args);
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async getById(id: string, activasOnly = false) {
    try {
      const finca = await this.convexService.query('fincas:getById', { id });
      if (!finca) {
        throw new NotFoundException('Finca no encontrada');
      }
      if (activasOnly && finca.pricing) {
        finca.pricing = finca.pricing.filter((p: { activa?: boolean }) => p.activa !== false);
      }
      return finca;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException(error.message);
    }
  }

  async getByCode(code: string) {
    try {
      const finca = await this.convexService.query('fincas:getByCode', { code });
      if (!finca) {
        throw new NotFoundException('Finca no encontrada');
      }
      return finca;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException(error.message);
    }
  }

  async search(query: string, limit?: number) {
    try {
      return await this.convexService.query('fincas:search', { query, limit });
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async create(
    createDto: CreateFincaDto,
    images?: Express.Multer.File[],
    video?: Express.Multer.File,
  ) {
    try {
      let imageUrls: string[] = [];
      if (images && images.length > 0) {
        imageUrls = await this.s3Service.uploadImages(images);
      }

      let videoUrl: string | undefined;
      if (video) {
        videoUrl = await this.s3Service.uploadVideo(video);
      }

      const { catalogIds, ...rest } = createDto;
      const base = rest.priceBase ?? 0;
      const fincaData: Record<string, unknown> = {
        ...rest,
        priceBaja: rest.priceBaja ?? base,
        priceMedia: rest.priceMedia ?? base,
        priceAlta: rest.priceAlta ?? base,
        images: imageUrls,
        ...(videoUrl && { video: videoUrl }),
        ...(catalogIds?.length && { catalogIds }),
      };

      const propertyId = await this.convexService.mutation('fincas:create', fincaData);

      if (catalogIds && catalogIds.length > 0) {
        const metaSync = (await this.convexService.action('metaCatalog:syncPropertyToCatalogs', {
          propertyId,
        } as Record<string, unknown>)) as { synced: number };
        return { id: propertyId, metaSync };
      }

      return { id: propertyId };
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async update(id: string, updateDto: UpdateFincaDto, images?: Express.Multer.File[], video?: Express.Multer.File) {
    try {
      // Subir nuevas imágenes a S3 si existen
      let imageUrls: string[] = [];
      if (images && images.length > 0) {
        imageUrls = await this.s3Service.uploadImages(images);
      }

      // Subir nuevo video a S3 si existe
      let videoUrl: string | undefined;
      if (video) {
        videoUrl = await this.s3Service.uploadVideo(video);
      }

      // Actualizar la finca
      const updateData: any = { ...updateDto };
      if (imageUrls.length > 0) {
        // Agregar las nuevas imágenes a las existentes
        // Primero obtenemos la finca actual para mantener las imágenes existentes
        const currentFinca = await this.getById(id);
        const existingImages = currentFinca.images || [];
        updateData.images = [...existingImages, ...imageUrls];
      }
      if (videoUrl) {
        updateData.video = videoUrl;
      }

      return await this.convexService.mutation('fincas:update', {
        id,
        ...updateData,
      });
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async setPricing(propertyId: string, pricing: Array<{
    nombre: string;
    fechaDesde?: string;
    fechaHasta?: string;
    valorUnico?: number;
    condiciones?: string;
    activa?: boolean;
    reglas?: string;
    order?: number;
  }>) {
    try {
      return await this.convexService.mutation('fincas:setPricing', {
        propertyId,
        pricing,
      });
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async addTemporada(propertyId: string, body: {
    nombre: string;
    fechaDesde?: string;
    fechaHasta?: string;
    valorUnico?: number;
    condiciones?: string;
    activa?: boolean;
    reglas?: string;
    order?: number;
  }) {
    try {
      return await this.convexService.mutation('fincas:addTemporada', {
        propertyId,
        ...body,
      });
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async updateTemporada(pricingId: string, body: {
    nombre?: string;
    fechaDesde?: string;
    fechaHasta?: string;
    valorUnico?: number;
    condiciones?: string;
    activa?: boolean;
    reglas?: string;
    order?: number;
  }) {
    try {
      return await this.convexService.mutation('fincas:updateTemporada', {
        pricingId,
        ...body,
      });
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async removeTemporada(pricingId: string) {
    try {
      return await this.convexService.mutation('fincas:removeTemporada', { pricingId });
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async delete(id: string) {
    try {
      // Obtener la finca para eliminar las imágenes y video de S3
      const finca = await this.getById(id);

      // Eliminar imágenes de S3
      if (finca.images && finca.images.length > 0) {
        await Promise.all(
          finca.images.map((url: string) => this.s3Service.deleteFile(url).catch(() => {}))
        );
      }

      // Eliminar video de S3 si existe
      if (finca.video) {
        await this.s3Service.deleteFile(finca.video).catch(() => {});
      }

      // Eliminar la finca de Convex
      return await this.convexService.mutation('fincas:remove', { id });
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async addImage(propertyId: string, image: Express.Multer.File) {
    try {
      const imageUrl = await this.s3Service.uploadImage(image);
      return await this.convexService.mutation('fincas:addImage', {
        propertyId,
        url: imageUrl,
      });
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async removeImage(imageId: string) {
    try {
      const image = await this.convexService.query('fincas:getImageById', { imageId });
      if (image?.url) {
        await this.s3Service.deleteFile(image.url).catch(() => {});
      }
      return await this.convexService.mutation('fincas:removeImage', { imageId });
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async addFeature(propertyId: string, name: string) {
    try {
      return await this.convexService.mutation('fincas:addFeature', {
        propertyId,
        name,
      });
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async removeFeature(featureId: string) {
    try {
      return await this.convexService.mutation('fincas:removeFeature', { featureId });
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  /**
   * Carga masiva desde Excel (tabla de precios).
   * Parsea el archivo y crea una finca por cada fila válida.
   */
  async importFromExcel(buffer: Buffer): Promise<{ created: number; skipped: number; errors: number; details: string[] }> {
    const payloads = parseExcelToFincas(buffer);
    let created = 0;
    let errors = 0;
    const details: string[] = [];

    for (const dto of payloads) {
      try {
        await this.create(dto);
        created++;
        details.push(`✅ ${dto.title}`);
      } catch (err: unknown) {
        errors++;
        const msg = err instanceof Error ? err.message : String(err);
        details.push(`❌ ${dto.title}: ${msg}`);
      }
    }

    const skipped = 0;
    return { created, skipped, errors, details };
  }
}
