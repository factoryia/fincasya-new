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
import { Type, Transform, plainToInstance } from 'class-transformer';

export enum PropertyType {
  FINCA = 'FINCA',
  CASA_CAMPESTRE = 'CASA_CAMPESTRE',
  VILLA = 'VILLA',
  HACIENDA = 'HACIENDA',
  QUINTA = 'QUINTA',
  APARTAMENTO = 'APARTAMENTO',
  CASA = 'CASA',
  CASA_PRIVADA = 'CASA_PRIVADA',
  CASA_EN_CONJUNTO_CERRADO = 'CASA_EN_CONJUNTO_CERRADO',
  VILLA_PRIVADA = 'VILLA_PRIVADA',
  CONDOMINIO = 'CONDOMINIO',
  CASA_BOUTIQUE = 'CASA_BOUTIQUE',
  YATE = 'YATE',
  ISLA = 'ISLA',
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

export class FeatureItemDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  iconId?: string;

  @IsOptional()
  @IsString()
  iconUrl?: string | null;

  @IsOptional()
  @IsString()
  emoji?: string | null;

  @IsOptional()
  @IsString()
  zone?: string;
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

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Transform(({ value }) => toNumber(value))
  rating?: number;

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

  /** Si false, la finca está desactivada y no se muestra en la web principal. Por defecto true. */
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) =>
    value === undefined || value === null
      ? true
      : value === true || value === 'true' || value === 1,
  )
  active?: boolean;

  /** Si true, la finca aparece en el listado público. Por defecto true. */
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) =>
    value === undefined || value === null
      ? true
      : value === true || value === 'true' || value === 1,
  )
  visible?: boolean;

  /** Si true, se puede reservar desde la página web. Por defecto true. */
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) =>
    value === undefined || value === null
      ? true
      : value === true || value === 'true' || value === 1,
  )
  reservable?: boolean;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) =>
    value === undefined || value === null
      ? false
      : value === true || value === 'true' || value === 1,
  )
  isFavorite?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Transform(({ value }) => toNumber(value))
  priceOriginal?: number;

  /** En multipart envía como JSON string de array de objetos { name, iconId } */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FeatureItemDto)
  @Transform(({ value }) => {
    if (!value) return [];

    // Parse JSON si viene como string
    let parsedValue = value;
    if (typeof value === 'string') {
      try {
        parsedValue = value.includes('[') ? JSON.parse(value) : [value];
      } catch (e) {
        parsedValue = [value];
      }
    }

    if (!Array.isArray(parsedValue)) return [];

    return parsedValue
      .map((item) => {
        let obj: any;
        if (typeof item === 'string' && item.startsWith('{')) {
          try {
            obj = JSON.parse(item);
          } catch (e) {
            obj = { name: item };
          }
        } else if (typeof item === 'object' && item !== null) {
          obj = item;
        } else {
          obj = { name: String(item) };
        }
        return plainToInstance(FeatureItemDto, obj);
      })
      .filter((i) => !!i.name);
  })
  features?: FeatureItemDto[];

  @IsOptional()
  @IsString()
  video?: string;

  // Campo presente en multipart pero gestionado por el interceptor, no por el DTO.
  // Se marca opcional y se limpia para que no rompa el whitelist.
  @IsOptional()
  @Transform(() => undefined)
  images?: unknown;

  /** IDs de catálogos WhatsApp. En multipart puede llegar como JSON string o array. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => {
    if (typeof value === 'string')
      return value ? (value.includes('[') ? JSON.parse(value) : [value]) : [];
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
    // Convertir explícitamente cada item a instancia de PricingItemDto
    return plainToInstance(PricingItemDto, arr);
  })
  @Type(() => PricingItemDto)
  pricing?: PricingItemDto[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => {
    if (typeof value === 'string')
      return value ? (value.includes('[') ? JSON.parse(value) : [value]) : [];
    return Array.isArray(value) ? value : [];
  })
  featuredIcons?: string[];
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
  @IsArray()
  @IsString({ each: true })
  fechas?: string[];

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
    value === undefined || value === null
      ? undefined
      : value === true || value === 'true' || value === 1,
  )
  activa?: boolean;

  /**
   * JSON: reglas de la temporada para lógica de reservas o array de fechas específicas.
   * En multipart llega como string, pero en JSON puede llegar como objeto.
   */
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'object') return JSON.stringify(value);
    return value;
  })
  reglas?: string;

  @IsOptional()
  @IsNumber()
  order?: number;
}
