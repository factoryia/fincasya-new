import { Injectable, BadRequestException } from '@nestjs/common';
import { ConvexService } from '../shared/services/convex.service';

const CATEGORIES = [
  'ECONOMICA',
  'ESTANDAR',
  'PREMIUM',
  'LUJO',
  'ECOTURISMO',
  'CON_PISCINA',
  'CERCA_BOGOTA',
  'GRUPOS_GRANDES',
  'VIP',
] as const;

@Injectable()
export class CategoryZoneTemplatesService {
  constructor(private readonly convexService: ConvexService) {}

  private assertCategory(c: string) {
    if (!CATEGORIES.includes(c as (typeof CATEGORIES)[number])) {
      throw new BadRequestException(`Categoría no válida: ${c}`);
    }
    return c as (typeof CATEGORIES)[number];
  }

  list(propertyCategory: string) {
    const normalized = (propertyCategory || '').trim().toUpperCase();
    const cat = this.assertCategory(normalized);
    return this.convexService.query('categoryZoneTemplates:listByCategory', {
      propertyCategory: cat,
    });
  }

  listAll() {
    return this.convexService.query('categoryZoneTemplates:listAll', {});
  }

  create(propertyCategory: string, name: string) {
    const cat = this.assertCategory(propertyCategory);
    return this.convexService.mutation('categoryZoneTemplates:createTemplate', {
      propertyCategory: cat,
      name,
    });
  }

  updateTemplate(id: string, body: { name?: string; order?: number }) {
    return this.convexService.mutation('categoryZoneTemplates:updateTemplate', {
      id,
      ...body,
    });
  }

  deleteTemplate(id: string) {
    return this.convexService.mutation('categoryZoneTemplates:deleteTemplate', {
      id,
    });
  }

  addFeature(
    zoneTemplateId: string,
    body: { iconographyId: string; alias?: string; quantity?: number },
  ) {
    return this.convexService.mutation(
      'categoryZoneTemplates:addTemplateFeature',
      {
        zoneTemplateId,
        iconographyId: body.iconographyId,
        alias: body.alias,
        quantity: body.quantity,
      },
    );
  }

  updateFeature(
    id: string,
    body: { alias?: string; order?: number; iconographyId?: string; quantity?: number },
  ) {
    return this.convexService.mutation(
      'categoryZoneTemplates:updateTemplateFeature',
      {
        id,
        ...body,
      },
    );
  }

  removeFeature(id: string) {
    return this.convexService.mutation(
      'categoryZoneTemplates:removeTemplateFeature',
      { id },
    );
  }
}
