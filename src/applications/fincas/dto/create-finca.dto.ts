import {
  IsString,
  IsNumber,
  IsOptional,
  IsArray,
  IsEnum,
  IsBoolean,
  Min,
  IsInt,
  ValidateIf,
  ValidateNested,
  ArrayUnique,
  IsIn,
} from 'class-validator';
import { Type, Transform, plainToInstance } from 'class-transformer';
import {
  COLOMBIA_DEPARTMENT_CODES,
} from '../../shared/constants/colombia-departments';

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
  GLAMPING = 'GLAMPING',
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

  @IsOptional()
  @IsString()
  zoneTemplateSourceId?: string;

  /** Cantidad (ej. 2 hamacas). Alineado con Convex `propertyFeatures.quantity`. */
  @IsOptional()
  @Transform(({ value }) => {
    if (value === '' || value === undefined || value === null) return undefined;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 1) return undefined;
    return Math.floor(n);
  })
  @ValidateIf((_, v) => v !== undefined && v !== null)
  @IsInt()
  @Min(1)
  quantity?: number;
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

  /** Departamentos de Colombia donde se ubica o comercializa la finca. */
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null) return undefined;
    let arr: unknown;
    if (typeof value === 'string') {
      try {
        arr = value.trim() === '' ? [] : JSON.parse(value);
      } catch {
        arr = value.split(',').map((x) => x.trim());
      }
    } else {
      arr = value;
    }
    if (!Array.isArray(arr)) return [];
    const cleaned = arr
      .filter((x: unknown): x is string => typeof x === 'string')
      .map((x: string) => x.trim().toUpperCase())
      .filter((x: string) =>
        (COLOMBIA_DEPARTMENT_CODES as readonly string[]).includes(x),
      );
    return Array.from(new Set(cleaned)).slice(0, 1);
  })
  @IsArray()
  @IsString({ each: true })
  @ArrayUnique()
  @IsIn(COLOMBIA_DEPARTMENT_CODES as unknown as string[], { each: true })
  departamentos?: string[];

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

  /**
   * Si true, la finca puede enviarse en catálogos del bot Meta/WhatsApp.
   * Si false, sigue en la web solo como consulta (sin reserva en línea). Por defecto true.
   */
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) =>
    value === undefined || value === null
      ? true
      : value === true || value === 'true' || value === 1,
  )
  visibleInWhatsAppCatalog?: boolean;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) =>
    value === undefined || value === null
      ? false
      : value === true || value === 'true' || value === 1,
  )
  isFavorite?: boolean;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) =>
    value === undefined || value === null
      ? undefined
      : value === true || value === 'true' || value === 1,
  )
  allowsPets?: boolean;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) =>
    value === undefined || value === null
      ? undefined
      : value === true || value === 'true' || value === 1,
  )
  allowsEventsContent?: boolean;

  /** Máximo de invitados para evento (puede ser mayor que `capacity` de hospedaje). */
  @IsOptional()
  @Transform(({ value }) => {
    const n = toNumber(value);
    if (n === undefined || !Number.isFinite(n) || n < 1) return undefined;
    return Math.floor(n);
  })
  @ValidateIf((_, v) => v !== undefined && v !== null)
  @IsInt()
  @Min(1)
  eventCapacity?: number;

  /** Precio de referencia (COP) para evento hasta `eventCapacity` invitados. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Transform(({ value }) => toNumber(value))
  eventPackagePrice?: number;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) =>
    value === undefined || value === null
      ? undefined
      : value === true || value === 'true' || value === 1,
  )
  familyOnly?: boolean;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) =>
    value === undefined || value === null
      ? undefined
      : value === true || value === 'true' || value === 1,
  )
  serviceStaffAvailable?: boolean;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) =>
    value === undefined || value === null
      ? undefined
      : value === true || value === 'true' || value === 1,
  )
  serviceStaffMandatory?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Transform(({ value }) => toNumber(value))
  serviceStaffPrice?: number;

  /** Depósito reembolsable por daños a la propiedad (COP). */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Transform(({ value }) => toNumber(value))
  depositoDanosReembolsable?: number;

  /** Valor de manilla de ingreso al condominio (COP). */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Transform(({ value }) => toNumber(value))
  manillaCondominio?: number;

  /** Auxilio de aseo final (COP), cobro único por estadía. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Transform(({ value }) => toNumber(value))
  depositoAseo?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Transform(({ value }) => toNumber(value))
  priceOriginal?: number;

  /** En multipart envía como JSON string de array de objetos { name, iconId?, quantity?, zone?, ... } */
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

  @IsOptional()
  @IsString()
  contractTemplateUrl?: string;

  /** Si true, la finca aparece en /marketplace; el detalle prioriza contacto por WhatsApp para la compra. */
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) =>
    value === undefined || value === null
      ? false
      : value === true || value === 'true' || value === 1,
  )
  marketplaceForSale?: boolean;

  /** Valor de venta de referencia en COP (marketplace). */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Transform(({ value }) => toNumber(value))
  salePriceCop?: number;

  /** Metros cuadrados (marketplace / ficha en venta). */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Transform(({ value }) => toNumber(value))
  saleSquareMeters?: number;

  /** Descripción comercial para venta (distinta del arriendo). */
  @IsOptional()
  @IsString()
  saleDescription?: string;

  /**
   * IDs de pestañas del catálogo. Incluye los IDs del sitio (`luxury`, `melgar`, …)
   * y categorías personalizadas creadas desde el admin (slug en kebab-case).
   * Se valida formato básico para evitar contaminar la BD con IDs inválidos.
   */
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null) return undefined;
    let arr: unknown;
    if (typeof value === 'string') {
      try {
        arr = value.trim() === '' ? [] : JSON.parse(value);
      } catch {
        arr = [];
      }
    } else {
      arr = value;
    }
    if (!Array.isArray(arr)) return [];
    const cleaned = arr
      .filter((x: unknown): x is string => typeof x === 'string')
      .map((x: string) => x.trim().toLowerCase())
      .filter((x: string) => /^[a-z0-9][a-z0-9-]{0,63}$/.test(x));
    return Array.from(new Set(cleaned));
  })
  @IsArray()
  @IsString({ each: true })
  @ArrayUnique()
  catalogFilterTags?: string[];

  // Campos de archivos (multipart) gestionados por interceptores, no por el DTO.
  @IsOptional()
  @Transform(() => undefined)
  images?: unknown;

  @IsOptional()
  @Transform(() => undefined)
  contractTemplate?: unknown;

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

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => {
    if (typeof value === 'string')
      return value ? (value.includes('[') ? JSON.parse(value) : [value]) : [];
    return Array.isArray(value) ? value : [];
  })
  zoneOrder?: string[];

  @IsOptional()
  @IsString()
  propietarioNombre?: string;

  @IsOptional()
  @IsString()
  propietarioTelefono?: string;

  @IsOptional()
  @IsString()
  propietarioCedula?: string;

  @IsOptional()
  @IsString()
  propietarioCorreo?: string;
}

export class PricingItemDto {
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  nombre?: string;

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
  @IsString()
  globalRuleId?: string;

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

  /** Sub-reglas de precio por capacidad (cada una con su propio precio) */
  @IsOptional()
  @IsArray()
  subReglasCapacidad?: {
    capacidadMin: number;
    capacidadMax: number;
    valorUnico: number;
    subReglasNoches?: { nochesMin: number; nochesMax: number; valorUnico: number }[];
  }[];
}
