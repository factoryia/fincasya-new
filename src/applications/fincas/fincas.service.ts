import {
  Injectable,
  NotFoundException,
  BadRequestException,
  forwardRef,
  Inject,
} from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';
import * as path from 'path';

const PizZip = require('pizzip');

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `{{` … `}}` cuyo interior, sin XML, coincide exactamente con key (p. ej. letras + nbsp) */
function replaceByPlainInnerKey(
  xml: string,
  key: string,
  valueXmlEscaped: string,
): string {
  const keyNorm = key.replace(/\s+/g, ' ').trim();
  if (!keyNorm) return xml;
  let s = xml;
  let from = 0;
  for (;;) {
    const open = s.indexOf('{{', from);
    if (open === -1) break;
    const close = s.indexOf('}}', open + 2);
    if (close === -1) {
      from = open + 2;
      continue;
    }
    const inner = s.slice(open + 2, close);
    const innerPlain = inner
      .replace(/<[^>]+>/g, '')
      .replace(
        /&nbsp;|&#0*160;|&#x0*A0;|&#32;|&#x20;|&amp;#160;|&amp;#32;/gi,
        ' ',
      )
      .replace(/\s+/g, ' ')
      .trim();
    if (innerPlain === keyNorm) {
      s = s.slice(0, open) + valueXmlEscaped + s.slice(close + 2);
      from = open + valueXmlEscaped.length;
    } else {
      from = close + 2;
    }
  }
  return s;
}

const WORD_TEMPLATE_GAP =
  '(?:<[^>]+>|[\\s\\u00A0\\u200B\\uFEFF]|&nbsp;|&#0*160;|&#x0*A0;|&#32;|&#x20;)*';

/** Escapa texto plano para nodos `<w:t>` de Word. */
function escapeWordPlainText(rawVal: string): string {
  return (rawVal ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Una línea por párrafo alineado a la izquierda (listas en contrato Word). */
function buildWordLeftAlignedParagraphs(
  lines: string[],
  bold = false,
): string {
  const rPr = bold ? '<w:rPr><w:b/><w:bCs/></w:rPr>' : '';
  return lines
    .map((line) => {
      const t = escapeWordPlainText(line);
      return `<w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r>${rPr}<w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
    })
    .join('');
}

function findEnclosingWordParagraph(
  xml: string,
  innerStart: number,
  innerEnd: number,
): { start: number; end: number } | null {
  const pStart = xml.lastIndexOf('<w:p', innerStart);
  if (pStart === -1) return null;
  const pEnd = xml.indexOf('</w:p>', innerEnd);
  if (pEnd === -1) return null;
  return { start: pStart, end: pEnd + '</w:p>'.length };
}

function buildWordBankAccountsInlineXml(lines: string[]): string {
  return lines
    .map((line, i) => {
      const t = escapeWordPlainText(line);
      const br = i > 0 ? '<w:r><w:br/></w:r>' : '';
      return `${br}<w:r><w:t xml:space="preserve">${t}</w:t></w:r>`;
    })
    .join('');
}

/**
 * Sustituye el bloque {{cuentaNumero}}…{{titularCedula}} por varias cuentas
 * (salto de línea entre cada una) cuando hay 2+ cuentas en el contrato.
 */
function replaceWordBankAccountPlaceholderCluster(
  xml: string,
  lines: string[],
): string {
  if (lines.length <= 1) return xml;
  const gap = WORD_TEMPLATE_GAP;
  const cuentaKey = Array.from('cuentaNumero')
    .map((ch) => escapeRegExp(ch))
    .join(gap);
  const titularKey = Array.from('titularCedula')
    .map((ch) => escapeRegExp(ch))
    .join(gap);
  const re = new RegExp(
    `(\\{${gap}\\{${gap}${cuentaKey}${gap}\\}${gap}\\}|\\{\\{${gap}${cuentaKey}${gap}\\}\\})[\\s\\S]*?(\\{${gap}\\{${gap}${titularKey}${gap}\\}${gap}\\}|\\{\\{${gap}${titularKey}${gap}\\}\\})`,
  );
  const inline = buildWordBankAccountsInlineXml(lines);
  return xml.replace(re, inline);
}

/**
 * Sustituye el párrafo que contiene {{caracteristicasDeFinca}} por líneas
 * alineadas a la izquierda. Evita que Word justifique cada ítem en una sola línea.
 */
function replaceWordListPlaceholderWithLeftAlign(
  xml: string,
  key: string,
  rawVal: string,
): string {
  const keyPart = Array.from(key)
    .map((ch) => escapeRegExp(ch))
    .join(WORD_TEMPLATE_GAP);
  const re = new RegExp(
    `\\{${WORD_TEMPLATE_GAP}\\{${WORD_TEMPLATE_GAP}${keyPart}${WORD_TEMPLATE_GAP}\\}${WORD_TEMPLATE_GAP}\\}|\\{\\{${WORD_TEMPLATE_GAP}${keyPart}${WORD_TEMPLATE_GAP}\\}\\}`,
  );
  const match = re.exec(xml);
  if (!match) return xml;

  const lines = (rawVal ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const replacement = lines.length
    ? buildWordLeftAlignedParagraphs(lines, true)
    : '';

  const para = findEnclosingWordParagraph(
    xml,
    match.index,
    match.index + match[0].length,
  );
  if (!para) {
    return xml.replace(re, escapeWordTemplateValue(rawVal));
  }
  return xml.slice(0, para.start) + replacement + xml.slice(para.end);
}

/** Escapa texto para XML de Word; los saltos de línea se convierten en `<w:br/>`. */
function escapeWordTemplateValue(rawVal: string): string {
  let v = (rawVal ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  if (v.includes('\n')) {
    v = v
      .replace(/\r\n/g, '\n')
      .replace(
        /\n/g,
        '</w:t></w:r><w:br/><w:r><w:t xml:space="preserve">',
      );
  }
  return v;
}

/**
 * Sustituye {key} / {{key}} en el XML de Word aunque Word haya partido el texto
 * o las llaves entre múltiples w:r / w:t (sin docxtemplater).
 */
function applyWordTemplateReplacements(
  xml: string,
  values: Record<string, string>,
): string {
  let s = xml;
  s = s.replace(/<w:proofErr[^/>]*\/>/g, '');
  s = s.replace(/<w:proofErr[^>]*>[\s\S]*?<\/w:proofErr>/g, '');
  s = s.replace(/<w:softHyphen\/>/g, '');
  s = s.replace(/<w:noBreakHyphen\/>/g, '');
  s = s.replace(/<w:tab\/>/g, ' ');

  // Entre letras, alrededor de `{{`/`}}` o entre clave y cierre: Word mete
  // espacios / &nbsp; / w:tab, no solo etiquetas (antes solo aceptábamos XML
  // y fallaba "llave" + espacio + `}}`).
  const gap = WORD_TEMPLATE_GAP;

  const entries = Object.entries(values)
    .filter(([k, v]) => k && v !== undefined)
    .map(([k, v]) => [k, v ?? ''] as [string, string])
    .sort((a, b) => b[0].length - a[0].length);

  for (const [key, rawVal] of entries) {
    if (!key.trim()) continue;
    const val = escapeWordTemplateValue(rawVal);
    const keyPart = Array.from(key)
      .map((ch) => escapeRegExp(ch))
      .join(gap);
    // `{{` / `}}` a veces quedan como { + { o } + } con XML/espacio entre medias
    const reDouble = new RegExp(
      `\\{${gap}\\{${gap}${keyPart}${gap}\\}${gap}\\}`,
      'g',
    );
    s = s.replace(reDouble, val);
    const reDoubleTight = new RegExp(
      `\\{\\{${gap}${keyPart}${gap}\\}\\}`,
      'g',
    );
    s = s.replace(reDoubleTight, val);
    const reSingle = new RegExp(
      `\\{${gap}${keyPart}${gap}\\}`,
      'g',
    );
    s = s.replace(reSingle, val);
  }
  for (const [key, rawVal] of entries) {
    if (!key.trim()) continue;
    s = replaceByPlainInnerKey(s, key, escapeWordTemplateValue(rawVal));
  }
  s = s.replace(/\{\{[^}]*\}\}/g, '');
  s = s.replace(/\{[A-Za-z0-9_\s\u00C0-\u024F.,()$-]+\}/g, '');
  return s;
}

/** Axios `arraybuffer` puede devolver ArrayBuffer; sin esto `slice().toString()` no es "PK" y el .docx se trata mal. */
function normalizeDownloadedFile(data: unknown): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (ArrayBuffer.isView(data)) {
    const v = data;
    return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
  }
  return Buffer.from(String(data));
}

import ILovePDFApi from '@ilovepdf/ilovepdf-nodejs';
import ILovePDFFile from '@ilovepdf/ilovepdf-nodejs/ILovePDFFile';

import axios from 'axios';
import { ConvexService } from '../shared/services/convex.service';
import { S3Service } from '../shared/services/s3.service';
import { InboxService } from '../inbox/inbox.service';
import { CreateFincaDto } from './dto/create-finca.dto';
import { UpdateFincaDto } from './dto/update-finca.dto';
import { mergeDepositIntoPropertyDescription } from './property-description-deposits';
import { getDepartmentLabel } from '../shared/constants/colombia-departments';
import { ListFincasDto } from './dto/list-fincas.dto';
import { PdfService, ReservationConfirmationData } from '../shared/services/pdf.service';
import { parseExcelToFincas } from './excel-parser';
import {
  GlobalPricingRuleDto,
  UpdateGlobalPricingRuleDto,
} from './dto/global-pricing.dto';
import { UpdateOwnerInfoDto } from './dto/owner-info.dto';
import { GenerateContractDto } from './dto/generate-contract.dto';
import { loadDefaultContractTemplateBytes } from './contract-default-template';
import {
  buildBankAccountsPlainSnippet,
  buildBankAccountsWordLines,
  formatFincaFeaturesPlain,
  parseContractSettingsPayload,
  resolveContractMoneyLabel,
} from './contract-template-values';
import { buildCatalogProductDescription } from './catalog-description';
import { buildCatalogPriceFields } from './catalog-price';
import {
  DEFAULT_CONSULTANT_SYSTEM_PROMPT,
  PROMPT_INTERNAL_PAGE_ID,
  extractContractSentAutomaticMessage,
} from '../../lib/consultantPrompt';

@Injectable()
export class FincasService {
  constructor(
    private readonly convexService: ConvexService,
    private readonly s3Service: S3Service,
    private readonly pdfService: PdfService,
    @Inject(forwardRef(() => InboxService))
    private readonly inboxService: InboxService,
  ) {}

  private cleanOptionalText(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const clean = value.trim();
    return clean.length > 0 ? clean : undefined;
  }

  private async getEffectiveConsultantPrompt(): Promise<string> {
    try {
      const data = (await this.convexService.query('internalPages:getById', {
        pageId: PROMPT_INTERNAL_PAGE_ID,
      })) as { prompt?: unknown } | null;
      const customPrompt =
        data && typeof data.prompt === 'string' ? data.prompt.trim() : '';
      return customPrompt.length > 0
        ? customPrompt
        : DEFAULT_CONSULTANT_SYSTEM_PROMPT;
    } catch {
      return DEFAULT_CONSULTANT_SYSTEM_PROMPT;
    }
  }

  private async getContractSentAutomaticMessage(): Promise<string> {
    const effectivePrompt = await this.getEffectiveConsultantPrompt();
    return (
      extractContractSentAutomaticMessage(effectivePrompt) ||
      extractContractSentAutomaticMessage(DEFAULT_CONSULTANT_SYSTEM_PROMPT) ||
      `✨ *Tu reserva, con respaldo y total confianza*

Queremos que vivas una experiencia segura desde el primer momento. Por eso, antes de cualquier pago, recibirás tu **contrato de arrendamiento** y toda nuestra documentación legal para que valides quiénes somos y tengas plena tranquilidad 🔐

💳 *Opciones de pago flexibles*
Elige el medio que prefieras: Davivienda, BBVA, Bancolombia, Nequi, PSE, tarjeta de crédito o Llaves.

💰 *¿Cómo aseguras tu finca?*
Con un **anticipo del 50%** reservas tu fecha. El valor restante lo pagas directamente al momento de recibir la finca, una vez confirmes que todo está en perfecto estado 👌

📍 *Después de tu reserva*
Al confirmar tu pago, recibirás el *soporte oficial* junto con todos los detalles y la ubicación exacta de la propiedad.

🤝 En FincasYa.com no solo reservas una finca, aseguras una experiencia confiable, clara y respaldada en cada paso.`
    );
  }

  private async finalizeHumanContractFlow(
    conversationId: string,
    dto: GenerateContractDto,
  ) {
    try {
      await this.inboxService.updateContactForConversation(conversationId, {
        name: this.cleanOptionalText(dto.clientName),
        cedula: this.cleanOptionalText(dto.clientId),
        email: this.cleanOptionalText(dto.clientEmail),
        city: this.cleanOptionalText(dto.clientCity),
      });
    } catch (error: unknown) {
      console.warn(
        `[api] No se pudo sincronizar la ficha del contacto para ${conversationId}:`,
        error instanceof Error ? error.message : error,
      );
    }

    try {
      await this.convexService.mutation('conversations:setToAiPublic', {
        conversationId,
      });
      await this.convexService.mutation('conversations:setOperationalState', {
        conversationId,
        operationalState: 'pending_payment',
      });
    } catch (error: unknown) {
      console.warn(
        `[api] No se pudo actualizar el estado conversacional tras enviar contrato en ${conversationId}:`,
        error instanceof Error ? error.message : error,
      );
    }

    try {
      const followUpMessage = await this.getContractSentAutomaticMessage();
      await this.inboxService.sendMessage(conversationId, {
        type: 'text',
        text: followUpMessage,
      });
    } catch (error: unknown) {
      console.error(
        `[api] No se pudo enviar el mensaje automático posterior al contrato en ${conversationId}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  async list(listDto: ListFincasDto) {
    try {
      // Si hay un término de búsqueda, usamos la query de búsqueda de Convex
      if (listDto.search) {
        const results = await this.convexService.query('fincas:search', {
          query: listDto.search,
          limit: listDto.limit || 50,
        });
        return {
          properties: results,
          hasMore: false,
          total: results.length,
        };
      }

      // Si hay fechas, usar searchAvailableByDates para filtrar disponibilidad
      if (listDto.fechaEntrada && listDto.fechaSalida) {
        const entradaMs = new Date(listDto.fechaEntrada).getTime();
        const salidaMs = new Date(listDto.fechaSalida).getTime();
        if (!isNaN(entradaMs) && !isNaN(salidaMs) && salidaMs > entradaMs) {
          const results = await this.convexService.query(
            'fincas:searchAvailableByDates',
            {
              fechaEntrada: entradaMs,
              fechaSalida: salidaMs,
              limit: listDto.limit || 50,
              ...(listDto.minCapacity != null
                ? { minCapacity: listDto.minCapacity }
                : {}),
            },
          );
          // Filtrar por location si se especifica
          const filtered =
            listDto.location
              ? results.filter((p: any) =>
                  p.location
                    ?.toLowerCase()
                    .includes(listDto.location!.toLowerCase()),
                )
              : results;
          return {
            properties: filtered,
            hasMore: false,
            total: filtered.length,
          };
        }
      }

      // Filtrar propiedades undefined para evitar errores en Convex
      const { fechaEntrada: _fe, fechaSalida: _fs, ...rest } = listDto;
      const args = Object.fromEntries(
        Object.entries(rest).filter(
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
    numeroMascotas?: number,
    incluirServicio?: boolean,
  ) {
    try {
      return await this.convexService.query('fincas:calculateStayPrice', {
        propertyId,
        fechaEntrada,
        fechaSalida,
        numeroPersonas,
        numeroMascotas,
        incluirServicio,
      });
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }


  async listSimple() {
    try {
      const data = (await this.convexService.query('fincas:list', {
        limit: 1000,
      }));
      const properties = data?.properties || [];
      const rows: any[] = [];
      for (const p of properties) {
        const departments = this.getPropertyDepartments(p);
        for (const department of departments) {
          rows.push({
            _id: p._id,
            title: p.title,
            code: p.code,
            image: p.images?.[0] || p.image || null,
            location: p.location,
            department,
            departamentos: p.departamentos,
            allowsPets: p.allowsPets,
            serviceStaffAvailable: p.serviceStaffAvailable,
            serviceStaffPrice: p.serviceStaffPrice,
            serviceStaffMandatory: p.serviceStaffMandatory,
          });
        }
      }

      return rows.sort((a: any, b: any) => {
        const d = String(a.department || '').localeCompare(
          String(b.department || ''),
          'es',
          { sensitivity: 'base' },
        );
        if (d !== 0) return d;
        const l = String(a.location || '').localeCompare(String(b.location || ''), 'es', {
          sensitivity: 'base',
        });
        if (l !== 0) return l;
        return String(a.title || '').localeCompare(String(b.title || ''), 'es', {
          sensitivity: 'base',
        });
      });
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async listSimpleGroupedByDepartment() {
    const rows = await this.listSimple();
    const grouped = new Map<string, any[]>();
    for (const row of rows) {
      const key = String(row.department || 'Sin departamento').trim();
      const bucket = grouped.get(key) || [];
      bucket.push(row);
      grouped.set(key, bucket);
    }
    return Array.from(grouped.entries())
      .sort((a, b) => a[0].localeCompare(b[0], 'es', { sensitivity: 'base' }))
      .map(([department, properties]) => ({ department, properties }));
  }

  async listSimpleGroupedByDepartmentPlainText(): Promise<string> {
    const groups = await this.listSimpleGroupedByDepartment();
    if (!groups.length) return 'No hay fincas registradas.';

    const lines: string[] = [];
    for (const group of groups) {
      lines.push(`=== ${group.department} ===`);
      for (const p of group.properties) {
        const title = String(p.title ?? '').trim();
        const location = String(p.location ?? '').trim();
        lines.push(location ? `- ${title} (${location})` : `- ${title}`);
      }
      lines.push('');
    }
    return lines.join('\n').trim();
  }

  private getPropertyDepartments(p: {
    departamentos?: string[];
    location?: unknown;
  }): string[] {
    if (Array.isArray(p.departamentos) && p.departamentos.length > 0) {
      return p.departamentos.map((code) => getDepartmentLabel(code));
    }
    return [this.getDepartmentFromLocation(p.location)];
  }

  private getDepartmentFromLocation(location: unknown): string {
    const raw = String(location ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .trim();
    if (!raw) return 'Sin departamento';

    const isAny = (words: string[]) => words.some((w) => raw.includes(w));

    if (
      isAny(['melgar', 'carmen de apicala', 'flandes', 'ibague', 'espinal', 'tolima'])
    ) {
      return 'Tolima';
    }
    if (
      isAny([
        'anapoima',
        'girardot',
        'ricaurte',
        'tocaima',
        'villeta',
        'la mesa',
        'nilo',
        'viota',
        'cundinamarca',
      ])
    ) {
      return 'Cundinamarca';
    }
    if (isAny(['villavicencio', 'restrepo', 'acacias', 'meta'])) {
      return 'Meta';
    }
    if (isAny(['cartagena', 'bolivar'])) {
      return 'Bolivar';
    }
    if (isAny(['santa marta', 'magdalena'])) {
      return 'Magdalena';
    }
    return 'Otros';
  }

  async listPropertyNamesWithConfiguredSeasons(): Promise<string[]> {
    try {
      const data = await this.convexService.query('fincas:list', {
        limit: 3000,
      });
      const properties = data?.properties || [];

      const names = properties
        .filter((p: any) => Array.isArray(p.pricing) && p.pricing.length > 0)
        .map((p: any) => String(p.title ?? '').trim())
        .filter((name: string) => name.length > 0)
        .sort((a: string, b: string) =>
          a.localeCompare(b, 'es', { sensitivity: 'base' }),
        );

      // Evitar duplicados por seguridad (mismo nombre en varias entradas).
      return Array.from(new Set(names));
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  /**
   * Lista de fincas para feed de catálogo (Meta/WhatsApp). Solo incluye las que tienen al menos una imagen.
   * Incluye product_type y custom_label_* para conjuntos/colecciones en Commerce Manager.
   */
  async getCatalogFeedRows(): Promise<
    {
      id: string;
      title: string;
      description: string;
      link: string;
      image_link: string;
      additional_image_link: string;
      'video[0].url': string;
      price: string;
      sale_price: string;
      availability: string;
      condition: string;
      product_type: string;
      custom_label_0: string;
      custom_label_1: string;
      custom_label_2: string;
    }[]
  > {
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
      'video[0].url': string;
      price: string;
      sale_price: string;
      availability: string;
      condition: string;
      product_type: string;
      custom_label_0: string;
      custom_label_1: string;
      custom_label_2: string;
    }[] = [];
    for (const p of result.properties || []) {
      const images = (p as { images?: string[] }).images ?? [];
      if (images.length === 0) continue;
      const id = String((p as { _id: string })._id);
      const title = ((p as { title?: string }).title ?? 'Finca').slice(0, 200);
      const features = (
        p as {
          features?: {
            name?: string;
            emoji?: string | null;
            quantity?: number;
            zone?: string | null;
          }[];
        }
      ).features;
      const zoneOrder = (p as { zoneOrder?: string[] }).zoneOrder;
      const description = buildCatalogProductDescription(
        (p as { description?: string }).description,
        features,
        zoneOrder,
      ).slice(0, 9999);
      const priceBase = (p as { priceBase?: number }).priceBase ?? 0;
      const priceOriginal = (p as { priceOriginal?: number }).priceOriginal;
      const catalogPrices = buildCatalogPriceFields(priceBase, priceOriginal);

      // Usar el slug si existe, de lo contrario generar uno exactamente igual al frontend
      let slug = (p).slug;
      if (!slug) {
        slug = title
          .toString()
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '') // Quitar tildes
          .trim()
          .replace(/\s+/g, '-') // Espacios por -
          .replace(/[^\w-]+/g, '') // Quitar caracteres no permitidos
          .replace(/--+/g, '-'); // Quitar guiones repetidos
      }

      const videoUrl =
        String((p as { video?: string }).video ?? '').trim() || '';

      const departments = this.getPropertyDepartments(p as {
        departamentos?: string[];
        location?: unknown;
      });
      const primaryDepartment = departments[0] ?? 'Sin departamento';
      const isFavorite = (p as { isFavorite?: boolean }).isFavorite === true;
      const category = String((p as { category?: string }).category ?? '').trim();

      rows.push({
        id,
        title,
        description,
        link: `https://fincasya.com/fincas/${slug}`,
        image_link: images[0],
        additional_image_link: images.slice(1).join(','),
        'video[0].url': videoUrl,
        price: catalogPrices.price,
        sale_price: catalogPrices.sale_price,
        availability: 'in stock',
        condition: 'new',
        product_type: primaryDepartment,
        custom_label_0: isFavorite ? 'Favoritas' : '',
        custom_label_1: departments.join(', '),
        custom_label_2: category,
      });
    }
    return rows;
  }

  /** Genera el CSV del catálogo para Meta (incluye video[0].url cuando la finca tiene video; URL directa al archivo, como image_link). */
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
      'video[0].url',
      'price',
      'sale_price',
      'availability',
      'condition',
      'product_type',
      'custom_label_0',
      'custom_label_1',
      'custom_label_2',
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
          r['video[0].url'],
          r.price,
          r.sale_price,
          r.availability,
          r.condition,
          r.product_type,
          r.custom_label_0,
          r.custom_label_1,
          r.custom_label_2,
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
            ...(f.zoneTemplateSourceId
              ? { zoneTemplateSourceId: f.zoneTemplateSourceId }
              : {}),
            ...(f.quantity != null &&
            Number.isFinite(Number(f.quantity)) &&
            Math.floor(Number(f.quantity)) >= 1
              ? { quantity: Math.max(1, Math.floor(Number(f.quantity))) }
              : {}),
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
            subReglasCapacidad,
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
          if (subReglasCapacidad !== undefined)
            out.subReglasCapacidad = subReglasCapacidad;
          return out;
        });
      }

      fincaData.description = mergeDepositIntoPropertyDescription(
        typeof rest.description === 'string' ? rest.description : '',
        rest.depositoDanosReembolsable,
        rest.manillaCondominio,
        rest.depositoAseo,
      );

      const propertyId = await this.convexService.mutation(
        'fincas:create',
        fincaData,
      );

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
      // Subir nuevas imÃ¡genes a S3 si existen
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
      // Pasamos pricing por separado si existe, y el resto de campos (incluyendo features y catalogIds) a la mutaciÃ³n update.
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

      const shouldSyncDescription =
        updateData.description !== undefined ||
        updateData.depositoDanosReembolsable !== undefined ||
        updateData.manillaCondominio !== undefined ||
        updateData.depositoAseo !== undefined;

      if (shouldSyncDescription) {
        const needsCurrent =
          updateData.description === undefined ||
          updateData.depositoDanosReembolsable === undefined ||
          updateData.manillaCondominio === undefined ||
          updateData.depositoAseo === undefined;
        const current = needsCurrent ? await this.getById(id) : null;

        updateData.description = mergeDepositIntoPropertyDescription(
          (updateData.description as string | undefined) ?? current?.description,
          (updateData.depositoDanosReembolsable as number | undefined) ??
            current?.depositoDanosReembolsable,
          (updateData.manillaCondominio as number | undefined) ??
            current?.manillaCondominio,
          (updateData.depositoAseo as number | undefined) ?? current?.depositoAseo,
        );
      }

      const mutationPayload: any = {
        id,
        ...updateData,
      };

      if (features !== undefined && Array.isArray(features)) {
        mutationPayload.features = features.map((f: any) => ({
          name: f.name,
          ...(f.iconId ? { iconId: f.iconId } : {}),
          ...(f.zone ? { zone: f.zone } : {}),
          ...(f.zoneTemplateSourceId
            ? { zoneTemplateSourceId: f.zoneTemplateSourceId }
            : {}),
          ...(f.quantity != null &&
          Number.isFinite(Number(f.quantity)) &&
          Math.floor(Number(f.quantity)) >= 1
            ? { quantity: Math.max(1, Math.floor(Number(f.quantity))) }
            : {}),
        }));
      }

      if (featuredIcons !== undefined) mutationPayload.featuredIcons = featuredIcons;
      if (zoneOrder !== undefined) mutationPayload.zoneOrder = zoneOrder;
      if (active !== undefined) mutationPayload.active = active;
      if (catalogIds !== undefined) mutationPayload.catalogIds = catalogIds;

      const result = await this.convexService.mutation('fincas:update', mutationPayload);


      // Agregar nuevas imÃ¡genes a travÃ©s de la mutaciÃ³n dedicada de Convex.
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

      // Si se enviÃ³ pricing en el update, usar la mutaciÃ³n dedicada setPricing.
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
            subReglasCapacidad,
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
          if (subReglasCapacidad !== undefined)
            out.subReglasCapacidad = subReglasCapacidad;
          return out;
        });

        await this.convexService.mutation('fincas:setPricing', {
          propertyId: id,
          pricing: normalized,
        } as Record<string, unknown>);
      }

      return await this.getById(id);
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
      subReglasCapacidad?: {
        capacidadMin: number;
        capacidadMax: number;
        valorUnico: number;
      }[];
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
      subReglasCapacidad?: {
        capacidadMin: number;
        capacidadMax: number;
        valorUnico: number;
      }[];
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
      subReglasCapacidad?: {
        capacidadMin: number;
        capacidadMax: number;
        valorUnico: number;
      }[];
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
      // Obtener la finca para eliminar las imÃ¡genes y video de S3
      const finca = await this.getById(id);

      // Eliminar imÃ¡genes de S3
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
   * Parsea el archivo y crea una finca por cada fila vÃ¡lida.
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
        details.push(`[OK] ${dto.title}`);
      } catch (err: unknown) {
        errors++;
        const msg = err instanceof Error ? err.message : String(err);
        details.push(`[ERROR] ${dto.title}: ${msg}`);
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

  /** Propietarios con cuentas guardadas (+ finca), para el buscador del check-in. */
  async listOwnerAccounts() {
    try {
      return await this.convexService.query('propertyOwners:listWithAccounts', {});
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
      checkinUbicacionImage?: Express.Multer.File;
      checkinUbicacionImages?: Express.Multer.File[];
    },
  ) {
    try {
      const normalizedBankAccounts = Array.isArray(dto.bankAccounts)
        ? dto.bankAccounts
            .map((account) => ({
              id: String(account.id ?? '').trim(),
              bankName: String(account.bankName ?? '').trim(),
              accountNumber: String(account.accountNumber ?? '').trim(),
              ...(account.accountType?.trim()
                ? { accountType: account.accountType.trim() }
                : {}),
              ...(account.accountHolderName?.trim()
                ? { accountHolderName: account.accountHolderName.trim() }
                : {}),
            }))
            .filter(
              (account) =>
                account.bankName.length > 0 || account.accountNumber.length > 0,
            )
        : undefined;

      const primaryBank = normalizedBankAccounts?.[0];

      const updateData: any = {
        propertyId,
        ownerUserId: dto.ownerUserId ?? '',
        rutNumber: dto.rutNumber ?? '',
        bankName: primaryBank?.bankName ?? dto.bankName ?? '',
        accountNumber: primaryBank?.accountNumber ?? dto.accountNumber ?? '',
        rntNumber: dto.rntNumber ?? '',
        ...(normalizedBankAccounts !== undefined
          ? { bankAccounts: normalizedBankAccounts }
          : {}),
        ...(dto.propietarioNombre !== undefined
          ? { propietarioNombre: dto.propietarioNombre.trim() }
          : {}),
        ...(dto.propietarioTratamiento !== undefined
          ? { propietarioTratamiento: dto.propietarioTratamiento.trim() }
          : {}),
        ...(dto.propietarioTelefono !== undefined
          ? { propietarioTelefono: dto.propietarioTelefono.trim() }
          : {}),
        ...(dto.propietarioCedula !== undefined
          ? { propietarioCedula: dto.propietarioCedula.trim() }
          : {}),
        ...(dto.propietarioCorreo !== undefined
          ? { propietarioCorreo: dto.propietarioCorreo.trim() }
          : {}),
        ...(dto.checkinUbicacionUrl !== undefined
          ? { checkinUbicacionUrl: dto.checkinUbicacionUrl.trim() }
          : {}),
        ...(dto.checkinIndicacionesLlegada !== undefined
          ? {
              checkinIndicacionesLlegada: dto.checkinIndicacionesLlegada.trim(),
            }
          : {}),
        ...(dto.checkinUbicacionImageUrl !== undefined
          ? { checkinUbicacionImageUrl: dto.checkinUbicacionImageUrl }
          : {}),
        ...(dto.bankCertificationUrl !== undefined
          ? { bankCertificationUrl: dto.bankCertificationUrl }
          : {}),
        ...(dto.idCopyUrl !== undefined ? { idCopyUrl: dto.idCopyUrl } : {}),
        ...(dto.rntPdfUrl !== undefined ? { rntPdfUrl: dto.rntPdfUrl } : {}),
        ...(dto.chamberOfCommerceUrl !== undefined
          ? { chamberOfCommerceUrl: dto.chamberOfCommerceUrl }
          : {}),
      };

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
        if (files.checkinUbicacionImage) {
          updateData.checkinUbicacionImageUrl = await this.s3Service.uploadFile(
            files.checkinUbicacionImage,
            'owners/checkin-location-images',
          );
        }
      }

      // Galería de fotos/mapas de referencia (varias, en orden).
      // El frontend manda el orden final (URLs existentes + tokens "__new__")
      // y los archivos nuevos en checkinUbicacionImages, en el mismo orden.
      if (dto.checkinUbicacionImageOrder !== undefined) {
        const order = dto.checkinUbicacionImageOrder;
        const newFiles = files?.checkinUbicacionImages ?? [];
        const uploadedUrls: string[] = [];
        for (const file of newFiles) {
          uploadedUrls.push(
            await this.s3Service.uploadFile(
              file,
              'owners/checkin-location-images',
            ),
          );
        }
        let nextNew = 0;
        const finalUrls = order
          .map((token) =>
            token === '__new__' ? (uploadedUrls[nextNew++] ?? '') : token,
          )
          .filter((url) => typeof url === 'string' && url.length > 0);
        updateData.checkinUbicacionImageUrls = finalUrls;
        // Espejo legacy: primera imagen para consumidores antiguos.
        updateData.checkinUbicacionImageUrl = finalUrls[0] ?? '';
      }

      const result = await this.convexService.mutation(
        'propertyOwners:upsert',
        updateData,
      );

      const propertySync: Record<string, string> = {};
      if (dto.propietarioNombre !== undefined) {
        propertySync.propietarioNombre = dto.propietarioNombre.trim();
      }
      if (dto.propietarioTelefono !== undefined) {
        propertySync.propietarioTelefono = dto.propietarioTelefono.trim();
      }
      if (dto.propietarioCedula !== undefined) {
        propertySync.propietarioCedula = dto.propietarioCedula.trim();
      }
      if (dto.propietarioCorreo !== undefined) {
        propertySync.propietarioCorreo = dto.propietarioCorreo.trim();
      }

      if (Object.keys(propertySync).length > 0) {
        try {
          await this.convexService.mutation('fincas:update', {
            id: propertyId,
            ...propertySync,
          });
        } catch (syncError) {
          console.warn(
            '[owner] No se pudo sincronizar contacto en la finca:',
            syncError,
          );
        }
      }

      return result;
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
  async generateContract(
    propertyId: string,
    dto: GenerateContractDto,
    options?: { previewOnly?: boolean },
  ) {
    console.log(
      `[api] >>> generateContract CODE=v6-master-docx propertyId=${propertyId} preview=${!!options?.previewOnly}`,
    );
    try {
      const finca = await this.getById(propertyId);

      const resolvedContractNumber =
        (dto.contractNumber && String(dto.contractNumber).trim()) ||
        `DIR-${this.sanitizeFilename(
          String(
            (finca as { code?: string }).code ||
              (finca as { title?: string }).title ||
              propertyId,
          ),
        ).slice(0, 28)}-${Date.now().toString(36).toUpperCase()}`;

      // Obtener informaciÃ³n de la conversaciÃ³n y contacto para el cliente
      let contact: any = null;
      if (dto.conversationId && dto.conversationId !== 'direct-reservation') {
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

      // 1. CÃ¡lculos de duraciÃ³n (necesarios para el precio total)
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

      // 2. Cálculo del precio total (Priorizamos el total de la pasarela si viene definido)
      const providedTotal = parseInt(dto.totalPrice);
      const unitPriceNum = parseInt(dto.nightlyPrice) || 0;
      let totalPriceNum = !isNaN(providedTotal) && providedTotal > 0 
        ? providedTotal 
        : (unitPriceNum * totalDays);

      // Política de mascotas (desglose; el total enviado desde inbox ya incluye todo):
      // - 1ª-2ª: $100.000 reembolsable c/u
      // - 3ª+: $30.000 tarifa de ingreso c/u (no reembolsable)
      // - Con 3+ mascotas: $70.000 aseo por mascotas (aparte del aseo final de la finca)
      const petCount = Number(dto.petCount) || 0;
      const petSurchargeRefundable = Math.min(petCount, 2) * 100000;
      const petSurchargeNonRefundable = Math.max(0, petCount - 2) * 30000;
      const petCleaningFee = petCount >= 3 ? 70000 : 0;

      // Sumar al precio final si no venía de la pasarela

      const serviceStaffFee = Number(dto.serviceStaffFee) || 0;

      // Solo sumamos si el total no fue proporcionado explícitamente (ej: reservas internas)
      if (isNaN(providedTotal) || providedTotal <= 0) {
        totalPriceNum += petSurchargeRefundable + petSurchargeNonRefundable + serviceStaffFee;
      }

      const totalPriceText =
        this.numberToSpanishText(totalPriceNum).toUpperCase();
      const totalPriceFormatted = new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency: 'COP',
        minimumFractionDigits: 0,
      }).format(totalPriceNum);

      // Mapeo de campos solicitado por el usuario
      const mappingKeys = {
        date: 'FECHA_GENERACIÃ“N DE CONTRATO (FORMATO DIA(NUMERO) MES(TEXTO) de AÃ‘O(NUMERO))',
        priceText: 'VALOR â€“ PRECIO EN TEXTO',
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
        [mappingKeys.accountHolder]: dto.accountHolder ?? '',
        [mappingKeys.idNumber]: dto.idNumber ?? '',
        [mappingKeys.accountNumber]: dto.accountNumber ?? '',
        [mappingKeys.bankName]: dto.bankName ?? '',
        [mappingKeys.contractNumber]: resolvedContractNumber,
        [mappingKeys.clientName]: dto.clientName || contact?.name || '',
        [mappingKeys.clientId]: dto.clientId || '',
        [mappingKeys.clientEmail]: dto.clientEmail || '',
        [mappingKeys.clientPhone]: dto.clientPhone || '',
        [mappingKeys.checkInDate]: dto.checkInDate || '',
        [mappingKeys.checkOutDate]: dto.checkOutDate || '',
        [mappingKeys.city]: finca.location || '',
        [mappingKeys.clientCity]: dto.clientCity || '',
        [mappingKeys.clientAddress]: dto.clientAddress || '',
        'HORA ENTRADA': dto.checkInTime || '',
        'HORA SALIDA': dto.checkOutTime || '',
        // Fallbacks genÃ©ricos
        Text6: resolvedContractNumber,
        Text9: totalPriceText ?? '',
        Text10: totalPriceFormatted ?? '',
        Text11: dto.accountNumber ?? '',
        Text13: dto.bankName ?? '',
        // Campos de mascotas
        'NUMERO_MASCOTAS': String(petCount),
        'DEP_MASCOTAS': String(dto.petDeposit ?? petSurchargeRefundable),
        'CARGO_MASCOTAS': String(dto.petSurcharge ?? petSurchargeNonRefundable),
        'CARGO_SERVICIO': String(serviceStaffFee),
      };

      let contractSettingsPayload: unknown = null;
      try {
        contractSettingsPayload = await this.convexService.query(
          'adminContractSettings:getGlobalPayload',
          {},
        );
      } catch {
        console.warn('[api] Ajustes globales del contrato no disponibles');
      }
      const { admin: contractAdmin, ownerOverrides, bankAccounts, contractBankAccountIds, primaryBankAccountId } =
        parseContractSettingsPayload(contractSettingsPayload);
      const ownerOverride =
        ownerOverrides[propertyId] ??
        ownerOverrides[String(propertyId)] ??
        {};
      const caracteristicasPlain = formatFincaFeaturesPlain(
        (finca as { features?: unknown[] }).features || [],
      );
      const nombrePropietario =
        (dto.propertyOwnerName && String(dto.propertyOwnerName).trim()) ||
        ownerOverride.nombreCompleto?.trim() ||
        '';
      const cedulaPropietario =
        (dto.propertyOwnerCedula && String(dto.propertyOwnerCedula).trim()) ||
        ownerOverride.cedula?.trim() ||
        '';
      const ciudadCedulaPropietario =
        (dto.propertyOwnerCity && String(dto.propertyOwnerCity).trim()) ||
        ownerOverride.ciudadCedula?.trim() ||
        '';
      const selectedBankIds =
        Array.isArray(dto.bankAccountIds) && dto.bankAccountIds.length > 0
          ? dto.bankAccountIds.map(String)
          : contractBankAccountIds.length > 0
            ? contractBankAccountIds.map(String)
            : primaryBankAccountId
              ? [String(primaryBankAccountId)]
              : [];
      const bankWordLines = buildBankAccountsWordLines(
        bankAccounts,
        selectedBankIds,
      );
      const cuentasBancariasPlain = buildBankAccountsPlainSnippet(
        bankAccounts,
        selectedBankIds,
        {
          accountNumber: dto.accountNumber ?? '',
          bankName: dto.bankName ?? '',
          ownerName: dto.accountHolder ?? '',
          ownerCedula: dto.idNumber ?? '',
        },
      );
      const selectedBankAccounts = bankAccounts.filter(
        (a) => a.id && selectedBankIds.includes(String(a.id)),
      );
      const contractBankAccount =
        selectedBankAccounts[0] ??
        (selectedBankIds.length === 0
          ? null
          : bankAccounts.find((a) => a.id === selectedBankIds[0]) ?? null);
      const contractBankLabel = contractBankAccount
        ? [contractBankAccount.accountType, contractBankAccount.bankName]
            .filter(Boolean)
            .join(' ')
        : (valuesMapping[mappingKeys.bankName] ?? '');
      const contractAccountNumber =
        contractBankAccount?.accountNumber ??
        valuesMapping[mappingKeys.accountNumber] ??
        '';
      const contractAccountHolder =
        contractBankAccount?.ownerName ??
        valuesMapping[mappingKeys.accountHolder] ??
        '';
      const contractAccountCedula =
        contractBankAccount?.ownerCedula ??
        valuesMapping[mappingKeys.idNumber] ??
        '';

      // --- PREPARACIÓN DE VALORES PARA WORD/HTML (plantilla maestra única) ---
      const wordValues: Record<string, string> = {
        fechaGeneracion: valuesMapping[mappingKeys.date] ?? '',
        precioLetras: valuesMapping[mappingKeys.priceText] ?? '',
        precioNumerico: valuesMapping[mappingKeys.priceNumeric] ?? '',
        bancoNombre: contractBankLabel,
        cuentaNumero: contractAccountNumber,
        titularNombre: contractAccountHolder,
        titularCedula: contractAccountCedula,
        cuentasBancarias: cuentasBancariasPlain,
        cuentasBancariasContrato: cuentasBancariasPlain,
        contratoNumero: valuesMapping[mappingKeys.contractNumber] ?? '',
        fechaEntrada: valuesMapping[mappingKeys.checkInDate] ?? '',
        fechaLlegada: valuesMapping[mappingKeys.checkInDate] ?? '',
        fecha_entrada: valuesMapping[mappingKeys.checkInDate] ?? '',
        fecha_llegada: valuesMapping[mappingKeys.checkInDate] ?? '',
        fechaSalida: valuesMapping[mappingKeys.checkOutDate] ?? '',
        fecha_salida: valuesMapping[mappingKeys.checkOutDate] ?? '',
        ciudad: valuesMapping[mappingKeys.city] ?? '',
        nochesTexto: this.numberToSpanishText(totalNights, false),
        nochesNumero: String(totalNights),
        diasTexto: this.numberToSpanishText(totalDays, false),
        diasNumero: String(totalDays),
        fechaEntradaMini: checkInMini,
        fechaLlegadaMini: checkInMini,
        fechaSalidaMini: checkOutMini,
        horaLlegada: dto.checkInTime || '10:00 AM',
        horaSalida: dto.checkOutTime || '04:00 PM',
        ciudadCliente: valuesMapping[mappingKeys.clientCity] || dto.clientCity || '',
        direccionCliente: valuesMapping[mappingKeys.clientAddress] || dto.clientAddress || '',
        clienteNombre: valuesMapping[mappingKeys.clientName] ?? '',
        clienteCedula: valuesMapping[mappingKeys.clientId] ?? '',
        clienteId: valuesMapping[mappingKeys.clientId] ?? '',
        clienteIdentificacion: valuesMapping[mappingKeys.clientId] ?? '',
        clientCorreo: valuesMapping[mappingKeys.clientEmail] ?? '',
        clienteCelular: valuesMapping[mappingKeys.clientPhone] ?? '',
        firmaCliente: dto.signature ?? '',
        numeroMascotas: String(petCount),
        depositoMascotas: String(petSurchargeRefundable),
        cargoMascotas: String(petSurchargeNonRefundable),
        totalMascotas: String(petSurchargeRefundable + petSurchargeNonRefundable),
        nombreFinca: finca.title || '',
        municipioFinca: finca.location || '',
        capacidadDePersonas: String(finca.capacity || 0),
        característicasDeFinca: caracteristicasPlain,
        caracteristicasDeFinca: caracteristicasPlain,
        nombrePropietario,
        cedulaPropietario,
        ciudadCedulaPropietario,
        // Firmante por contrato (selector Hernán/esposa) tiene prioridad sobre el global.
        adminNombre: (dto.adminName?.trim() || contractAdmin.adminName || '').trim(),
        adminCedula: (dto.adminCedula?.trim() || contractAdmin.adminCedula || '').trim(),
        adminCiudad: (dto.adminCity?.trim() || contractAdmin.adminCity || '').trim(),
        capacidad: String(finca.capacity || 0),
      };

      const cleaningFeeCop = Number(dto.cleaningFee) || 0;
      const refundableDepositCop = Number(dto.refundableDeposit) || 0;
      const aseoFinalLabel = resolveContractMoneyLabel(
        cleaningFeeCop,
        dto.cleaningFeeLabel,
        contractAdmin.cleaningFee ?? '$100.000',
      );
      const depositoDanosLabel = resolveContractMoneyLabel(
        refundableDepositCop,
        dto.securityDepositLabel,
        contractAdmin.securityDeposit ?? '$200.000',
      );
      const depositoMascotaLabel = resolveContractMoneyLabel(
        petCount > 0 ? petSurchargeRefundable : 0,
        dto.petDepositLabel,
        contractAdmin.petDeposit ?? '$100.000',
      );
      const personasExtrasLabel =
        (dto.extraPersonFeeLabel && String(dto.extraPersonFeeLabel).trim()) ||
        contractAdmin.extraPersonFee ||
        '$50.000';

      Object.assign(wordValues, {
        aseofinal: aseoFinalLabel,
        personasextras: personasExtrasLabel,
        depositomascotas: depositoMascotaLabel,
        Depósitopordaños: depositoDanosLabel,
        depositopordanos: depositoDanosLabel,
        depositoGarantia: depositoDanosLabel,
        precioAseoFinal: aseoFinalLabel,
        precioPorPersonasExtras: personasExtrasLabel,
        precioPorMasota: depositoMascotaLabel,
      });

      // Agregar también los mapeos del PDF (con y sin corchetes) por si acaso
      for (const [k, v] of Object.entries(valuesMapping)) {
        if (v === undefined || v === null) continue;
        const t = String(v);
        const clean = k.replace(/^\[|\]$/g, '').trim() || k;
        wordValues[clean] = t;
        if (k !== clean) {
          wordValues[k] = t;
        }
      }

      const sanitizedTitle = this.sanitizeFilename(finca.title || 'Finca');
      const contractNumSuffix = resolvedContractNumber
        ? `_${resolvedContractNumber}`
        : '';

      let finalBuffer: Buffer;
      let finalFilename: string;
      let finalMimeType: string;

      const incomingCustomHtml =
        typeof dto.customHtml === 'string' ? dto.customHtml.trim() : '';
      const useCustomHtml =
        incomingCustomHtml.length > 0 && incomingCustomHtml.length <= 400_000;

      if (useCustomHtml) {
        console.log(
          `[api] Contrato desde HTML de vista previa (${incomingCustomHtml.length} chars).`,
        );
        // Rellenar los placeholders {{...}} que pudieran quedar. En el flujo de
        // "Confirmación" la vista previa ya viene completa (no-op). En el flujo
        // de "Link", la vista previa se guardó SIN los datos del cliente; aquí se
        // completan con los valores reales (cliente, fechas, etc.).
        let filledCustomHtml = incomingCustomHtml;
        for (const [key, val] of Object.entries(wordValues)) {
          const regex = new RegExp(
            `\\{\\{\\s*(?:<[^>]*>)*\\s*${key}\\s*(?:<[^>]*>)*\\s*\\}\\}`,
            'g',
          );
          filledCustomHtml = filledCustomHtml.replace(regex, String(val ?? ''));
        }
        const fullHtml = await this.wrapContractFragmentHtml(
          filledCustomHtml,
          finca as { title?: string; location?: string },
          resolvedContractNumber,
        );
        finalBuffer = await this.pdfService.htmlToPdf(fullHtml);
        finalFilename = `Contrato_${sanitizedTitle}${contractNumSuffix}.pdf`;
        finalMimeType = 'application/pdf';
      } else {
      // Plantilla maestra única (formato QUINTA OLAYA): mismos estilos para todas las fincas.
      let templateBytes: Buffer | null = await loadDefaultContractTemplateBytes();
      if (!templateBytes) {
        throw new BadRequestException(
          'No se encontró la plantilla maestra del contrato (assets/contracts/default-contract-template.docx o docs/QUINTA OLAYA.docx).',
        );
      }

      console.log(
        '[api] Plantilla Word maestra (formato QUINTA OLAYA) + datos de finca/cliente.',
      );

      // --- DETECCIÓN DE FORMATO Y PROCESAMIENTO ---
      const isDocx = templateBytes.slice(0, 2).toString() === 'PK';
      const isHtml = templateBytes.slice(0, 500).toString().toLowerCase().includes('<html');

      if (isHtml) {
        console.log('[api] Detectado formato HTML (Word antiguo)');
        let htmlString = templateBytes.toString();
        
        // Realizar reemplazos robustos en el HTML usando Regex
        console.log('[api] WordValues keys:', Object.keys(wordValues));
        for (const [key, val] of Object.entries(wordValues)) {
          // Regex que permite espacios y etiquetas HTML opcionales dentro de las llaves
          const regex = new RegExp(`\\{\\{[\\s]*(?:<[^>]*>)*[\\s]*${key}[\\s]*(?:<[^>]*>)*[\\s]*\\}\\}`, 'g');
          if (regex.test(htmlString)) {
            console.log(`[api] Reemplazando llave: {{${key}}} -> ${val}`);
            htmlString = htmlString.replace(regex, String(val ?? ''));
          } else {
            // Loguear solo si es una llave común que debería estar
            if (['clienteNombre', 'clienteCedula', 'contratoNumero'].includes(key)) {
              console.warn(`[api] Llave NO encontrada en el HTML: {{${key}}}`);
            }
          }
        }
        
        finalBuffer = Buffer.from(htmlString);
        finalFilename = `Contrato_${sanitizedTitle}${contractNumSuffix}.doc`;
        finalMimeType = 'application/msword';
        
        console.log('[api] Contrato HTML procesado correctamente.');

        // Intentar convertir HTML a PDF (iLovePDF suele aceptar .doc con HTML interno)
        if (finalBuffer) {
          try {
            console.log('[api] Convirtiendo contrato HTML a PDF con puppeteer…');
            const pdfBuffer = await this.pdfService.htmlToPdf(htmlString);
            finalBuffer = pdfBuffer;
            finalFilename = finalFilename.replace('.doc', '.pdf');
            finalMimeType = 'application/pdf';
            console.log('[api] Conversión de HTML a PDF completada con puppeteer.');
          } catch (e: any) {
            console.error('[api] Puppeteer no pudo convertir HTML a PDF:', e.message || e);
            console.warn('[api] Se usará .doc como fallback.');
          }
        }
      } else if (isDocx) {
        console.log('[api] Detectado formato Word (.docx)');

        const processXml = (xml: string) => {
          let processed = xml;
          const listKeys = ['caracteristicasDeFinca', 'característicasDeFinca'];
          for (const key of listKeys) {
            const val = wordValues[key];
            if (val !== undefined) {
              processed = replaceWordListPlaceholderWithLeftAlign(
                processed,
                key,
                val,
              );
            }
          }
          if (bankWordLines.length > 1) {
            processed = replaceWordBankAccountPlaceholderCluster(
              processed,
              bankWordLines,
            );
            for (const key of ['cuentasBancarias', 'cuentasBancariasContrato']) {
              processed = replaceWordListPlaceholderWithLeftAlign(
                processed,
                key,
                bankWordLines.join('\n'),
              );
            }
          }
          return applyWordTemplateReplacements(processed, wordValues);
        };

        try {
          const zip = new PizZip(templateBytes);
          console.log(
            '[api] Docx: motor directo (sin docxtemplater) + claves mapeo PDF/Word.',
          );
          const xmlTargets = Object.keys(zip.files).filter(
            (name) =>
              !zip.files[name].dir &&
              (name === 'word/document.xml' ||
                /^word\/header\d+\.xml$/.test(name) ||
                /^word\/footer\d+\.xml$/.test(name) ||
                name === 'word/footnotes.xml' ||
                name === 'word/endnotes.xml'),
          );
          for (const fileName of xmlTargets) {
            const raw = zip.file(fileName)?.asText();
            if (raw) {
              (zip).file(fileName, processXml(raw));
            }
          }

          // --- FIRMA DEL CONTRATO (ARRENDADOR): firmante elegido + imagen ---
          // El bloque de firma en la plantilla QUINTA OLAYA está hardcodeado con el
          // nombre/cédula por defecto; aquí lo reemplazamos por el firmante elegido y,
          // si tiene imagen de firma, la incrustamos sobre la línea. Todo defensivo:
          // si algo falla, el contrato igual se genera (con el fallback a PDF por HTML).
          try {
            const firmaName = (dto.adminName ?? '').trim();
            const firmaCedula = (dto.adminCedula ?? '').trim();
            const firmaCiudad = (dto.adminCity ?? '').trim();
            const firmaUrl = (dto.firmaArrendadorUrl ?? '').trim();
            const docFile = zip.file('word/document.xml');
            if (docFile) {
              let docXml = docFile.asText();
              const escXml = (s: string) =>
                s
                  .replace(/&/g, '&amp;')
                  .replace(/</g, '&lt;')
                  .replace(/>/g, '&gt;');
              // (a) Nombre del firmante en el bloque de firma (texto contiguo, 1 sola vez).
              if (firmaName && firmaName.toUpperCase() !== 'HERNÁN AGUILERA GÓMEZ') {
                docXml = docXml.replace(
                  'HERNÁN AGUILERA GÓMEZ',
                  escXml(firmaName.toUpperCase()),
                );
              }
              // (b) Cédula y ciudad del firmante en el bloque de firma.
              if (firmaCedula || firmaCiudad) {
                const ced = firmaCedula || '81.720.077';
                const ciu = firmaCiudad || 'Chía';
                docXml = docXml.replace(
                  'C.C. N° 81.720.077 de Chía',
                  escXml(`C.C. N° ${ced} de ${ciu}`),
                );
              }
              // (c) Imagen de la firma sobre la primera línea de subrayado (ARRENDADOR).
              if (firmaUrl) {
                try {
                  const imgRes = await fetch(firmaUrl);
                  if (imgRes.ok) {
                    const imgBuf = Buffer.from(await imgRes.arrayBuffer());
                    const lower = firmaUrl.toLowerCase();
                    const ext =
                      lower.includes('.jpg') || lower.includes('.jpeg')
                        ? 'jpg'
                        : 'png';
                    zip.file(`word/media/firma_arrendador.${ext}`, imgBuf);
                    // Content types (png ya está declarado; agregamos jpg si hace falta).
                    if (ext === 'jpg') {
                      let ct = zip.file('[Content_Types].xml')?.asText() ?? '';
                      if (
                        !ct.includes('Extension="jpg"') &&
                        !ct.includes('Extension="jpeg"')
                      ) {
                        ct = ct.replace(
                          '</Types>',
                          '<Default Extension="jpg" ContentType="image/jpeg"/></Types>',
                        );
                        zip.file('[Content_Types].xml', ct);
                      }
                    }
                    // Relación de imagen en document.xml.rels.
                    const relId = 'rIdFirmaArr';
                    let rels =
                      zip.file('word/_rels/document.xml.rels')?.asText() ?? '';
                    if (rels && !rels.includes(relId)) {
                      rels = rels.replace(
                        '</Relationships>',
                        `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/firma_arrendador.${ext}"/></Relationships>`,
                      );
                      zip.file('word/_rels/document.xml.rels', rels);
                    }
                    const drawing =
                      `<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">` +
                      `<wp:extent cx="1524000" cy="571500"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
                      `<wp:docPr id="9001" name="FirmaArrendador"/>` +
                      `<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
                      `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
                      `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
                      `<pic:nvPicPr><pic:cNvPr id="9001" name="FirmaArrendador"/><pic:cNvPicPr/></pic:nvPicPr>` +
                      `<pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
                      `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1524000" cy="571500"/></a:xfrm>` +
                      `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`;
                    // Reemplaza el texto de la PRIMERA línea de subrayado por la imagen.
                    docXml = docXml.replace(
                      /<w:t xml:space="preserve">_{5,}[^<]*<\/w:t>/,
                      `<w:t xml:space="preserve"></w:t></w:r><w:r>${drawing}`,
                    );
                  }
                } catch (imgErr) {
                  console.warn(
                    '[api] No se pudo incrustar la firma del arrendador:',
                    (imgErr as Error)?.message,
                  );
                }
              }
              zip.file('word/document.xml', docXml);
            }
          } catch (firmaErr) {
            console.warn(
              '[api] Personalización de firma del contrato omitida:',
              (firmaErr as Error)?.message,
            );
          }

          finalBuffer = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
          console.log('[api] Contrato Word generado correctamente.');
        } catch (error: unknown) {
          const msg = (error as Error)?.message ?? String(error);
          console.error('[api] Error al procesar .docx:', msg);
          throw new BadRequestException(`Error al procesar la plantilla Word: ${msg}`);
        }

        // Generar nombre de archivo base usando el nombre de la finca
        finalFilename = `Contrato_${sanitizedTitle}${contractNumSuffix}.docx`;
        finalMimeType =
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

        // Intentamos convertir el Word resultante a PDF seguro.
        // Si el servicio no esta disponible, dejamos el .docx para no romper el flujo.
        if (finalBuffer) {
          console.log(
            `[api] Convirtiendo contrato Word a PDF (${dto.conversationId === 'direct-reservation' ? 'Reserva Directa' : 'ConversaciÃ³n ' + dto.conversationId})...`,
          );
          try {
            const pdfBuffer = await this.convertDocxToPdf(
              finalBuffer,
              finalFilename,
            );
            finalBuffer = pdfBuffer;
            finalFilename = finalFilename.replace('.docx', '.pdf');
            finalMimeType = 'application/pdf';
            console.log('[api] Conversión a PDF completada con iLovePDF.');
          } catch (e: any) {
            console.error('[api] Error en conversión iLovePDF:', e.message || e);
            console.log('[api] Intentando fallback puppeteer para PDF…');
            try {
              const fallbackHtml = this.buildContractFallbackHtml(wordValues, finca as { title?: string; location?: string });
              const pdfBuffer = await this.pdfService.htmlToPdf(fallbackHtml);
              finalBuffer = pdfBuffer;
              finalFilename = finalFilename.replace('.docx', '.pdf');
              finalMimeType = 'application/pdf';
              console.log('[api] Conversión a PDF completada con puppeteer (fallback).');
            } catch (puppeteerErr: any) {
              console.error('[api] Puppeteer fallback también falló:', puppeteerErr.message || puppeteerErr);
              console.warn('[api] Entregando contrato en formato Word.');
            }
          }
        }
      } else {
        // --- PROCESAMIENTO PDF ---
        const pdfDoc = await PDFDocument.load(templateBytes);
        const helveticaFont = await pdfDoc.embedFont('Helvetica');
        const form = pdfDoc.getForm();
        const allFields = form.getFields();
        const allFieldNames = allFields.map((f) => f.getName());

        console.log('=== DIAGNÃ“STICO PDF ===');
        console.log(
          `Campos detectados (${allFieldNames.length}):`,
          allFieldNames,
        );
        if (allFieldNames.length === 0) {
          console.error(
            'Â¡ADVERTENCIA! El PDF no parece tener campos de formulario (AcroForm).',
          );
        }

        // Rellenar campos usando bÃºsqueda robusta (con y sin corchetes)
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
                  // @ts-ignore - En algunas versiones de pdf-lib estos mÃ©todos existen
                  if (typeof (field as any).setBorderWidth === 'function') {
                    (field as any).setBorderWidth(0);
                  }
                } catch (e) {}

                // Ajustar fuente y tamaÃ±o
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
        finalFilename = `Contrato_${sanitizedTitle}${contractNumSuffix}.pdf`;
        finalMimeType = 'application/pdf';
      }
      }

      if (options?.previewOnly) {
        return {
          success: true,
          buffer: finalBuffer,
          filename: finalFilename,
          mimeType: finalMimeType,
          message: 'Previsualizacion de contrato generada exitosamente.',
        };
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
        finalFilename,
      );

      // 4.b Registrar/actualizar el contrato en el Gestor de Contratos. Defensivo:
      // si falla, no rompe la generación del contrato.
      try {
        const origen =
          dto.conversationId === 'contract-link'
            ? 'link'
            : dto.conversationId === 'direct-reservation' || !dto.conversationId
              ? 'confirmacion'
              : 'inbox';
        await this.convexService.mutation('contracts:upsert', {
          contractNumber: resolvedContractNumber,
          propertyId: dto.propertyId as any,
          propertyTitle: finca.title || undefined,
          propertyLocation: finca.location || undefined,
          clienteNombre: dto.clientName || undefined,
          clienteCedula: dto.clientId || undefined,
          clienteEmail: dto.clientEmail || undefined,
          clienteTelefono: dto.clientPhone || undefined,
          clienteCiudad: dto.clientCity || undefined,
          clienteDireccion: dto.clientAddress || undefined,
          firmanteNombre: dto.adminName || undefined,
          firmanteCedula: dto.adminCedula || undefined,
          valorTotal: Math.floor(Number(dto.totalPrice) || 0) || undefined,
          fechaEntrada: dto.checkInDate || undefined,
          fechaSalida: dto.checkOutDate || undefined,
          pdfUrl: publicUrl,
          pdfFilename: finalFilename,
          estado: 'generado',
          origen,
        });
      } catch (regErr) {
        console.warn(
          '[api] No se pudo registrar el contrato en el gestor:',
          (regErr as Error)?.message,
        );
      }

      // 5. Enviar mensaje a la conversaciÃ³n (solo si es una conversaciÃ³n vÃ¡lida)
      if (dto.conversationId && dto.conversationId !== 'direct-reservation') {
        try {
      const contractMetadata = {
        kind: 'generated_contract',
        contractGenerated: true,
        contractSent: true,
        conversationState: 'contract_sent',
        contractData: {
          propertyId: dto.propertyId,
          propertyTitle: finca.title || '',
          propertyLocation: finca.location || '',
          contractNumber: resolvedContractNumber,
          generatedFileName: finalFilename,
          bankName: dto.bankName || '',
          accountNumber: dto.accountNumber || '',
          accountHolder: dto.accountHolder || '',
          idNumber: dto.idNumber || '',
          clientName: dto.clientName || contact?.name || '',
          clientId: dto.clientId || '',
          clientEmail: dto.clientEmail || '',
          clientPhone: dto.clientPhone || '',
          clientCity: dto.clientCity || '',
          clientAddress: dto.clientAddress || '',
          checkInDate: dto.checkInDate || '',
          checkOutDate: dto.checkOutDate || '',
          checkInTime: dto.checkInTime || '',
          checkOutTime: dto.checkOutTime || '',
          nightlyPrice: unitPriceNum,
          totalNights,
          totalDays,
          subtotal: unitPriceNum * totalDays,
          totalPrice: totalPriceNum,
          guests:
            dto.guests != null && Number(dto.guests) >= 1
              ? Math.round(Number(dto.guests))
              : undefined,
          petCount: petCount,
          petSurchargeRefundable,
          petSurchargeNonRefundable,
          cleaningFee: 0, // Placeholder if needed in future
          generatedAt: Date.now(),
        },
      };

          await this.inboxService.sendMessage(dto.conversationId, {
            type: 'document',
            text: `Hola. Aqui tienes el documento del contrato para la finca ${finca.title}. Por favor revisalo y quedamos atentos a cualquier duda.`,
            mediaUrl: publicUrl,
            filename: finalFilename,
            metadata: contractMetadata,
            file: generatedFile,
          });

          await this.finalizeHumanContractFlow(dto.conversationId, dto);
        } catch (msgErr) {
          console.error(
            `[api] No se pudo enviar mensaje al inbox ${dto.conversationId}:`,
            msgErr.message,
          );
        }
      } else {
        console.log(
          '[api] Reserva directa: Omitiendo envÃ­o de mensaje a Inbox local.',
        );

        if (dto.bookingId) {
          try {
            await this.convexService.mutation('bookings:appendMultimedia', {
              bookingId: dto.bookingId,
              file: {
                url: publicUrl,
                name: finalFilename,
                size: generatedFile.size || 0,
                type: 'application/pdf',
                uploadedAt: Date.now()
              }
            });
            console.log(`[api] Contrato PDF adjuntado correctamente a la reserva ${dto.bookingId}`);
          } catch (e) {
             console.error(`[api] Error adjuntando contrato a la reserva: ${e.message}`);
          }
        }
      }

      return {
        success: true,
        url: publicUrl,
        filename: finalFilename,
        message: 'Contrato generado y enviado exitosamente.',
      };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      // Si hay dos copias de @nestjs/common, instanceof falla; re-lanzar 4xx de Nest igual.
      const maybeHttp = error as { getStatus?: () => number };
      if (typeof maybeHttp.getStatus === 'function') {
        const st = maybeHttp.getStatus();
        if (st >= 400 && st < 500) {
          throw error;
        }
      }
      const msg =
        error instanceof Error ? error.message : String(error ?? 'Error');
      const withProps = error as {
        properties?: { id?: string; errors?: Array<{ message?: string }> };
        cause?: unknown;
      };
      const propErrors = withProps.properties?.errors;
      let detail = msg;
      if (
        msg === 'Multi error' &&
        Array.isArray(propErrors) &&
        propErrors.length
      ) {
        detail = propErrors
          .map((e, i) => (e as { message?: string })?.message || `#${i + 1}`)
          .join(' | ');
      } else if (msg === 'Multi error' && withProps.cause) {
        detail = String(withProps.cause);
      }
      console.error('[api] generateContract (detalle):', detail, error);
      throw new BadRequestException(`Error al generar contrato: ${detail}`);
    }
  }

  /**
   * Genera el PDF de confirmación de reserva para una reserva existente,
   * lo sube a S3 y lo enlaza a la reserva en Convex.
   */
  async generateBookingConfirmation(bookingId: string) {
    const booking = await this.convexService.query('bookings:getById', {
      id: bookingId,
    });
    if (!booking) {
      throw new NotFoundException('Reserva no encontrada');
    }

    const finca = await this.convexService.query('fincas:getById', {
      id: booking.propertyId,
    });

    const checkInDate = this.pdfService.toIsoDate(booking.fechaEntrada);
    const checkOutDate = this.pdfService.toIsoDate(booking.fechaSalida);
    const totalAmount = this.pdfService.toNumber(booking.precioTotal);
    const rentAmount = this.pdfService.toNumber(booking.subtotal);
    const cleaningFee = this.pdfService.toNumber(booking.depositoAseo);
    const refundableDeposit = this.pdfService.toNumber(booking.depositoGarantia);

    let depositAmount = Math.round(totalAmount * 0.5);
    let balanceAmount = Math.max(0, totalAmount - depositAmount);
    let depositDate = booking.issueDate || this.pdfService.toIsoDate(new Date());

    try {
      const payments = await this.convexService.query(
        'bookings:getPaymentsByBooking',
        { bookingId: bookingId as any },
      );
      if (payments?.netPaid > 0) {
        depositAmount = payments.netPaid;
        balanceAmount = payments.pending;
        const primary = payments.payments?.[0];
        const noteMatch = String(primary?.notes ?? '').match(
          /Fecha abono:\s*([^·]+)/i,
        );
        if (noteMatch?.[1]) {
          depositDate = this.pdfService.toIsoDate(noteMatch[1].trim());
        }
      }
    } catch {
      // Mantener defaults si no hay pagos registrados.
    }

    const pdfData: ReservationConfirmationData = {
      propertyId: booking.propertyId,
      contractNumber: booking.reference || String(Date.now()).slice(-6),
      clientName: booking.nombreCompleto || 'Cliente',
      clientId: booking.cedula || '',
      clientEmail: booking.correo || '',
      issueDate: booking.issueDate || this.pdfService.toIsoDate(new Date()),
      clientPhone: booking.celular || '',
      clientAddress: booking.address || '',
      propertyName: finca?.title || booking.fincaName || 'Propiedad',
      propertyLocation: finca?.location || '',
      checkInDate,
      checkOutDate,
      checkInTime: booking.horaEntrada || '10:00',
      checkOutTime: booking.horaSalida || '15:00',
      guests: this.pdfService.toNumber(booking.numeroPersonas) || 1,
      nights: this.pdfService.calculateNights(checkInDate, checkOutDate),
      depositAmount,
      depositDate,
      balanceAmount,
      balanceDate: checkInDate,
      rentAmount,
      cleaningFee,
      refundableDeposit,
      totalAmount,
      paymentMethod: 'bancolombia',
      paymentStatus:
        booking.paymentStatus === 'PAID' || booking.status === 'PAID'
          ? 'paid'
          : 'pending',
      economicAdjustments: (booking.economicAdjustments ?? []).map((item) => ({
        description: item.description,
        amount: item.amount,
        type: item.type,
      })),
    };

    const pdfBuffer =
      await this.pdfService.generateReservationConfirmationPdfBuffer(pdfData);
    const filename = `Confirmacion_Reserva_${pdfData.contractNumber}.pdf`;

    const file: Express.Multer.File = {
      fieldname: 'file',
      originalname: filename,
      encoding: '7bit',
      mimetype: 'application/pdf',
      buffer: Buffer.from(pdfBuffer),
      size: pdfBuffer.byteLength,
      stream: null as any,
      destination: '',
      filename: '',
      path: '',
    };

    const s3Url = await this.s3Service.uploadFile(file, 'confirmations', filename);

    // Enlazar a la reserva
    await this.convexService.mutation('bookings:appendMultimedia', {
      bookingId,
      file: {
        url: s3Url,
        name: filename,
        type: 'application/pdf',
        size: pdfBuffer.byteLength,
        uploadedAt: Date.now(),
      },
    });

    return {
      url: s3Url,
      filename,
    };
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
      'DIECISEIS',
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
            ? 'UN MILLON'
            : convertirMenorA1000(millones) + ' MILLONES';
        if (resto > 0) res += ' ' + processNum(resto);
        return res;
      }

      return num.toString();
    };

    const text = processNum(n).toUpperCase();
    return addCurrency ? `${text} PESOS M/CTE` : text;
  }

  /**
   * Formatea las características de la finca en una lista HTML para el contrato.
   */
  private formatFincaFeatures(features: any[]): string {
    if (!features || features.length === 0) return '';

    const list = features.map((f) => {
      const name = typeof f === 'string' ? f : f.name || '';
      return `<li>${name.toUpperCase()}</li>`;
    });

    return `<ul style="margin-top: 10px; margin-bottom: 10px; font-size: 11pt; color: #333;">${list.join('')}</ul>`;
  }

  /**
   * Sanitiza un string para usarlo como nombre de archivo.
   * Remueve acentos, caracteres especiales y espacios.
   */
  private sanitizeFilename(text: string): string {
    return text
      .toString()
      .normalize('NFD') // Descomponer caracteres con acentos
      .replace(/[\u0300-\u036f]/g, '') // Eliminar acentos
      .replace(/[^a-z0-9]/gi, '_') // Reemplazar caracteres no alfanumÃ©ricos por guiÃ³n bajo
      .replace(/_+/g, '_') // Reemplazar guiones bajos mÃºltiples por uno solo
      .replace(/^_|_$/g, ''); // Eliminar guiones bajos al inicio o final
  }

  /**
   * Envuelve un fragmento HTML del contrato (construido en el frontend con
   * cláusulas, cuentas y propietario) en un documento completo listo para PDF.
   * Incrusta el logo de FincasYA como data URL para que aparezca en el PDF
   * aunque puppeteer no tenga acceso al servidor de assets.
   * El fragmento puede ya traer `<!DOCTYPE>` o `<html>`; si es así, lo
   * devolvemos tal cual.
   */
  private async wrapContractFragmentHtml(
    fragment: string,
    finca: { title?: string; location?: string },
    contractNumber: string,
  ): Promise<string> {
    const trimmed = fragment.trim();
    if (/^<!doctype/i.test(trimmed) || /^<html[\s>]/i.test(trimmed)) {
      return trimmed;
    }
    const titleParts = [
      'Contrato',
      contractNumber || '',
      finca.title || '',
    ].filter((s) => s && String(s).trim().length > 0);
    const safeTitle = titleParts
      .join(' - ')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    const logoDataUrl = await this.pdfService
      .getLocalAssetDataUrl([
        path.resolve(
          process.cwd(),
          '../FincasYaWeb/public/logo-contrato.jpg',
        ),
        path.resolve(
          process.cwd(),
          '../FincasYaWeb/public/fincasya-negro-logo-reserva.png',
        ),
        path.resolve(process.cwd(), '../FincasYaWeb/public/icons/FincasYA.png'),
        path.resolve(process.cwd(), '../FincasYaWeb/public/fincas-ya-logo.png'),
      ])
      .catch(() => null);

    const logoHeader = logoDataUrl
      ? `<div class="contract-logo"><img src="${logoDataUrl}" alt="FincasYA" /></div>`
      : '';

    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<title>${safeTitle}</title>
<style>
  @page { size: A4; margin: 18mm 18mm 20mm 18mm; }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    font-family: Arial, Helvetica, sans-serif;
    font-size: 11pt;
    color: #111;
    line-height: 1.55;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  body { padding: 0 4mm; }
  .contract-logo {
    margin: 0 0 12pt 0;
    text-align: left;
  }
  .contract-logo img {
    height: 70pt;
    width: auto;
    max-width: 180pt;
    object-fit: contain;
    display: inline-block;
  }
  p { margin: 0 0 8pt 0; text-align: justify; }
  strong, b { color: #000; }
  h1, h2, h3 { color: #000; }
  h1 { font-size: 14pt; }
  h2 { font-size: 12pt; margin-top: 14pt; margin-bottom: 6pt; }
  ul, ol { margin: 4pt 0 8pt 22pt; padding: 0; }
  li { margin-bottom: 4pt; text-align: justify; }
  table { width: 100%; border-collapse: collapse; margin: 4pt 0 10pt 0; }
  td, th { padding: 3pt 6pt; vertical-align: top; }
  a { color: #1d4ed8; text-decoration: none; }
  u { text-decoration: underline; }
  /* Evita que firmas y bloques de cierre queden colgando solos */
  div, p { page-break-inside: avoid; }
</style>
</head>
<body>
${logoHeader}
${trimmed}
</body>
</html>`;
  }

  /**
   * Construye un HTML mínimo con los datos del contrato para generar PDF con puppeteer
   * cuando la conversión del .docx falla.
   */
  private buildContractFallbackHtml(
    v: Record<string, string>,
    finca: { title?: string; location?: string },
  ): string {
    const row = (label: string, value: string) =>
      value
        ? `<tr><td style="color:#555;width:40%;padding:4px 8px;">${label}</td><td style="font-weight:600;padding:4px 8px;">${value}</td></tr>`
        : '';
    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<style>
  body{font-family:Arial,sans-serif;font-size:11pt;color:#1a1a1a;margin:0;padding:0;}
  .wrap{max-width:800px;margin:0 auto;padding:30px 40px;}
  h1{font-size:14pt;text-align:center;text-transform:uppercase;border-bottom:2px solid #111;padding-bottom:10px;margin-bottom:20px;}
  h2{font-size:12pt;margin-top:24px;margin-bottom:4px;border-bottom:1px solid #ddd;padding-bottom:4px;}
  table{width:100%;border-collapse:collapse;margin-bottom:16px;}
  td{vertical-align:top;}
  .total{background:#111;color:#fff;text-align:right;padding:10px 14px;font-size:13pt;font-weight:bold;margin-top:20px;}
  .clause{margin-bottom:10px;font-size:10pt;line-height:1.5;}
  .footer{margin-top:40px;display:flex;justify-content:space-between;}
  .sig{text-align:center;width:45%;border-top:1px solid #111;padding-top:6px;font-size:10pt;}
</style>
</head>
<body>
<div class="wrap">
  <h1>Contrato de Arrendamiento por Días<br/>
    <span style="font-size:10pt;font-weight:normal;">${finca.title || ''} — ${finca.location || ''}</span>
  </h1>
  <p style="text-align:right;font-size:10pt;color:#555;">Fecha: ${v['fechaGeneracion'] || v['FECHA_GENERACIÓN DE CONTRATO (FORMATO DIA(NUMERO) MES(TEXTO) de AÑO(NUMERO))'] || ''}</p>

  <h2>Datos del Contrato</h2>
  <table>
    ${row('Contrato N°', v['contratoNumero'] || '')}
    ${row('Finca', finca.title || '')}
    ${row('Ubicación', finca.location || '')}
  </table>

  <h2>Datos del Arrendatario</h2>
  <table>
    ${row('Nombre completo', v['clienteNombre'] || '')}
    ${row('Cédula', v['clienteCedula'] || '')}
    ${row('Ciudad', v['ciudadCliente'] || '')}
    ${row('Dirección', v['direccionCliente'] || '')}
    ${row('Celular', v['clienteCelular'] || '')}
    ${row('Correo', v['clientCorreo'] || '')}
  </table>

  <h2>Detalles de la Reserva</h2>
  <table>
    ${row('Fecha entrada', v['fechaEntrada'] || '')}
    ${row('Hora entrada', v['horaLlegada'] || '')}
    ${row('Fecha salida', v['fechaSalida'] || '')}
    ${row('Hora salida', v['horaSalida'] || '')}
    ${row('Número de noches', v['nochesNumero'] || '')}
  </table>

  <h2>Valor del Contrato</h2>
  <table>
    ${row('Valor en letras', v['precioLetras'] || '')}
    ${row('Valor numérico', v['precioNumerico'] || '')}
    ${row('Banco', v['bancoNombre'] || '')}
    ${row('Cuenta', v['cuentaNumero'] || '')}
    ${row('Titular', v['titularNombre'] || '')}
    ${row('Cédula titular', v['titularCedula'] || '')}
  </table>

  <div class="total">Total: ${v['precioNumerico'] || ''}</div>

  <div class="footer">
    <div class="sig">
      <p>EL ARRENDADOR</p>
      <p>${v['titularNombre'] || '_____________________'}</p>
      <p>C.C. ${v['titularCedula'] || ''}</p>
    </div>
    <div class="sig">
      <p>EL ARRENDATARIO</p>
      <p>${v['clienteNombre'] || '_____________________'}</p>
      <p>C.C. ${v['clienteCedula'] || ''}</p>
    </div>
  </div>
</div>
</body>
</html>`;
  }

  /**
   * Convierte un buffer de Word (.docx) a PDF usando iLovePDF.
   */
  private async convertDocxToPdf(
    docxBuffer: Buffer,
    filename: string,
  ): Promise<Buffer> {
    const publicKey = process.env.ILOVEPDF_PUBLIC_KEY;
    const secretKey = process.env.ILOVEPDF_SECRET_KEY;

    if (!publicKey || !secretKey) {
      throw new Error('iLovePDF keys not configured in environment variables');
    }

    const instance = new ILovePDFApi(publicKey, secretKey);
    const task = instance.newTask('officepdf');

    await task.start();

    // Crear un archivo temporal para el SDK (es lo mÃ¡s seguro para este SDK)
    const tmp = require('os').tmpdir();
    const fs = require('fs');
    const path = require('path');
    const tmpFilePath = path.join(tmp, `${Date.now()}_${filename}`);

    fs.writeFileSync(tmpFilePath, docxBuffer);

    try {
      const file = new ILovePDFFile(tmpFilePath);
      await task.addFile(file);
      await task.process();
      const pdfBuffer = await task.download();

      return pdfBuffer as Buffer;
    } finally {
      // Limpiar archivo temporal
      if (fs.existsSync(tmpFilePath)) {
        fs.unlinkSync(tmpFilePath);
      }
    }
  }
}
