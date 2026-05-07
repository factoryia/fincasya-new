import { Injectable, BadRequestException } from '@nestjs/common';
import { ConvexService } from '../shared/services/convex.service';

@Injectable()
export class CatalogsService {
  constructor(private readonly convexService: ConvexService) {}

  async list() {
    try {
      return await this.convexService.query('whatsappCatalogs:list', {});
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  /** Dado un product_retailer_id (tarjeta respondida en WhatsApp), devuelve nombre y ubicación de la finca. */
  async propertyByRetailerId(productRetailerId: string) {
    try {
      return await this.convexService.query(
        'whatsappCatalogs:getPropertyByRetailerId',
        { productRetailerId: String(productRetailerId ?? '').trim() },
      );
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /** Catálogo WhatsApp (Meta) + product_retailer_id para n8n/YCloud por municipio/zona. */
  async byLocation(
    location: string,
    limit?: number,
    fechaEntrada?: string,
    fechaSalida?: string,
    minCapacity?: number,
    maxCapacity?: number,
    isEvento?: boolean,
  ) {
    try {
      return await this.convexService.query(
        'whatsappCatalogs:getPayloadByLocationForN8n',
        {
          location: location ?? '',
          ...(limit != null ? { limit } : {}),
          ...(fechaEntrada != null && String(fechaEntrada).trim()
            ? { fechaEntrada: String(fechaEntrada).trim() }
            : {}),
          ...(fechaSalida != null && String(fechaSalida).trim()
            ? { fechaSalida: String(fechaSalida).trim() }
            : {}),
          ...(minCapacity != null && Number.isFinite(minCapacity) && minCapacity > 0
            ? { minCapacity }
            : {}),
          ...(maxCapacity != null && Number.isFinite(maxCapacity) && maxCapacity > 0
            ? { maxCapacity }
            : {}),
          ...(isEvento != null ? { isEvento } : {}),
        },
      );
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}
