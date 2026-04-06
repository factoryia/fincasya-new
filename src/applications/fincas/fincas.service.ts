import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PDFDocument, StandardFonts } from 'pdf-lib';
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
import { format as formatDate } from 'date-fns';
import axios from 'axios';
import { ConvexService } from '../shared/services/convex.service';
import { S3Service } from '../shared/services/s3.service';
import { InboxService } from '../inbox/inbox.service';
import { CreateFincaDto } from './dto/create-finca.dto';
import { UpdateFincaDto } from './dto/update-finca.dto';
import { ListFincasDto } from './dto/list-fincas.dto';
import { parseExcelToFincas } from './excel-parser';
import {
  GlobalPricingRuleDto,
  UpdateGlobalPricingRuleDto,
} from './dto/global-pricing.dto';
import { UpdateOwnerInfoDto } from './dto/owner-info.dto';
import { GenerateContractDto } from './dto/generate-contract.dto';

@Injectable()
export class FincasService {
  constructor(
    private readonly convexService: ConvexService,
    private readonly s3Service: S3Service,
    private readonly inboxService: InboxService,
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

  async getBySlug(slug: string) {
    try {
      const finca = await this.convexService.query('fincas:getBySlug', {
        slug,
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

  async calculateSuggestedPrice(propertyId: string, checkInDate: string) {
    try {
      return await this.convexService.query('fincas:calculateSuggestedPrice', {
        propertyId,
        checkInDate,
      });
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async calculateStayPrice(
    propertyId: string,
    fechaEntrada: string,
    fechaSalida: string,
    numeroPersonas?: number,
  ) {
    try {
      return await this.convexService.query('fincas:calculateStayPrice', {
        propertyId,
        fechaEntrada,
        fechaSalida,
        numeroPersonas,
      });
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async listSimple() {
    try {
      const data = (await this.convexService.query('fincas:list', {
        limit: 1000,
      })) as any;
      const properties = data?.properties || [];
      return properties.map((p: any) => ({
        _id: p._id,
        title: p.title,
        code: p.code,
        image: p.images?.[0] || p.image || null,
        location: p.location,
      }));
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
    contractTemplate?: Express.Multer.File,
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

      let contractTemplateUrl: string | undefined;
      if (contractTemplate) {
        contractTemplateUrl = await this.s3Service.uploadFile(
          contractTemplate,
          'contracts',
        );
      }

      const {
        catalogIds,
        pricing,
        features,
        featuredIcons,
        zoneOrder,
        ...rest
      } = createDto;
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
        ...(contractTemplateUrl && { contractTemplateUrl }),
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
    contractTemplate?: Express.Multer.File,
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

      // Subir nueva plantilla de contrato si existe
      let contractTemplateUrl: string | undefined;
      if (contractTemplate) {
        contractTemplateUrl = await this.s3Service.uploadFile(
          contractTemplate,
          'contracts',
        );
      }

      // Actualizar la finca
      // Pasamos pricing por separado si existe, y el resto de campos (incluyendo features y catalogIds) a la mutación update.
      const {
        pricing,
        catalogIds,
        features,
        featuredIcons,
        active,
        zoneOrder,
        ...updateData
      } = updateDto as any;
      if (videoUrl) {
        updateData.video = videoUrl;
      }
      if (contractTemplateUrl) {
        updateData.contractTemplateUrl = contractTemplateUrl;
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
      const rule = await this.convexService.query('globalPricing:getById', {
        id,
      });
      if (!rule) throw new NotFoundException('Regla global no encontrada');
      return rule;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException(error.message);
    }
  }

  async createGlobalPricingRule(dto: GlobalPricingRuleDto) {
    try {
      return await this.convexService.mutation('globalPricing:create', {
        ...dto,
      });
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async updateGlobalPricingRule(id: string, dto: UpdateGlobalPricingRuleDto) {
    try {
      return await this.convexService.mutation('globalPricing:update', {
        id,
        ...dto,
      });
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

  async getOwnerInfo(propertyId: string) {
    try {
      return await this.convexService.query('propertyOwners:getByPropertyId', {
        propertyId,
      });
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async upsertOwnerInfo(
    propertyId: string,
    dto: UpdateOwnerInfoDto,
    files?: {
      bankCertification?: Express.Multer.File;
      idCopy?: Express.Multer.File;
      rntPdf?: Express.Multer.File;
      chamberOfCommerce?: Express.Multer.File;
    },
  ) {
    try {
      const updateData: any = { ...dto, propertyId };

      if (files) {
        if (files.bankCertification) {
          updateData.bankCertificationUrl = await this.s3Service.uploadFile(
            files.bankCertification,
            'owners/bank-certifications',
          );
        }
        if (files.idCopy) {
          updateData.idCopyUrl = await this.s3Service.uploadFile(
            files.idCopy,
            'owners/id-copies',
          );
        }
        if (files.rntPdf) {
          updateData.rntPdfUrl = await this.s3Service.uploadFile(
            files.rntPdf,
            'owners/rnt-pdfs',
          );
        }
        if (files.chamberOfCommerce) {
          updateData.chamberOfCommerceUrl = await this.s3Service.uploadFile(
            files.chamberOfCommerce,
            'owners/chamber-of-commerce',
          );
        }
      }

      return await this.convexService.mutation(
        'propertyOwners:upsert',
        updateData,
      );
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async getOwnedProperties(ownerUserId: string) {
    try {
      return await this.convexService.query(
        'propertyOwners:getOwnedProperties',
        {
          ownerUserId,
        },
      );
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }
  async generateContract(propertyId: string, dto: GenerateContractDto) {
    try {
      // 1. Obtener la finca y su plantilla
      const finca = await this.getById(propertyId);
      if (!finca.contractTemplateUrl) {
        throw new BadRequestException(
          'Esta finca no tiene una plantilla de contrato configurada.',
        );
      }

      // 2. Descargar la plantilla PDF
      const response = await axios.get(finca.contractTemplateUrl, {
        responseType: 'arraybuffer',
      });
      const pdfBytes = response.data;

      // 3. Modificar el PDF con pdf-lib
      // 2. Obtener información de la conversación y contacto para el cliente
      let contact: any = null;
      try {
        const conv = await this.convexService.query('conversations:getById', {
          conversationId: dto.conversationId,
        });
        if (conv) {
          contact = await this.convexService.query('contacts:getById', {
            contactId: conv.contactId,
          });
        }
      } catch (e) {
        console.warn('No se pudo obtener el contacto para el contrato');
      }

      const now = new Date();
      const months = [
        'Enero',
        'Febrero',
        'Marzo',
        'Abril',
        'Mayo',
        'Junio',
        'Julio',
        'Agosto',
        'Septiembre',
        'Octubre',
        'Noviembre',
        'Diciembre',
      ];
      const formattedDate = `${now.getDate()} dias del mes de ${months[now.getMonth()]} del ${now.getFullYear()}`;

      // 1. Cálculos de duración (necesarios para el precio total)
      let totalNights = 1;
      let totalDays = 1;
      let checkInMini = '';
      let checkOutMini = '';

      if (dto.checkInDate && dto.checkOutDate) {
        try {
          const start = new Date(dto.checkInDate);
          const end = new Date(dto.checkOutDate);
          const diffTime = Math.abs(end.getTime() - start.getTime());
          totalNights = Math.max(
            1,
            Math.ceil(diffTime / (1000 * 60 * 60 * 24)),
          );
          totalDays = totalNights;

          const formatMini = (d: Date) => {
            const day = String(d.getUTCDate()).padStart(2, '0');
            const month = String(d.getUTCMonth() + 1).padStart(2, '0');
            const year = d.getUTCFullYear();
            return `${day}/${month}/${year}`;
          };
          checkInMini = formatMini(start);
          checkOutMini = formatMini(end);
        } catch (e) {
          console.error('Error calculating duration:', e);
        }
      }

      // 2. Cálculo del precio total (Precio por día * Total de días)
      // Según instrucción del usuario: "multiplicado por los dias de reserva"
      const unitPriceNum = parseInt(dto.nightlyPrice) || 0;
      const totalPriceNum = unitPriceNum * totalDays;

      const totalPriceText =
        this.numberToSpanishText(totalPriceNum).toUpperCase();
      const totalPriceFormatted = new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency: 'COP',
        minimumFractionDigits: 0,
      }).format(totalPriceNum);

      // Mapeo de campos solicitado por el usuario
      const mappingKeys = {
        date: 'FECHA_GENERACIÓN DE CONTRATO (FORMATO DIA(NUMERO) MES(TEXTO) de AÑO(NUMERO))',
        priceText: 'VALOR – PRECIO EN TEXTO',
        priceNumeric: '($VALOR NUMERICO)',
        priceNumericAlt: '($VALOR - PRECIO NUMERICO)',
        accountHolder: 'NOMBRE TITULAR DE LA CUENTA, datos admin',
        idNumber: 'NUMERO DE CEDULA TITULAR CUENTA, datos admin',
        accountNumber: 'NUMERO DE CUENTA, datos admin',
        bankName: 'NOMBRE BANCO, datos admin',
        contractNumber: 'Numero registrados datos admin',
        clientName: 'NOMBRE CLIENTE',
        clientId: 'Numero de cedula, cliente',
        clientEmail: 'clientCorreo',
        clientPhone: 'clienteCelular',
        checkInDate: 'FECHA ENTRADA',
        checkOutDate: 'FECHA SALIDA',
        city: 'ciudad',
        clientCity: 'ciudadCliente',
        clientAddress: 'direccionCliente',
      };

      const valuesMapping = {
        [mappingKeys.date]: formattedDate,
        [mappingKeys.priceText]: totalPriceText,
        [mappingKeys.priceNumeric]: totalPriceFormatted,
        [mappingKeys.priceNumericAlt]: totalPriceFormatted,
        [mappingKeys.accountHolder]: dto.accountHolder,
        [mappingKeys.idNumber]: dto.idNumber,
        [mappingKeys.accountNumber]: dto.accountNumber,
        [mappingKeys.bankName]: dto.bankName,
        [mappingKeys.contractNumber]: dto.contractNumber,
        [mappingKeys.clientName]: dto.clientName || contact?.name || '',
        [mappingKeys.clientId]: dto.clientId || '',
        [mappingKeys.clientEmail]: dto.clientEmail || '',
        [mappingKeys.clientPhone]: dto.clientPhone || '',
        [mappingKeys.checkInDate]: dto.checkInDate || '',
        [mappingKeys.checkOutDate]: dto.checkOutDate || '',
        [mappingKeys.city]: finca.location || '',
        [mappingKeys.clientCity]: dto.clientCity || '',
        [mappingKeys.clientAddress]: dto.clientAddress || '',
        // Fallbacks genéricos
        Text6: dto.contractNumber,
        Text9: totalPriceText,
        Text10: totalPriceFormatted,
        Text11: dto.accountNumber,
        Text13: dto.bankName,
      };

      // --- DETECCIÓN DE FORMATO Y PROCESAMIENTO ---
      const isDocx = pdfBytes.slice(0, 2).toString() === 'PK';
      let finalBuffer: Buffer;
      let finalFilename: string;
      let finalMimeType: string;

      if (isDocx) {
        console.log('[api] Detectado formato Word (.docx)');
        const zip = new PizZip(pdfBytes);

        // --- LIMPIEZA DE XML (Para evitar errores por formato de Word) ---
        try {
          const docXml = zip.file('word/document.xml')?.asText();
          if (docXml) {
            // Eliminar etiquetas XML que queden atrapadas dentro de { ... } o {{ ... }}
            // Esto limpia casos donde Word fragmenta las etiquetas: {<w:t>{</w:t>...<w:t>}</w:t>}
            const cleanedXml = docXml.replace(/\{[^}]+\}/g, (match) => {
              return match.replace(/<[^>]+>/g, '');
            });
            zip.file('word/document.xml', cleanedXml);
          }
        } catch (e) {
          console.warn(
            '[api] No se pudo limpiar el XML del Word, procediendo normal',
          );
        }

        const doc = new Docxtemplater(zip, {
          paragraphLoop: true,
          linebreaks: true,
          delimiters: { start: '{{', end: '}}' },
        });

        // Mapeo limpio para Word
        const wordData = {
          fechaGeneracion: valuesMapping[mappingKeys.date],
          precioLetras: valuesMapping[mappingKeys.priceText],
          precioNumerico: valuesMapping[mappingKeys.priceNumeric],
          bancoNombre: valuesMapping[mappingKeys.bankName],
          cuentaNumero: valuesMapping[mappingKeys.accountNumber],
          titularNombre: valuesMapping[mappingKeys.accountHolder],
          titularCedula: valuesMapping[mappingKeys.idNumber],
          contratoNumero: valuesMapping[mappingKeys.contractNumber],
          fechaEntrada: valuesMapping[mappingKeys.checkInDate],
          fechaLlegada: valuesMapping[mappingKeys.checkInDate], // Alias prioritario
          fecha_entrada: valuesMapping[mappingKeys.checkInDate],
          fecha_llegada: valuesMapping[mappingKeys.checkInDate],
          fechaSalida: valuesMapping[mappingKeys.checkOutDate],
          fecha_salida: valuesMapping[mappingKeys.checkOutDate],
          ciudad: valuesMapping[mappingKeys.city],
          // Nuevos campos de duración y tiempos
          nochesTexto: this.numberToSpanishText(totalNights, false),
          nochesNumero: String(totalNights),
          diasTexto: this.numberToSpanishText(totalDays, false),
          diasNumero: String(totalDays),
          fechaEntradaMini: checkInMini,
          fechaLlegadaMini: checkInMini,
          fechaSalidaMini: checkOutMini,
          horaLlegada: dto.checkInTime || '03:00 PM',
          horaSalida: dto.checkOutTime || '01:00 PM',
          ciudadCliente:
            valuesMapping[mappingKeys.clientCity] || dto.clientCity || '',
          direccionCliente:
            valuesMapping[mappingKeys.clientAddress] || dto.clientAddress || '',
          clienteNombre: valuesMapping[mappingKeys.clientName],
          clienteCedula: valuesMapping[mappingKeys.clientId],
          clienteId: valuesMapping[mappingKeys.clientId],
          clienteIdentificacion: valuesMapping[mappingKeys.clientId],
          clientCorreo: valuesMapping[mappingKeys.clientEmail],
          clienteCelular: valuesMapping[mappingKeys.clientPhone],
        };

        try {
          doc.render(wordData);
        } catch (error) {
          console.error('[api] Error al renderizar Word:', error);
          if (error.properties && error.properties.errors instanceof Array) {
            const errorMessages = error.properties.errors
              .map((e: any) => e.explanation)
              .join(', ');
            throw new BadRequestException(
              `Error en la plantilla Word: ${errorMessages}`,
            );
          }
          throw new BadRequestException(
            `Error al procesar la plantilla Word: ${error.message}`,
          );
        }

        finalBuffer = doc
          .getZip()
          .generate({ type: 'nodebuffer', compression: 'DEFLATE' });
        finalFilename = `Contrato_${finca.title.replace(/\s+/g, '_')}_${dto.contractNumber}.docx`;
        finalMimeType =
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      } else {
        // --- PROCESAMIENTO PDF ---
        const pdfDoc = await PDFDocument.load(pdfBytes);
        const helveticaFont = await pdfDoc.embedFont('Helvetica');
        const form = pdfDoc.getForm();
        const allFields = form.getFields();
        const allFieldNames = allFields.map((f) => f.getName());

        console.log('=== DIAGNÓSTICO PDF ===');
        console.log(
          `Campos detectados (${allFieldNames.length}):`,
          allFieldNames,
        );
        if (allFieldNames.length === 0) {
          console.error(
            '¡ADVERTENCIA! El PDF no parece tener campos de formulario (AcroForm).',
          );
        }

        // Rellenar campos usando búsqueda robusta (con y sin corchetes)
        allFieldNames.forEach((fieldName) => {
          try {
            const field = form.getTextField(fieldName);
            if (!field) return;

            // Limpiar el nombre del campo en el PDF para comparar
            const cleanPdfName = fieldName
              .replace(/^\[/, '')
              .replace(/\]$/, '')
              .trim();

            // Buscar coincidencia en nuestro mapeo
            for (const [key, val] of Object.entries(valuesMapping)) {
              const cleanKey = key.replace(/^\[/, '').replace(/\]$/, '').trim();

              if (cleanPdfName === cleanKey || fieldName === key) {
                field.setText(val.toString());

                // Eliminar bordes y fondos para que parezca texto normal
                try {
                  // @ts-ignore - En algunas versiones de pdf-lib estos métodos existen
                  if (typeof (field as any).setBorderWidth === 'function') {
                    (field as any).setBorderWidth(0);
                  }
                } catch (e) {}

                // Ajustar fuente y tamaño
                field.setFontSize(10);
                field.updateAppearances(helveticaFont);

                console.log(
                  `Campo llenado y estilizado: "${fieldName}" con valor: "${val}"`,
                );
                break;
              }
            }
          } catch (e) {
            // Ignorar si no es text field
          }
        });

        // Aplanar el formulario
        form.flatten();

        const pdfSavedBytes = await pdfDoc.save();
        finalBuffer = Buffer.from(pdfSavedBytes);
        finalFilename = `Contrato_${finca.title.replace(/\s+/g, '_')}_${dto.contractNumber}.pdf`;
        finalMimeType = 'application/pdf';
      }

      // 4. Subir el archivo generado a S3
      const generatedFile: Express.Multer.File = {
        fieldname: 'file',
        originalname: finalFilename,
        encoding: '7bit',
        mimetype: finalMimeType,
        buffer: finalBuffer,
        size: finalBuffer.length,
        stream: null as any,
        destination: '',
        filename: '',
        path: '',
      };

      const publicUrl = await this.s3Service.uploadFile(
        generatedFile,
        'contracts/generated',
      );

      // 5. Enviar mensaje a la conversación
      await this.inboxService.sendMessage(dto.conversationId, {
        type: 'document',
        text: `¡Hola! 👋 Aquí tienes el documento del contrato para la finca ${finca.title}. Por favor revísalo y quedamos atentos a cualquier duda. ✨`,
        mediaUrl: publicUrl,
        file: generatedFile,
      });

      return {
        success: true,
        url: publicUrl,
        message: 'Contrato generado y enviado exitosamente.',
      };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      throw new BadRequestException(
        `Error al generar contrato: ${error.message}`,
      );
    }
  }

  private numberToSpanishText(n: number, addCurrency = true): string {
    if (n === 0) return 'CERO';

    const unidades = [
      '',
      'UN',
      'DOS',
      'TRES',
      'CUATRO',
      'CINCO',
      'SEIS',
      'SIETE',
      'OCHO',
      'NUEVE',
    ];
    const decenas = [
      '',
      'DIEZ',
      'VEINTE',
      'TREINTA',
      'CUARENTA',
      'CINCUENTA',
      'SESENTA',
      'SETENTA',
      'OCHENTA',
      'NOVENTA',
    ];
    const especiales = [
      'ONCE',
      'DOCE',
      'TRECE',
      'CATORCE',
      'QUINCE',
      'DIECISÉIS',
      'DIECISIETE',
      'DIECIOCHO',
      'DIECINUEVE',
    ];
    const centenas = [
      '',
      'CIENTO',
      'DOSCIENTOS',
      'TRESCIENTOS',
      'CUATROCIENTOS',
      'QUINIENTOS',
      'SEISCIENTOS',
      'SETECIENTOS',
      'OCHOCIENTOS',
      'NOVECIENTOS',
    ];

    const convertirMenorA1000 = (num: number): string => {
      let res = '';
      if (num >= 100) {
        if (num === 100) return 'CIEN';
        res += centenas[Math.floor(num / 100)] + ' ';
        num %= 100;
      }
      if (num >= 10 && num <= 19) {
        if (num === 10) res += 'DIEZ';
        else res += especiales[num - 11];
      } else {
        if (num >= 20) {
          if (num === 20) res += 'VEINTE';
          else if (num < 30) res += 'VEINTI' + unidades[num % 10];
          else
            res +=
              decenas[Math.floor(num / 10)] +
              (num % 10 > 0 ? ' Y ' + unidades[num % 10] : '');
        } else if (num > 0) {
          res += unidades[num];
        }
      }
      return res.trim();
    };

    const processNum = (num: number): string => {
      if (num === 0) return '';
      if (num < 1000) return convertirMenorA1000(num);

      if (num < 1000000) {
        const miles = Math.floor(num / 1000);
        const resto = num % 1000;
        let res = miles === 1 ? 'MIL' : convertirMenorA1000(miles) + ' MIL';
        if (resto > 0) res += ' ' + convertirMenorA1000(resto);
        return res;
      }

      if (num < 1000000000) {
        const millones = Math.floor(num / 1000000);
        const resto = num % 1000000;
        let res =
          millones === 1
            ? 'UN MILLÓN'
            : convertirMenorA1000(millones) + ' MILLONES';
        if (resto > 0) res += ' ' + processNum(resto);
        return res;
      }

      return num.toString();
    };

    const text = processNum(n).toUpperCase();
    return addCurrency ? `${text} PESOS M/CTE` : text;
  }
}
