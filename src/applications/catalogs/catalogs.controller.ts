import { Controller, Get, Query } from '@nestjs/common';
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

  @Get('property-by-retailer-id')
  async propertyByRetailerId(@Query('id') id?: string) {
    return this.catalogsService.propertyByRetailerId(id ?? '');
  }

  @Get('by-location')
  async byLocation(
    @Query('location') location: string,
    @Query('limit') limit?: string,
    @Query('fechaEntrada') fechaEntrada?: string,
    @Query('fechaSalida') fechaSalida?: string,
    @Query('minCapacity') minCapacity?: string,
    @Query('maxCapacity') maxCapacity?: string,
    @Query('isEvento') isEvento?: string,
  ) {
    const n = limit != null && limit !== '' ? Number(limit) : undefined;
    const mc = minCapacity != null && minCapacity !== '' ? Number(minCapacity) : undefined;
    const xc = maxCapacity != null && maxCapacity !== '' ? Number(maxCapacity) : undefined;
    const ev =
      isEvento === 'true' ? true : isEvento === 'false' ? false : undefined;
    return this.catalogsService.byLocation(
      location ?? '',
      Number.isFinite(n) ? n : undefined,
      fechaEntrada,
      fechaSalida,
      Number.isFinite(mc) ? mc : undefined,
      Number.isFinite(xc) ? xc : undefined,
      ev,
    );
  }
}
