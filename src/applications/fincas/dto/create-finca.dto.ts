import {
  IsString,
  IsNumber,
  IsOptional,
  IsArray,
  IsEnum,
  IsBoolean,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum PropertyType {
  FINCA = 'FINCA',
  CASA_CAMPESTRE = 'CASA_CAMPESTRE',
  VILLA = 'VILLA',
  HACIENDA = 'HACIENDA',
  QUINTA = 'QUINTA',
  APARTAMENTO = 'APARTAMENTO',
  CASA = 'CASA',
}

export enum PropertyCategory {
  ECONOMICA = 'ECONOMICA',
  ESTANDAR = 'ESTANDAR',
  PREMIUM = 'PREMIUM',
  LUJO = 'LUJO',
  ECOTURISMO = 'ECOTURISMO',
  CON_PISCINA = 'CON_PISCINA',
  CERCA_BOGOTA = 'CERCA_BOGOTA',
  GRUPOS_GRANDES = 'GRUPOS_GRANDES',
  VIP = 'VIP',
}

export class CreateFincaDto {
  @IsString()
  title: string;

  @IsString()
  description: string;

  @IsString()
  location: string;

  @IsNumber()
  @Min(1)
  capacity: number;

  @IsNumber()
  lat: number;

  @IsNumber()
  lng: number;

  @IsNumber()
  @Min(0)
  priceBase: number;

  @IsNumber()
  @Min(0)
  priceBaja: number;

  @IsNumber()
  @Min(0)
  priceMedia: number;

  @IsNumber()
  @Min(0)
  priceAlta: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  priceEspeciales?: number;

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsEnum(PropertyCategory)
  category?: PropertyCategory;

  @IsOptional()
  @IsEnum(PropertyType)
  type?: PropertyType;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  features?: string[];

  @IsOptional()
  @IsString()
  video?: string;

  /** Temporadas con fechas (opcionales) y valores; el cliente puede ver en qué temporada está y editar valores */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PricingItemDto)
  pricing?: PricingItemDto[];
}

export class PricingItemDto {
  @IsString()
  nombre: string;

  @IsOptional()
  @IsString()
  fechaDesde?: string;

  @IsOptional()
  @IsString()
  fechaHasta?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  valorUnico?: number;

  /** JSON string: array de { tipo, preciosPorRango?: [{ personas, cop }], valorUnico? } */
  @IsOptional()
  @IsString()
  condiciones?: string;

  /** Si true, el cliente final ve esta temporada; el admin puede activar/desactivar */
  @IsOptional()
  @IsBoolean()
  activa?: boolean;

  /**
   * JSON: reglas de la temporada para lógica de reservas.
   * Ejemplo: { "descripcion": "FDS mínimo 2 noches. 27-30 junio puente San Pedro.", "rangosFechas": [{"desde":"27-06","hasta":"30-06"}], "minNoches": 2, "diasSemana": {"incluir":["viernes","sabado","domingo"]}, "excepciones": ["15-12"] }
   */
  @IsOptional()
  @IsString()
  reglas?: string;

  @IsOptional()
  @IsNumber()
  order?: number;
}
