import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ConvexService } from '../shared/services/convex.service';
import { S3Service } from '../shared/services/s3.service';
import { CreateFincaDto } from './dto/create-finca.dto';
import { UpdateFincaDto } from './dto/update-finca.dto';
import { ListFincasDto } from './dto/list-fincas.dto';
import { parseExcelToFincas } from './excel-parser';
import { GlobalPricingRuleDto, UpdateGlobalPricingRuleDto } from './dto/global-pricing.dto';

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
        Object.entries(listDto).filter(
          ([_, value]) => value !== undefined && value !== null && value !== '',
        ),
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
        finca.pricing = finca.pricing.filter(
          (p: { activa?: boolean }) => p.activa !== false,
        );
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
      const finca = await this.convexService.query('fincas:getByCode', {
        code,
      });
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

  /**
   * Lista de fincas para feed de catálogo (Meta/WhatsApp). Solo incluye las que tienen al menos una imagen.
   */
  async getCatalogFeedRows(): Promise<
    {
      id: string;
      title: string;
      description: string;
      link: string;
      image_link: string;
      additional_image_link: string;
      price: string;
      availability: string;
      condition: string;
    }[]
  > {
    const baseUrl = (
      process.env.CATALOG_PRODUCT_BASE_URL ||
      process.env.FRONTEND_URL ||
      process.env.SITE_URL ||
      'https://fincasya.cloud'
    ).replace(/\/$/, '');
    const result = await this.convexService.query('fincas:list', {
      limit: 2000,
    });
    const rows: {
      id: string;
      title: string;
      description: string;
      link: string;
      image_link: string;
      additional_image_link: string;
      price: string;
      availability: string;
      condition: string;
    }[] = [];
    for (const p of result.properties || []) {
      const images = (p as { images?: string[] }).images ?? [];
      if (images.length === 0) continue;
      const id = String((p as { _id: string })._id);
      const title = ((p as { title?: string }).title ?? 'Finca').slice(0, 200);
      const description = ((p as { description?: string }).description ?? '')
        .slice(0, 9999)
        .replace(/<[^>]*>/g, '');
      const priceBase = (p as { priceBase?: number }).priceBase ?? 0;
      rows.push({
        id,
        title,
        description,
        link: `${baseUrl}/fincas/${id}`,
        image_link: images[0],
        additional_image_link: images.slice(1).join(','),
        price: `${priceBase} COP`,
        availability: 'in stock',
        condition: 'new',
      });
    }
    return rows;
  }

  /** Genera el CSV del catálogo para Meta (columnas requeridas: id, title, description, link, image_link, price, availability, condition). */
  async getCatalogFeedCsv(): Promise<string> {
    const rows = await this.getCatalogFeedRows();
    const escape = (s: string) => {
      const t = String(s ?? '').replace(/"/g, '""');
      return /[",\n\r]/.test(t) ? `"${t}"` : t;
    };
    const headers = [
      'id',
      'title',
      'description',
      'link',
      'image_link',
      'additional_image_link',
      'price',
      'availability',
      'condition',
    ];
    const lines = [headers.join(',')];
    for (const r of rows) {
      lines.push(
        [
          r.id,
          r.title,
          r.description,
          r.link,
          r.image_link,
          r.additional_image_link,
          r.price,
          r.availability,
          r.condition,
        ]
          .map(escape)
          .join(','),
      );
    }
    return '\uFEFF' + lines.join('\r\n');
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

      const { catalogIds, pricing, features, featuredIcons, zoneOrder, ...rest } = createDto;
      const base = rest.priceBase ?? 0;
      const fincaData: Record<string, unknown> = {
        ...rest,
        priceBaja: rest.priceBaja ?? base,
        priceMedia: rest.priceMedia ?? base,
        priceAlta: rest.priceAlta ?? base,
        images: imageUrls,
        features:
          features?.map((f) => ({
            name: f.name,
            ...(f.iconId ? { iconId: f.iconId } : {}),
            ...(f.zone ? { zone: f.zone } : {}),
          })) || [],
        ...(featuredIcons && { featuredIcons }),
        ...(zoneOrder && { zoneOrder }),
        ...(videoUrl && { video: videoUrl }),
        ...(catalogIds?.length && { catalogIds }),
      };

      // Convex no soporta instancias de clases, solo objetos planos.
      // Normalizamos pricing a plain objects antes de enviarlo.
      if (pricing && Array.isArray(pricing)) {
        fincaData.pricing = pricing.map((p) => {
          const {
            nombre,
            fechaDesde,
            fechaHasta,
            fechas,
            valorUnico,
            condiciones,
            activa,
            reglas,
            order,
            globalRuleId,
          } = p;
          const out: Record<string, unknown> = {};
          if (nombre !== undefined) out.nombre = nombre;
          if (fechaDesde !== undefined) out.fechaDesde = fechaDesde;
          if (fechaHasta !== undefined) out.fechaHasta = fechaHasta;
          if (fechas !== undefined) out.fechas = fechas;
          if (globalRuleId !== undefined) out.globalRuleId = globalRuleId;
          if (valorUnico !== undefined) out.valorUnico = valorUnico;
          if (condiciones !== undefined) out.condiciones = condiciones;
          if (activa !== undefined) out.activa = activa;
          if (reglas !== undefined) out.reglas = reglas;
          if (order !== undefined) out.order = order;
          return out;
        });
      }

      const propertyId = await this.convexService.mutation(
        'fincas:create',
        fincaData,
      );

      if (catalogIds && catalogIds.length > 0) {
        const metaSync = (await this.convexService.action(
          'metaCatalog:syncPropertyToCatalogs',
          {
            propertyId,
          } as Record<string, unknown>,
        )) as { synced: number };
        return { id: propertyId, metaSync };
      }

      return { id: propertyId };
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async update(
    id: string,
    updateDto: UpdateFincaDto,
    images?: Express.Multer.File[],
    video?: Express.Multer.File,
  ) {
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
      // Pasamos pricing por separado si existe, y el resto de campos (incluyendo features y catalogIds) a la mutación update.
      const { pricing, catalogIds, features, featuredIcons, active, owner, zoneOrder, ...updateData } = updateDto as any;
      if (videoUrl) {
        updateData.video = videoUrl;
      }

      const result = await this.convexService.mutation('fincas:update', {
        id,
        ...updateData,
        features:
          features?.map((f: any) => ({
            name: f.name,
            ...(f.iconId ? { iconId: f.iconId } : {}),
            ...(f.zone ? { zone: f.zone } : {}),
          })) || [],
        ...(featuredIcons && { featuredIcons }),
        ...(zoneOrder && { zoneOrder }),
        ...(active !== undefined && { active }),
        owner,
        catalogIds,
      });

      // Si se enviaron catalogIds en el update, sincronizar con Meta Catalog (pero sin pasarlos a Convex).
      if (catalogIds && Array.isArray(catalogIds) && catalogIds.length > 0) {
        await this.convexService.action('metaCatalog:syncPropertyToCatalogs', {
          propertyId: id,
        } as Record<string, unknown>);
      }

      // Agregar nuevas imágenes a través de la mutación dedicada de Convex.
      if (imageUrls.length > 0) {
        const currentFinca = await this.getById(id);
        const existingImages: string[] = currentFinca.images || [];
        const baseOrder = existingImages.length;

        await Promise.all(
          imageUrls.map((url, index) =>
            this.convexService.mutation('fincas:addImage', {
              propertyId: id,
              url,
              order: baseOrder + index,
            } as Record<string, unknown>),
          ),
        );
      }

      // Si se envió pricing en el update, usar la mutación dedicada setPricing.
      if (pricing && Array.isArray(pricing)) {
        const normalized = pricing.map((p: any) => {
          const {
            nombre,
            fechaDesde,
            fechaHasta,
            fechas,
            valorUnico,
            condiciones,
            activa,
            reglas,
            order,
            globalRuleId,
          } = p;
          const out: Record<string, unknown> = {};
          if (nombre !== undefined) out.nombre = nombre;
          if (fechaDesde !== undefined) out.fechaDesde = fechaDesde;
          if (fechaHasta !== undefined) out.fechaHasta = fechaHasta;
          if (fechas !== undefined) out.fechas = fechas;
          if (globalRuleId !== undefined) out.globalRuleId = globalRuleId;
          if (valorUnico !== undefined) out.valorUnico = valorUnico;
          if (condiciones !== undefined) out.condiciones = condiciones;
          if (activa !== undefined) out.activa = activa;
          if (reglas !== undefined) out.reglas = reglas;
          if (order !== undefined) out.order = order;
          return out;
        });

        await this.convexService.mutation('fincas:setPricing', {
          propertyId: id,
          pricing: normalized,
        } as Record<string, unknown>);
      }

      return result;
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async setPricing(
    propertyId: string,
    pricing: Array<{
      nombre?: string;
      fechaDesde?: string;
      fechaHasta?: string;
      fechas?: string[];
      globalRuleId?: string;
      valorUnico?: number;
      condiciones?: string;
      activa?: boolean;
      reglas?: string;
      order?: number;
    }>,
  ) {
    try {
      return await this.convexService.mutation('fincas:setPricing', {
        propertyId,
        pricing,
      });
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async addTemporada(
    propertyId: string,
    body: {
      nombre?: string;
      fechaDesde?: string;
      fechaHasta?: string;
      fechas?: string[];
      globalRuleId?: string;
      valorUnico?: number;
      condiciones?: string;
      activa?: boolean;
      reglas?: string;
      order?: number;
    },
  ) {
    try {
      return await this.convexService.mutation('fincas:addTemporada', {
        propertyId,
        ...body,
      });
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async updateTemporada(
    pricingId: string,
    body: {
      nombre?: string;
      fechaDesde?: string;
      fechaHasta?: string;
      fechas?: string[];
      globalRuleId?: string;
      valorUnico?: number;
      condiciones?: string;
      activa?: boolean;
      reglas?: string;
      order?: number;
    },
  ) {
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
      return await this.convexService.mutation('fincas:removeTemporada', {
        pricingId,
      });
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
          finca.images.map((url: string) =>
            this.s3Service.deleteFile(url).catch(() => {}),
          ),
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

  async reorderImages(imageOrders: { id: string; order: number }[]) {
    try {
      return await this.convexService.mutation('fincas:updateImageOrder', {
        imageOrders,
      });
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async getTabOrder(tabId: string) {
    try {
      return await this.convexService.query('fincas:getTabOrder', { tabId });
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async updateTabOrder(tabId: string, propertyIds: string[]) {
    try {
      return await this.convexService.mutation('fincas:updateTabOrder', {
        tabId,
        propertyIds,
      });
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async removeImage(imageId: string) {
    try {
      const image = await this.convexService.query('fincas:getImageById', {
        imageId,
      });
      if (image?.url) {
        await this.s3Service.deleteFile(image.url).catch(() => {});
      }
      return await this.convexService.mutation('fincas:removeImage', {
        imageId,
      });
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async addFeature(propertyId: string, name: string, iconId?: string) {
    try {
      return await this.convexService.mutation('fincas:addFeature', {
        propertyId,
        name,
        iconId,
      });
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async unlinkFeature(propertyId: string, name?: string, iconId?: string) {
    try {
      return await this.convexService.mutation('fincas:unlinkFeature', {
        propertyId,
        name,
        iconId,
      });
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async removeFeature(featureId: string) {
    try {
      return await this.convexService.mutation('fincas:removeFeature', {
        featureId,
      });
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  /**
   * Carga masiva desde Excel (tabla de precios).
   * Parsea el archivo y crea una finca por cada fila válida.
   */
  async importFromExcel(buffer: Buffer): Promise<{
    created: number;
    skipped: number;
    errors: number;
    details: string[];
  }> {
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

  // --- Global Pricing Rules Methods ---

  async listGlobalPricingRules() {
    try {
      return await this.convexService.query('globalPricing:list', {});
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async getGlobalPricingRuleById(id: string) {
    try {
      const rule = await this.convexService.query('globalPricing:getById', { id });
      if (!rule) throw new NotFoundException('Regla global no encontrada');
      return rule;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException(error.message);
    }
  }

  async createGlobalPricingRule(dto: GlobalPricingRuleDto) {
    try {
      return await this.convexService.mutation('globalPricing:create', { ...dto });
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async updateGlobalPricingRule(id: string, dto: UpdateGlobalPricingRuleDto) {
    try {
      return await this.convexService.mutation('globalPricing:update', { id, ...dto });
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async deleteGlobalPricingRule(id: string) {
    try {
      return await this.convexService.mutation('globalPricing:remove', { id });
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }
}
