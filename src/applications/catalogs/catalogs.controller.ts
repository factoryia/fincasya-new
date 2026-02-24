import { Controller, Get } from '@nestjs/common';
import { CatalogsService } from './catalogs.service';

/**
 * Catálogos de WhatsApp (whatsappCatalogs en Convex).
 * Usa los IDs para referenciar al crear fincas (catalogIds).
 */
@Controller('catalogs')
export class CatalogsController {
  constructor(private readonly catalogsService: CatalogsService) {}

  @Get()
  async list() {
    return this.catalogsService.list();
  }
}
