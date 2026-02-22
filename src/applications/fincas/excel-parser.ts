import * as XLSX from 'xlsx';
import { CreateFincaDto, PropertyCategory, PropertyType } from './dto/create-finca.dto';

// Estructura para precios por rango de personas o valor único (para pricingDetail JSON)
export interface PrecioPorRango {
  personas: string;
  cop: number;
}

export interface CondicionPrecio {
  tipo: string;
  preciosPorRango?: PrecioPorRango[];
  valorUnico?: number;
}

export interface TemporadaPrecio {
  nombre: string;
  fechaDesde?: string;
  fechaHasta?: string;
  condiciones: CondicionPrecio[];
}

export interface PricingDetail {
  temporadas: TemporadaPrecio[];
}

function normalizeHeader(h: unknown): string {
  if (h == null) return '';
  return String(h)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s()-]/g, '');
}

function findHeaderKey(
  headersNorm: Record<string, unknown>,
  ...candidates: string[]
): unknown {
  const keys = Object.keys(headersNorm);
  for (const c of candidates) {
    const found = keys.find((k) => k.includes(c) || c.includes(k));
    if (found) return headersNorm[found];
  }
  return undefined;
}

/** Para celdas con un solo número (ej. precio catálogo). No usar en celdas con varias líneas COP. */
function parseMoney(value: unknown): number | null {
  if (value == null || value === '') return null;
  const str = String(value).replace(/[^\d]/g, '');
  return str ? Number(str) : null;
}

/**
 * Extrae el primer o mínimo valor COP de una celda que puede tener varias líneas
 * (ej. "COP 1,600,000.00 1-16 personas\nCOP 1,700,000.00 17-23 personas").
 * Así evitamos concatenar dígitos y obtener números erróneos como 160000000170000000.
 */
function parseFirstMoneyFromCell(value: unknown): number | null {
  if (value == null || value === '') return null;
  const text = String(value).replace(/\r\n/g, '\n').trim();
  const amounts: number[] = [];
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const match = line.match(/COP\s*([\d.,]+)/i);
    if (match) {
      const copStr = match[1].replace(/[^\d]/g, '');
      if (copStr) amounts.push(Number(copStr));
    }
  }
  if (amounts.length === 0) return null;
  return Math.min(...amounts);
}

const SECCIONES = ['TOLIMA', 'CUNDINAMARCA', 'EJE CAFETERO', 'LLANOS ORIENTALES'];

function isSectionRow(nombre: unknown): boolean {
  if (!nombre) return true;
  const val = String(nombre).trim().toUpperCase();
  return SECCIONES.includes(val);
}

function slug(str: unknown): string {
  if (!str) return '';
  return String(str)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, '-')
    .replace(/[^\w-]/g, '')
    .slice(0, 30);
}

function serviciosToFeatures(servicios: unknown): string[] {
  if (!servicios) return [];
  const raw = String(servicios)
    .replace(/\r\n/g, '\n')
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set(raw)].slice(0, 20);
}

// Clasifica el header de una columna de precios: temporada + condición + fechas + reglas
function classifyPricingHeader(headerNorm: string, headerOriginal: string): {
  temporada: 'baja' | 'alta' | 'media' | 'especiales' | 'catalogo' | null;
  condicion: string | null;
  fechaDesde?: string;
  fechaHasta?: string;
  reglas?: string; // Texto completo del header original con las reglas descriptivas
} {
  let temporada: 'baja' | 'alta' | 'media' | 'especiales' | 'catalogo' | null = null;
  let condicion: string | null = null;

  // Detectar temporada
  if (headerNorm.includes('temporada baja')) temporada = 'baja';
  else if (headerNorm.includes('temporada alta')) temporada = 'alta';
  else if (headerNorm.includes('temporada media')) temporada = 'media';
  else if (
    headerNorm.includes('fechas especiales') ||
    headerNorm.includes('21 diciembre') ||
    (headerNorm.includes('especiales') && !headerNorm.includes('temporada'))
  )
    temporada = 'especiales';
  else if (headerNorm.includes('catalogo') || headerNorm.includes('precio catalogo'))
    temporada = 'catalogo';

  // Detectar condiciones (pueden estar solas o dentro de una temporada)
  if (headerNorm.includes('1 noche') || headerNorm.includes('una noche')) {
    condicion = 'Una noche';
    // Si no hay temporada explícita, puede ser condición general o de la temporada anterior
    if (!temporada) temporada = null; // Se asociará después según contexto
  } else if (
    headerNorm.includes('mas de 3 noches') ||
    headerNorm.includes('más de 3 noches') ||
    headerNorm.includes('mas de tres noches') ||
    headerNorm.includes('mas de 3 noches que no comtemple temporada alta')
  ) {
    condicion = 'Más de 3 noches';
    if (!temporada) temporada = null;
  } else if (headerNorm.includes('mas de 10 noches') || headerNorm.includes('más de 10 noches')) {
    condicion = 'Más de 10 noches';
    if (!temporada) temporada = null;
  } else if (
    headerNorm.includes('no aplica') ||
    headerNorm.includes('numero de personas') ||
    headerNorm.includes('número de personas')
  ) {
    condicion = 'No aplica número de personas';
    if (!temporada) temporada = null;
  }

  // Si detectamos temporada pero no condición, es la columna principal de esa temporada
  if (temporada && !condicion) condicion = 'General';

  // Extraer fechas del header original (preservar formato)
  const fechaMatch = headerOriginal.match(
    /(\d{1,2}\s+(?:de\s+)?\w+)(?:\s*-\s*(\d{1,2}\s+(?:de\s+)?\w+))?/i
  );
  const fechaDesde = fechaMatch ? fechaMatch[1].trim() : undefined;
  const fechaHasta = fechaMatch && fechaMatch[2] ? fechaMatch[2].trim() : undefined;

  // Extraer reglas completas del header original (todo el texto descriptivo)
  const reglas = headerOriginal.trim();

  return { temporada, condicion, fechaDesde, fechaHasta, reglas };
}

// Parsea el contenido de una celda: "COP 2,100,000.00 1-16 personas" o "COP 3.700.000" o varias líneas
function parsePricingCell(cell: unknown): {
  preciosPorRango: PrecioPorRango[];
  valorUnico: number | null;
} {
  const preciosPorRango: PrecioPorRango[] = [];
  let valorUnico: number | null = null;

  if (cell == null || cell === '') return { preciosPorRango, valorUnico };

  const text = String(cell).replace(/\r\n/g, '\n').trim();
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);

  for (const line of lines) {
    // COP 1,200,000.00 1-16 personas  o  COP 1,200,000.00 17-23 personas  o  COP 3.700.000.00
    const match = line.match(/COP\s*([\d.,]+)(?:\s+(\d+)\s*-\s*(\d+)\s*personas)?/i);
    if (!match) continue;

    const copStr = match[1].replace(/[^\d]/g, '');
    const cop = copStr ? Number(copStr) : 0;
    const personas = match[2] && match[3] ? `${match[2]}-${match[3]}` : 'all';

    if (personas === 'all') {
      if (valorUnico == null) valorUnico = cop;
    } else {
      preciosPorRango.push({ personas, cop });
    }
  }

  return { preciosPorRango, valorUnico };
}

const NOMBRES_TEMPORADA: Record<string, string> = {
  baja: 'Temporada Baja',
  alta: 'Temporada Alta',
  media: 'Temporada Media',
  especiales: 'Fechas especiales',
};

export function parseExcelToFincas(buffer: Buffer): CreateFincaDto[] {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(sheet, { defval: null }) as Record<string, unknown>[];

  if (data.length === 0) return [];

  // Primera fila para detectar columnas de precios
  const firstRow = data[0];
  const pricingColumns: Array<{
    key: string;
    headerNorm: string;
    headerOriginal: string;
    temporada: 'baja' | 'alta' | 'media' | 'especiales' | 'catalogo' | null;
    condicion: string | null;
    fechaDesde?: string;
    fechaHasta?: string;
    reglas?: string;
  }> = [];

  for (const key of Object.keys(firstRow)) {
    const headerOriginal = String(key).trim();
    const headerNorm = normalizeHeader(key);
    if (
      headerNorm.includes('temporada') ||
      headerNorm.includes('catalogo') ||
      headerNorm.includes('precio') ||
      headerNorm.includes('noches') ||
      headerNorm.includes('no aplica') ||
      headerNorm.includes('fechas especiales') ||
      headerNorm.includes('cop') ||
      headerNorm.includes('21 diciembre') ||
      headerNorm.includes('si 1 noche') ||
      headerNorm.includes('si son mas de 3') ||
      headerNorm.includes('si es mas de 10')
    ) {
      const classified = classifyPricingHeader(headerNorm, headerOriginal);
      if (classified.temporada || classified.condicion) {
        pricingColumns.push({
          key,
          headerNorm,
          headerOriginal,
          temporada: classified.temporada,
          condicion: classified.condicion,
          fechaDesde: classified.fechaDesde,
          fechaHasta: classified.fechaHasta,
          reglas: classified.reglas,
        });
      }
    }
  }

  const result: CreateFincaDto[] = [];

  for (const row of data) {
    const headersNorm: Record<string, unknown> = {};
    for (const key of Object.keys(row)) {
      headersNorm[normalizeHeader(key)] = row[key];
    }

    const nombre = findHeaderKey(
      headersNorm,
      'nombres de las fincas',
      'nombres de las finca',
      'nombre',
    );
    if (!nombre || isSectionRow(nombre)) continue;

    const descripcion = findHeaderKey(headersNorm, 'descripcion') ?? '';
    const servicios = findHeaderKey(headersNorm, 'servicios');
    const municipio = findHeaderKey(headersNorm, 'municipio') ?? 'Colombia';
    const contrato = findHeaderKey(headersNorm, 'contrato');

    const precioCatalogo = parseFirstMoneyFromCell(
      findHeaderKey(headersNorm, 'precio catalogo whatsapp', 'precio catalogo'),
    );
    const fechaEspecial = parseFirstMoneyFromCell(
      findHeaderKey(
        headersNorm,
        'si es fechas especiales21 diciembre - 5 enero',
        'fechas especiales',
        '21 diciembre',
      ),
    );
    const rawTemporadaAlta = findHeaderKey(
      headersNorm,
      'temporada alta fds minimo 2 noches 3 dias',
      'temporada alta',
    );
    const rawTemporadaBaja = findHeaderKey(
      headersNorm,
      'temporada baja inicia el 14 de enero',
      'temporada baja',
    );
    const rawTemporadaMedia = findHeaderKey(
      headersNorm,
      'temporada media festivos que comprenden',
      'temporada media',
    );
    const si1Noche = parseFirstMoneyFromCell(findHeaderKey(headersNorm, 'si 1 noche'));

    // Construir pricingDetail desde columnas de precios
    const temporadasMap = new Map<
      string,
      {
        fechaDesde?: string;
        fechaHasta?: string;
        reglas?: string;
        condiciones: Map<string, CondicionPrecio>;
      }
    >();

    // Primero, procesar columnas que tienen temporada explícita (para obtener reglas y fechas)
    for (const col of pricingColumns) {
      if (!col.temporada) continue; // Solo las que tienen temporada definida

      const temporadaName = NOMBRES_TEMPORADA[col.temporada] ?? col.temporada;
      if (!temporadasMap.has(temporadaName)) {
        temporadasMap.set(temporadaName, {
          fechaDesde: col.fechaDesde,
          fechaHasta: col.fechaHasta,
          reglas: col.reglas, // Guardar el texto completo de las reglas
          condiciones: new Map(),
        });
      }
    }

    // Luego, procesar todas las columnas (incluyendo condiciones independientes)
    for (const col of pricingColumns) {
      const cellValue = row[col.key];
      const { preciosPorRango, valorUnico } = parsePricingCell(cellValue);

      // Si la columna tiene temporada explícita, usar esa temporada
      // Si no, intentar asociarla a la última temporada detectada o crear "General"
      let temporadaName: string;
      if (col.temporada) {
        temporadaName = NOMBRES_TEMPORADA[col.temporada] ?? col.temporada;
      } else if (col.condicion) {
        // Condición independiente: buscar si hay una temporada reciente o usar "General"
        // Por ahora, si es "Si 1 noche" o "Más de 3 noches" sin temporada, lo ponemos en "General"
        temporadaName = 'General';
      } else {
        continue; // Skip columnas sin sentido
      }

      if (!temporadasMap.has(temporadaName)) {
        temporadasMap.set(temporadaName, {
          fechaDesde: col.fechaDesde,
          fechaHasta: col.fechaHasta,
          reglas: col.reglas,
          condiciones: new Map(),
        });
      }

      const entry = temporadasMap.get(temporadaName)!;
      const condicionTipo = col.condicion ?? 'General';

      // Actualizar reglas si esta columna tiene el texto completo de la temporada
      if (col.reglas && col.temporada && col.reglas.length > (entry.reglas?.length || 0)) {
        entry.reglas = col.reglas;
      }

      if (preciosPorRango.length > 0) {
        entry.condiciones.set(condicionTipo, {
          tipo: condicionTipo,
          preciosPorRango,
        });
      } else if (valorUnico != null) {
        entry.condiciones.set(condicionTipo, {
          tipo: condicionTipo,
          valorUnico,
        });
      }
    }

    const temporadas: TemporadaPrecio[] = [];
    for (const [nombreTemp, entry] of temporadasMap) {
      temporadas.push({
        nombre: nombreTemp,
        fechaDesde: entry.fechaDesde,
        fechaHasta: entry.fechaHasta,
        condiciones: Array.from(entry.condiciones.values()),
      });
    }

    // Orden: baja, media, alta, especiales
    const orden = ['Temporada Baja', 'Temporada Media', 'Temporada Alta', 'Fechas especiales', 'General'];
    temporadas.sort(
      (a, b) => orden.indexOf(a.nombre) - orden.indexOf(b.nombre) || a.nombre.localeCompare(b.nombre)
    );

    // Una fila por temporada para la tabla propertyPricing: fechas (opcionales), valores y reglas
    const pricing =
      temporadas.length > 0
        ? temporadas.map((t, index) => {
            const soloValorUnico =
              t.condiciones.length === 1 &&
              t.condiciones[0].valorUnico != null &&
              !t.condiciones[0].preciosPorRango?.length;

            // Buscar las reglas desde el map original
            const entry = temporadasMap.get(t.nombre);
            const reglasCompletas = entry?.reglas;

            // Construir JSON de reglas si hay texto descriptivo
            let reglasJson: string | undefined;
            if (reglasCompletas && reglasCompletas.length > 50) {
              // Solo guardar reglas si son significativas (más que solo el nombre)
              reglasJson = JSON.stringify({
                descripcion: reglasCompletas,
                fechaDesde: t.fechaDesde,
                fechaHasta: t.fechaHasta,
              });
            }

            return {
              nombre: t.nombre,
              fechaDesde: t.fechaDesde,
              fechaHasta: t.fechaHasta,
              valorUnico: soloValorUnico ? t.condiciones[0].valorUnico : undefined,
              condiciones: soloValorUnico ? undefined : JSON.stringify(t.condiciones),
              activa: true,
              reglas: reglasJson,
              order: index,
            };
          })
        : undefined;

    // Derivar números para priceBaja, priceMedia, priceAlta, priceEspeciales (compatibilidad)
    function getPrecioRepresentativo(temp: TemporadaPrecio): number | null {
      for (const c of temp.condiciones) {
        if (c.valorUnico != null) return c.valorUnico;
        if (c.preciosPorRango?.length) {
          const min = Math.min(...c.preciosPorRango.map((p) => p.cop));
          return min;
        }
      }
      return null;
    }

    const tb = temporadas.find((t) => t.nombre === 'Temporada Baja');
    const tm = temporadas.find((t) => t.nombre === 'Temporada Media');
    const ta = temporadas.find((t) => t.nombre === 'Temporada Alta');
    const te = temporadas.find((t) => t.nombre === 'Fechas especiales');

    const priceBajaNum =
      (tb ? getPrecioRepresentativo(tb) : null) ?? parseFirstMoneyFromCell(rawTemporadaBaja);
    const priceMediaNum =
      (tm ? getPrecioRepresentativo(tm) : null) ?? parseFirstMoneyFromCell(rawTemporadaMedia);
    const priceAltaNum =
      (ta ? getPrecioRepresentativo(ta) : null) ?? parseFirstMoneyFromCell(rawTemporadaAlta);
    const priceEspecialesNum =
      (te ? getPrecioRepresentativo(te) : null) ?? fechaEspecial;

    const priceBase = precioCatalogo ?? si1Noche ?? 500000;
    const priceBaja = priceBajaNum ?? priceBase;
    const priceMedia = priceMediaNum ?? priceBase;
    const priceAlta = priceAltaNum ?? priceBase;
    const priceEspeciales = priceEspecialesNum ?? priceAlta;

    const descriptionFinal = [descripcion, contrato ? `Contrato: ${contrato}` : null]
      .filter(Boolean)
      .join('\n\n');

    result.push({
      title: String(nombre).trim(),
      description: descriptionFinal || 'Sin descripción',
      location: String(municipio).trim(),
      capacity: 10,
      lat: 4.0,
      lng: -74.0,
      priceBase,
      priceBaja,
      priceMedia,
      priceAlta,
      priceEspeciales,
      code: slug(nombre) || undefined,
      category: PropertyCategory.ESTANDAR,
      type: PropertyType.FINCA,
      features: serviciosToFeatures(servicios),
      pricing,
    });
  }

  return result;
}
