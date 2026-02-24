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
import { Type, Transform } from 'class-transformer';

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

const toNumber = (v: unknown) =>
  v === '' || v === undefined || v === null ? undefined : Number(v);

export class CreateFincaDto {
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  title: string;

  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  description: string;

  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  location: string;

  @IsNumber()
  @Min(1)
  @Transform(({ value }) => toNumber(value))
  capacity: number;

  @IsNumber()
  @Transform(({ value }) => toNumber(value))
  lat: number;

  @IsNumber()
  @Transform(({ value }) => toNumber(value))
  lng: number;

  @IsNumber()
  @Min(0)
  @Transform(({ value }) => toNumber(value))
  priceBase: number;

  /** Opcional. Si no se envía, se usa priceBase. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Transform(({ value }) => toNumber(value))
  priceBaja?: number;

  /** Opcional. Si no se envía, se usa priceBase. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Transform(({ value }) => toNumber(value))
  priceMedia?: number;

  /** Opcional. Si no se envía, se usa priceBase. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Transform(({ value }) => toNumber(value))
  priceAlta?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Transform(({ value }) => toNumber(value))
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

  /** En multipart envía varias: -F "features=Piscina" -F "features=BBQ" o JSON string. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') return value.includes('[') ? JSON.parse(value) : [value];
    return [];
  })
  features?: string[];

  @IsOptional()
  @IsString()
  video?: string;

  /** IDs de catálogos WhatsApp. En multipart puede llegar como JSON string o array. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => {
    if (typeof value === 'string') return value ? (value.includes('[') ? JSON.parse(value) : [value]) : [];
    return Array.isArray(value) ? value : [];
  })
  catalogIds?: string[];

  /** Temporadas (opcional). En multipart: JSON string. Ej: -F 'pricing=[{"nombre":"Baja","valorUnico":1200000}]' */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Transform(({ value }) => {
    if (!value) return [];
    const arr = typeof value === 'string' ? JSON.parse(value || '[]') : value;
    if (!Array.isArray(arr)) return [];
    const allowed = ['nombre', 'fechaDesde', 'fechaHasta', 'valorUnico', 'condiciones', 'activa', 'reglas', 'order'];
    return arr.map((o: Record<string, unknown>) => {
      const out: Record<string, unknown> = {};
      for (const k of allowed) if (o[k] !== undefined) out[k] = o[k];
      return out;
    });
  })
  @Type(() => PricingItemDto)
  pricing?: PricingItemDto[];
}

export class PricingItemDto {
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
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
  @Transform(({ value }) => toNumber(value))
  valorUnico?: number;

  /** JSON string: array de { tipo, preciosPorRango?: [{ personas, cop }], valorUnico? } */
  @IsOptional()
  @IsString()
  condiciones?: string;

  /** Si true, el cliente final ve esta temporada; el admin puede activar/desactivar */
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) =>
    value === undefined || value === null ? undefined : value === true || value === 'true' || value === 1
  )
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
