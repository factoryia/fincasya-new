import {
  Injectable,
  BadRequestException,
  NotFoundException,
  forwardRef,
  Inject,
} from '@nestjs/common';
import sharp from 'sharp';
import * as path from 'path';
import { promises as fs } from 'fs';
import { ConvexService } from '../shared/services/convex.service';
import { S3Service } from '../shared/services/s3.service';
import type { BookingsSyncService } from '../bookings/bookings-sync.service';

type ReservationPaymentMethod =
  | 'bbva'
  | 'bancolombia'
  | 'davivienda'
  | 'nequi'
  | 'pse'
  | 'tarjeta_credito';

type ReservationPaymentStatus = 'paid' | 'pending';

type ReservationConfirmationData = {
  propertyId: string;
  contractNumber: string;
  clientName: string;
  clientId: string;
  clientEmail: string;
  issueDate: string;
  clientPhone: string;
  clientAddress: string;
  propertyName: string;
  propertyLocation: string;
  checkInDate: string;
  checkOutDate: string;
  checkInTime: string;
  checkOutTime: string;
  guests: number;
  nights: number;
  depositAmount: number;
  depositDate: string;
  balanceAmount: number;
  balanceDate: string;
  rentAmount: number;
  cleaningFee: number;
  refundableDeposit: number;
  totalAmount: number;
  paymentMethod: ReservationPaymentMethod;
  paymentStatus: ReservationPaymentStatus;
};

type QuickReplyTemplatePayload = {
  title?: string;
  slashCommand?: string;
  intentKey?: string;
  content?: string;
  mediaType?: 'text' | 'audio';
  mediaUrl?: string;
  active?: boolean | string;
  order?: number | string;
};

@Injectable()
export class InboxService {
  constructor(
    private readonly convexService: ConvexService,
    private readonly s3Service: S3Service,
    @Inject(forwardRef(() => require('../bookings/bookings-sync.service').BookingsSyncService))
    private readonly bookingsSyncService: BookingsSyncService,
  ) {}

  async listConversations(params: {
    status?: 'ai' | 'human' | 'resolved';
    attended?: boolean;
    priority?: 'urgent' | 'low' | 'medium' | 'resolved';
    limit?: number;
  }) {
    return this.convexService.query('conversations:list', params);
  }

  async getMessages(conversationId: string, limit?: number) {
    return this.convexService.query('messages:listRecent', {
      conversationId,
      limit,
    });
  }

  async listQuickReplyTemplates() {
    return this.convexService.query('quickReplyTemplates:list', {});
  }

  async createQuickReplyTemplate(body: QuickReplyTemplatePayload, file?: Express.Multer.File) {
    const mediaType = (body.mediaType || (file ? 'audio' : 'text')) as 'text' | 'audio';
    let mediaUrl = body.mediaUrl?.trim();
    if (mediaType === 'audio' && file) {
      mediaUrl = await this.s3Service.uploadFile(file, 'inbox-templates', file.originalname);
    }
    return this.convexService.mutation('quickReplyTemplates:create', {
      title: String(body.title || '').trim(),
      slashCommand: String(body.slashCommand || '').trim(),
      intentKey: String(body.intentKey || '').trim(),
      content: body.content?.trim() || undefined,
      mediaType,
      mediaUrl: mediaUrl || undefined,
      active: this.parseBoolean(body.active, true),
      order: this.parseNumber(body.order),
      language: 'es',
    });
  }

  async updateQuickReplyTemplate(
    templateId: string,
    body: QuickReplyTemplatePayload,
    file?: Express.Multer.File,
  ) {
    const patch: Record<string, unknown> = { id: templateId };
    if (body.title !== undefined) patch.title = String(body.title).trim();
    if (body.slashCommand !== undefined) patch.slashCommand = String(body.slashCommand).trim();
    if (body.intentKey !== undefined) patch.intentKey = String(body.intentKey).trim();
    if (body.content !== undefined) patch.content = String(body.content);
    if (body.mediaType !== undefined) patch.mediaType = body.mediaType;
    if (body.mediaUrl !== undefined) patch.mediaUrl = String(body.mediaUrl).trim();
    if (body.active !== undefined) patch.active = this.parseBoolean(body.active, true);
    if (body.order !== undefined) patch.order = this.parseNumber(body.order);
    if (file) {
      const uploadedUrl = await this.s3Service.uploadFile(file, 'inbox-templates', file.originalname);
      patch.mediaUrl = uploadedUrl;
      patch.mediaType = 'audio';
    }
    return this.convexService.mutation('quickReplyTemplates:update', patch);
  }

  async deleteQuickReplyTemplate(templateId: string) {
    return this.convexService.mutation('quickReplyTemplates:remove', { id: templateId });
  }

  async sendQuickTemplateToConversation(conversationId: string, templateId: string) {
    const templates = await this.convexService.query('quickReplyTemplates:list', {});
    const template = (templates || []).find((t: any) => t._id === templateId);
    if (!template) throw new NotFoundException('Plantilla no encontrada');
    if (template.mediaType === 'audio') {
      return this.sendMessage(conversationId, {
        type: 'audio',
        text: template.content || undefined,
        mediaUrl: template.mediaUrl,
      });
    }
    return this.sendMessage(conversationId, {
      type: 'text',
      text: template.content || '',
    });
  }

  async setStatus(conversationId: string, status: 'ai' | 'human' | 'resolved') {
    if (status === 'ai') {
      return this.convexService.mutation('conversations:setToAiPublic', {
        conversationId,
      });
    }
    if (status === 'human') {
      return this.convexService.mutation('conversations:escalateToHuman', {
        conversationId,
      });
    }
    if (status === 'resolved') {
      return this.convexService.mutation('conversations:resolveConversation', {
        conversationId,
      });
    }
    throw new BadRequestException('status debe ser ai, human o resolved');
  }

  async setPriority(
    conversationId: string,
    priority: 'urgent' | 'low' | 'medium' | 'resolved',
  ) {
    return this.convexService.mutation('conversations:setPriority', {
      conversationId,
      priority,
    });
  }

  async sendMessage(
    conversationId: string,
    params: {
      type: 'text' | 'image' | 'audio' | 'document' | 'product';
      text?: string;
      mediaUrl?: string;
      filename?: string;
      metadata?: any;
      file?: Express.Multer.File;
    },
  ) {
    const { type, text, mediaUrl, metadata, file, filename: requestedFilename } =
      params;
    if (type === 'text' && !text?.trim()) {
      throw new BadRequestException(
        'Texto requerido para mensaje de tipo text',
      );
    }
    if (type !== 'text' && type !== 'product' && !file && !mediaUrl?.trim()) {
      throw new BadRequestException(
        'Archivo o mediaUrl requerido para imagen/audio/documento',
      );
    }
    const conv = await this.convexService.query('conversations:getById', {
      conversationId,
    });
    if (!conv) throw new NotFoundException('Conversacion no encontrada');
    const contact = await this.convexService.query('contacts:getById', {
      contactId: conv.contactId,
    });
    if (!contact) throw new NotFoundException('Contacto no encontrado');
    const phone = this.normalizePhoneE164(contact.phone);

    let finalMediaUrl = mediaUrl;
    let mediaUrlForStorage: string | undefined;
    let filename: string | undefined = requestedFilename;
    if (file && type !== 'text' && type !== 'product') {
      let fileToUpload = file;
      if (type === 'image') {
        fileToUpload = await this.ensureImageCompatible(file);
      }
      const publicUrl = await this.s3Service.uploadFile(
        fileToUpload,
        'inbox',
        filename,
      );
      filename = fileToUpload.originalname;
      mediaUrlForStorage = publicUrl;
      // Presigned URL lets Convex/YCloud fetch even if bucket has restrictions.
      const key = publicUrl.split('.com/')[1];
      finalMediaUrl = key
        ? await this.s3Service.getPresignedDownloadUrl(key)
        : publicUrl;
    }

    const result = await this.convexService.action('inbox:sendMessage', {
      conversationId,
      phone,
      type,
      text: text?.trim() || undefined,
      metadata,
      mediaUrl: finalMediaUrl,
      mediaUrlForStorage,
      filename,
    });
    return result ?? { ok: true };
  }

  /** Convierte WebP y otros formatos no soportados por WhatsApp a JPEG */
  private async ensureImageCompatible(
    file: Express.Multer.File,
  ): Promise<Express.Multer.File> {
    const mime = (file.mimetype || '').toLowerCase();
    if (['image/jpeg', 'image/png'].includes(mime)) {
      return file;
    }
    if (!file.buffer) {
      throw new BadRequestException('El archivo no tiene buffer en memoria');
    }
    try {
      const jpegBuffer = await sharp(file.buffer)
        .jpeg({ quality: 90 })
        .toBuffer();
      const baseName = (file.originalname || 'image').replace(/\.[^.]+$/, '');
      return {
        ...file,
        buffer: jpegBuffer,
        mimetype: 'image/jpeg',
        originalname: `${baseName}.jpg`,
      } as Express.Multer.File;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new BadRequestException(
        `No se pudo convertir la imagen a JPEG: ${msg}. Use JPEG o PNG.`,
      );
    }
  }

  async getSuggestedContractData(
    conversationId: string,
    forceFresh: boolean = false,
  ) {
    const [suggestedRaw, conv] = await Promise.all([
      this.convexService
        .action('ycloud:extractContractData', { conversationId, forceFresh })
        .catch(() => ({})),
      this.convexService.query('conversations:getById', { conversationId }),
    ]);


    const data: any =
      suggestedRaw && typeof suggestedRaw === 'object' && !(suggestedRaw as any).error
        ? suggestedRaw
        : {};

    if (conv) {
      const contact = await this.convexService.query('contacts:getById', {
        contactId: conv.contactId,
      });

      if (contact) {
        // Priorizar datos del contacto oficial sobre la extracción AI (que puede fallar)
        if (contact.name) data.clientName = contact.name;
        if (contact.phone) data.clientPhone = contact.phone;
        if (contact.email && !data.clientEmail) data.clientEmail = contact.email;
        if (contact.cedula && !data.clientId) data.clientId = contact.cedula;
        if (contact.city && !data.clientCity) data.clientCity = contact.city;
      }

      // Si no tenemos propiedad detectada, buscarla en los mensajes recientes (Catalogos o documentos previos)
      if (!data.propertyId) {
        const messages = await this.convexService.query('messages:listRecent', {
          conversationId,
          limit: 60,
        });

        // Buscar el último mensaje que sea un producto o que tenga metadata de propiedad
        const latestPropMatch = [...(messages || [])].reverse().find(
          (m) =>
            (m.type === 'product' &&
              (m.metadata?.product?.slug || m.metadata?.product?.id)) ||
            m.metadata?.propertyId,
        );

        if (latestPropMatch) {
          if (latestPropMatch.metadata?.propertyId) {
            data.propertyId = latestPropMatch.metadata.propertyId;
          } else if (latestPropMatch.metadata?.product) {
            const product = latestPropMatch.metadata.product;
            const slug = product.slug || product.id;
            // Intentar buscar la finca por slug
            const property = await this.convexService
              .query('fincas:getBySlug', { slug })
              .catch(() =>
                this.convexService.query('fincas:getByCode', { code: slug }),
              )
              .catch(() => null);

            if (property) {
              data.propertyId = property._id;
            }
          }
        }
      }
    }

    return data;
  }

  async getSuggestedBookingData(conversationId: string) {
    // Reuse the enriched contract extraction logic for quick booking as well.
    return this.getSuggestedContractData(conversationId);
  }

  async getReservationConfirmationData(conversationId: string) {
    const [messages, conv, suggestedRaw] = await Promise.all([
      this.convexService.query('messages:listRecent', { conversationId, limit: 120 }),
      this.convexService.query('conversations:getById', { conversationId }),
      this.getSuggestedContractData(conversationId).catch(() => ({})),
    ]);

    const suggested: any =
      suggestedRaw &&
      typeof suggestedRaw === 'object' &&
      !(suggestedRaw as any).error
        ? suggestedRaw
        : {};

    const contact = conv
      ? await this.convexService.query('contacts:getById', {
          contactId: conv.contactId,
        })
      : null;

    const latestContractDocument = [...(messages || [])]
      .reverse()
      .find(
        (msg: any) =>
          msg.sender === 'assistant' &&
          msg.type === 'document' &&
          (msg.metadata?.kind === 'generated_contract' ||
            /contrato/i.test(String(msg.content || msg.text || ''))),
      );
    const latestGeneratedContract =
      latestContractDocument?.metadata?.kind === 'generated_contract'
        ? latestContractDocument
        : null;

    const contractData = latestGeneratedContract?.metadata?.contractData || {};

    const propertyId = String(
      contractData.propertyId || suggested.propertyId || '',
    );
    const property = propertyId
      ? await this.convexService
          .query('fincas:getById', { id: propertyId })
          .catch(() => null)
      : null;

    const checkInDate = this.toIsoDate(
      contractData.checkInDate || suggested.checkInDate || '',
    );
    const checkOutDate = this.toIsoDate(
      contractData.checkOutDate || suggested.checkOutDate || '',
    );
    const nights = this.calculateNights(checkInDate, checkOutDate);
    const totalAmount = this.toNumber(
      contractData.totalPrice || suggested.totalPrice || 0,
    );
    const depositAmount = Math.round(totalAmount * 0.5);
    const balanceAmount = Math.max(totalAmount - depositAmount, 0);
    const contractNumber = String(
      contractData.contractNumber ||
        this.extractContractNumber(
          contractData.generatedFileName ||
            latestContractDocument?.content ||
            latestContractDocument?.mediaUrl ||
            '',
        ),
    );

    const preloaded: ReservationConfirmationData = {
      propertyId,
      contractNumber,
      clientName: String(
        contractData.clientName ||
          suggested.clientName ||
          contact?.name ||
          conv?.contact?.name ||
          '',
      ),
      clientId: String(contractData.clientId || suggested.clientId || ''),
      clientEmail: String(
        contractData.clientEmail || suggested.clientEmail || contact?.email || '',
      ),
      issueDate: this.toIsoDate(new Date()),
      clientPhone: String(
        contractData.clientPhone ||
          suggested.clientPhone ||
          contact?.phone ||
          conv?.contact?.phone ||
          '',
      ),
      clientAddress: String(
        contractData.clientAddress || suggested.clientAddress || '',
      ),
      propertyName: String(
        contractData.propertyTitle || property?.title || suggested.fincaName || '',
      ),
      propertyLocation: String(
        contractData.propertyLocation || property?.location || '',
      ),
      checkInDate,
      checkOutDate,
      checkInTime: String(contractData.checkInTime || suggested.checkInTime || '10:00'),
      checkOutTime: String(
        contractData.checkOutTime || suggested.checkOutTime || '16:00',
      ),
      guests: this.toNumber(contractData.numeroPersonas || suggested.numeroPersonas || 1),
      nights,
      depositAmount,
      depositDate: this.toIsoDate(new Date()),
      balanceAmount,
      balanceDate: checkInDate || '',
      rentAmount: this.toNumber(contractData.subtotal || suggested.subtotal || totalAmount),
      cleaningFee: this.toNumber(contractData.cleaningFee || suggested.cleaningFee || 0),
      refundableDeposit: this.toNumber(
        contractData.petSurchargeRefundable ||
          contractData.depositoGarantia ||
          suggested.petSurchargeRefundable ||
          suggested.depositoGarantia ||
          0,
      ),
      totalAmount,
      paymentMethod: 'bancolombia',
      paymentStatus: 'pending',
    };

    return {
      contractReady: !!latestContractDocument,
      source:
        latestGeneratedContract?.metadata?.kind ||
        suggested.source ||
        'conversation_ai',
      data: preloaded,
    };
  }

  async generateReservationConfirmationPreview(
    conversationId: string,
    payload: any,
  ) {
    const prepared = await this.prepareReservationConfirmationData(
      conversationId,
      payload,
    );
    const pdfBuffer = await this.generateReservationConfirmationPdfBuffer(prepared);
    const safeContract = (prepared.contractNumber || String(Date.now())).replace(
      /[^a-zA-Z0-9_-]/g,
      '',
    );
    const filename = `Confirmacion_Reserva_${safeContract}.pdf`;

    return {
      success: true,
      buffer: Buffer.from(pdfBuffer),
      filename,
      message: 'Previsualizacion generada correctamente',
    };
  }

  async sendReservationConfirmation(conversationId: string, payload: any) {
    const prepared = await this.prepareReservationConfirmationData(
      conversationId,
      payload,
    );
    const pdfBuffer = await this.generateReservationConfirmationPdfBuffer(prepared);
    const safeContract = (prepared.contractNumber || String(Date.now())).replace(
      /[^a-zA-Z0-9_-]/g,
      '',
    );
    const filename = `Confirmacion_Reserva_${safeContract}.pdf`;

    const generatedFile: Express.Multer.File = {
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

    await this.sendMessage(conversationId, {
      type: 'document',
      text: `Hola ${prepared.clientName}, aqui tienes tu confirmacion de reserva No. ${prepared.contractNumber}.`,
      file: generatedFile,
      filename,
      metadata: {
        kind: 'reservation_confirmation',
        reservationConfirmationData: prepared,
      },
    });

    return {
      success: true,
      filename,
      message: 'Confirmacion de reserva enviada correctamente',
    };
  }

  async createBookingFromConversation(params: {
    conversationId: string;
    propertyId: string;
    nombreCompleto: string;
    cedula: string;
    celular: string;
    correo: string;
    fechaEntrada: string | number;
    fechaSalida: string | number;
    numeroPersonas: number | string;
    precioTotal: number | string;
    temporada: string;
    observaciones?: string;
    multimediaFiles?: Express.Multer.File[];
  }) {
    const { conversationId, multimediaFiles, ...bookingParams } = params;

    // 2. Create booking and sync to Google.
    const result = await this.bookingsSyncService.createBooking(
      bookingParams as any,
      multimediaFiles,
    );

    return result;
  }

  async markAsAttended(conversationId: string) {
    return this.convexService.mutation('conversations:markAsAttended', {
      conversationId,
    });
  }

  private async prepareReservationConfirmationData(
    conversationId: string,
    payload: any,
  ): Promise<ReservationConfirmationData> {
    const safePayload = payload || {};
    const propertyId = String(safePayload.propertyId || '');
    const property = propertyId
      ? await this.convexService
          .query('fincas:getById', { id: propertyId })
          .catch(() => null)
      : null;

    const checkInDate = this.toIsoDate(safePayload.checkInDate);
    const checkOutDate = this.toIsoDate(safePayload.checkOutDate);
    const nights =
      this.toNumber(safePayload.nights) ||
      this.calculateNights(checkInDate, checkOutDate);

    const payloadTotal = this.toNumber(safePayload.totalAmount);
    const rentAmount = this.toNumber(safePayload.rentAmount);
    const cleaningFee = this.toNumber(safePayload.cleaningFee);
    const refundableDeposit = this.toNumber(safePayload.refundableDeposit);
    const computedTotal =
      payloadTotal || rentAmount + cleaningFee + refundableDeposit;

    const prepared: ReservationConfirmationData = {
      propertyId,
      contractNumber: String(safePayload.contractNumber || ''),
      clientName: String(safePayload.clientName || ''),
      clientId: String(safePayload.clientId || ''),
      clientEmail: String(safePayload.clientEmail || ''),
      issueDate: this.toIsoDate(safePayload.issueDate || new Date()),
      clientPhone: String(safePayload.clientPhone || ''),
      clientAddress: String(safePayload.clientAddress || ''),
      propertyName: String(safePayload.propertyName || property?.title || ''),
      propertyLocation: String(
        safePayload.propertyLocation || property?.location || '',
      ),
      checkInDate,
      checkOutDate,
      checkInTime: String(safePayload.checkInTime || '10:00'),
      checkOutTime: String(safePayload.checkOutTime || '16:00'),
      guests: Math.max(1, this.toNumber(safePayload.guests || 1)),
      nights: Math.max(1, nights),
      depositAmount: this.toNumber(safePayload.depositAmount),
      depositDate: this.toIsoDate(safePayload.depositDate || new Date()),
      balanceAmount: this.toNumber(safePayload.balanceAmount),
      balanceDate: this.toIsoDate(safePayload.balanceDate || checkInDate),
      rentAmount,
      cleaningFee,
      refundableDeposit,
      totalAmount: computedTotal,
      paymentMethod: this.normalizePaymentMethod(safePayload.paymentMethod),
      paymentStatus:
        safePayload.paymentStatus === 'paid' ? 'paid' : 'pending',
    };

    if (!prepared.clientName || !prepared.checkInDate || !prepared.checkOutDate) {
      throw new BadRequestException(
        'Faltan datos obligatorios para generar la confirmacion de reserva',
      );
    }

    // Keep balance in sync when admin only enters total and deposit.
    if (!prepared.balanceAmount && prepared.totalAmount) {
      prepared.balanceAmount = Math.max(
        prepared.totalAmount - prepared.depositAmount,
        0,
      );
    }

    // Keep traceability in the generated PDF metadata for audits.
    if (!prepared.contractNumber) {
      prepared.contractNumber = this.extractContractNumber(
        `conv-${conversationId}`,
      );
    }

    return prepared;
  }

  private async generateReservationConfirmationPdfBuffer(
    data: ReservationConfirmationData,
  ): Promise<Uint8Array> {
    const html = await this.buildReservationConfirmationHtml(data);
    const puppeteer = await import('puppeteer');
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1400, height: 990, deviceScaleFactor: 1 });
      await page.emulateMediaType('screen');
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const pdfBuffer = await page.pdf({
        width: '297mm',
        height: '210mm',
        printBackground: true,
        preferCSSPageSize: true,
        margin: { top: '0', right: '0', bottom: '0', left: '0' },
      });
      return pdfBuffer;
    } finally {
      await browser.close();
    }
  }

  private async buildReservationConfirmationHtml(
    data: ReservationConfirmationData,
  ): Promise<string> {
    const logoDataUrl = await this.getLocalAssetDataUrl([
      path.resolve(
        process.cwd(),
        '../FincasYaWeb/public/fincasya-negro-logo-reserva.png',
      ),
      path.resolve(process.cwd(), '../FincasYaWeb/public/icons/FincasYA.png'),
      path.resolve(process.cwd(), '../FincasYaWeb/public/fincas-ya-logo.png'),
      path.resolve(
        process.cwd(),
        '../FincasYaWeb/public/icons/fincas-ya-logo.png',
      ),
    ]);
    const whatsappIconDataUrl = await this.getLocalAssetDataUrl([
      path.resolve(process.cwd(), '../FincasYaWeb/public/icons/whatsapp.svg'),
    ]);

    const paymentMarks: Record<ReservationPaymentMethod, string> = {
      bbva: '',
      bancolombia: '',
      davivienda: '',
      nequi: '',
      pse: '',
      tarjeta_credito: '',
    };
    paymentMarks[data.paymentMethod] = 'X';

    const logoHtml = logoDataUrl
      ? `<img src="${logoDataUrl}" alt="FINCASYA LOGO" style="max-width: 250px; max-height: 75px; object-fit: contain;">`
      : `<div style="font-size: 32px; font-weight: 700; color: #e46f3d;">FincasYa</div>`;

    const whatsappIconHtml = whatsappIconDataUrl
      ? `<img src="${whatsappIconDataUrl}" alt="WA">`
      : '';

    const paymentStatusText =
      data.paymentStatus === 'paid' ? 'PAGADO' : 'PENDIENTE DE PAGO';

    const termsText =
      '*NO SE RECIBE PAGO EN EFECTIVO* El presente documento se asimila en todos sus efectos legales a una letra de cambio seg&uacute;n el art&iacute;culo 774 del c&oacute;digo de comercio condiciones generales; FINCASYA no se compromete a realizar devoluciones de dinero en caso de cancelaciones fortuitas por razones ajenas a nuestra voluntad, se aplazar&aacute; la fecha en caso dado siempre y cuando la novedad sea notificada como m&iacute;nimo siete (7) d&iacute;as h&aacute;biles antes de la fecha de ingreso registrada. *Nos reservamos el derecho de admisi&oacute;n en algunas propiedades. *FINCASYA no se har&aacute; responsable de accidentes ocasionados durante su estancia, tampoco por hurtos o da&ntilde;os ocasionados por terceros. *HORARIOS; check in 10:00am en adelante, check out 03:00pm, el hecho de sobrepasar el horario de salida se entender&aacute; como adicional, con una tarifa establecida por hora y ser&aacute;n descontadas del dep&oacute;sito de seguridad. *Las personas adicionales al n&uacute;mero de personas contratadas se considerar&aacute;n como adicional. *Indicar si hay mascotas en el grupo, el hecho de no recoger las necesidades de sus mascotas ser&aacute; motivo de penalidad, de igual forma las mascotas que se suban a las camas y muebles o que ocasionen da&ntilde;os son conductas que dan para multar al responsable contratante. *Solicitar con anticipaci&oacute;n el servicio de apoyo en cocina o cualquier otro servicio adicional. *Los hu&eacute;spedes se comprometen a entregar el inmueble en &oacute;ptimas condiciones tal como se les fue entregado, los da&ntilde;os que pudieren ocasionarse ser&aacute;n descontados del dep&oacute;sito, si el da&ntilde;o supera el valor del dep&oacute;sito ser&aacute; por cuenta del hu&eacute;sped la reposici&oacute;n del bien averiado teni&eacute;ndose un plazo m&aacute;ximo de cinco (5) d&iacute;as h&aacute;biles para reparar el da&ntilde;o. *El dep&oacute;sito se reintegrar&aacute; bien sea a su salida o al d&iacute;a siguiente de la desocupaci&oacute;n una vez se haya concluido la revisi&oacute;n leg&iacute;tima de la propiedad. *En caso de: perturbar el sector con malas pr&aacute;cticas y desobediencia del c&oacute;digo civil colombiano, ri&ntilde;as, altos decibeles en horas no permitidas, fiestas y eventos clandestinos no autorizados ni contratados, agresiones a las autoridades o a terceros; FINCASYA no tendr&aacute; ning&uacute;n nivel de responsabilidad, las imputaciones, multas y sanciones son y ser&aacute;n enteramente por cuenta y responsabilidad del Contratante. *Todos los valores anteriormente mencionados NO incluyen IVA.';

    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Confirmaci&oacute;n de Reserva</title>
  <style>
    @page { size: A4 landscape; margin: 0; }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      width: 297mm;
      height: 210mm;
      font-family: 'Calibri', 'Segoe UI', Arial, sans-serif;
      color: #000;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    body {
      background-color: #f9ebe0;
    }
    .sheet {
      width: 297mm;
      height: 210mm;
      padding: 8mm 9mm 7mm;
      overflow: hidden;
      background-color: #f9ebe0;
      background-image:
        linear-gradient(115deg, transparent 20%, rgba(226, 185, 161, 0.3) 25%, rgba(226, 185, 161, 0.3) 35%, transparent 40%),
        linear-gradient(115deg, transparent 60%, rgba(226, 185, 161, 0.15) 65%, rgba(226, 185, 161, 0.15) 75%, transparent 80%),
        radial-gradient(circle at 5% 5%, rgba(255, 255, 255, 0.9) 0%, rgba(249, 235, 224, 0.6) 40%, rgba(226, 192, 173, 0.8) 100%);
    }
    .wrapper {
      width: 100%;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 4mm;
      padding: 0 2mm;
    }
    .header-logo {
      width: 26%;
      display: flex;
      align-items: center;
    }
    .header-title-container {
      width: 48%;
      text-align: center;
      padding-top: 4mm;
    }
    .header-title {
      font-size: 26px;
      color: #7a8288;
      white-space: nowrap;
    }
    .header-contact {
      width: 26%;
      display: flex;
      justify-content: flex-end;
      align-items: center;
      font-size: 20px;
      font-weight: 600;
      color: #7a8288;
      white-space: nowrap;
    }
    .header-contact img {
      height: 24px;
      margin-right: 8px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      background-color: #eaddd1;
      table-layout: fixed;
    }
    .table-1 {
      margin-bottom: 5mm;
    }
    .table-banks, .table-terms {
      margin-top: -1px;
    }
    th, td {
      border: 1px solid #000;
      padding: 6px 10px;
      vertical-align: middle;
      font-size: 14px;
      line-height: 1.08;
      word-wrap: break-word;
    }
    .peach {
      background-color: #efbc9b;
    }
    .value-cell, .empty-box {
      background-color: #eaddd1;
    }
    .right-align {
      text-align: right;
    }
    .terms-text {
      font-size: 11px;
      text-align: justify;
      padding: 10px 14px;
      line-height: 1.3;
    }
    .payment-mark {
      text-align: center;
      font-weight: 700;
      font-size: 20px;
    }
    .status-row td {
      text-align: center;
      font-weight: 700;
      font-size: 15px;
      padding: 8px;
    }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="wrapper">
      <div class="header">
        <div class="header-logo">${logoHtml}</div>
        <div class="header-title-container">
          <div class="header-title">Confirmaci&oacute;n de Reserva N.&ordm; ${this.escapeHtml(data.contractNumber || '-')}</div>
        </div>
        <div class="header-contact">${whatsappIconHtml}315 777 3937</div>
      </div>

      <table class="table-1">
        <tr>
          <td class="peach" style="width: 18%;">NOMBRE</td>
          <td class="value-cell" style="width: 46%;">${this.escapeHtml(data.clientName || '-')}</td>
          <td class="peach" style="width: 11%;">C. C.</td>
          <td class="value-cell" style="width: 25%;">${this.escapeHtml(data.clientId || '-')}</td>
        </tr>
        <tr>
          <td class="peach">Correo electr&oacute;nico</td>
          <td class="value-cell">${this.escapeHtml(data.clientEmail || '-')}</td>
          <td class="peach">Fecha</td>
          <td class="value-cell">${this.escapeHtml(this.formatDateDisplay(data.issueDate))}</td>
        </tr>
        <tr>
          <td class="peach">Tel de contacto</td>
          <td class="value-cell">${this.escapeHtml(data.clientPhone || '-')}</td>
          <td class="peach">DIRECCI&Oacute;N</td>
          <td class="value-cell">${this.escapeHtml(data.clientAddress || '-')}</td>
        </tr>
      </table>

      <table class="table-2">
        <tr>
          <td class="peach" style="width: 18%;">Propiedad</td>
          <td class="value-cell" style="width: 31%;">${this.escapeHtml(data.propertyName || '-')}</td>
          <td colspan="2" class="value-cell" style="width: 32%;">Contrato: ${this.escapeHtml(data.contractNumber || '-')}</td>
          <td rowspan="5" class="empty-box" style="width: 19%;"></td>
        </tr>
        <tr>
          <td class="peach">Ubicaci&oacute;n</td>
          <td colspan="3" class="value-cell">${this.escapeHtml(data.propertyLocation || '-')}</td>
        </tr>
        <tr>
          <td class="peach">Fecha de Ingreso</td>
          <td class="value-cell">${this.escapeHtml(this.formatDateLong(data.checkInDate))}</td>
          <td class="peach" style="width: 16%;">Fecha de Salida</td>
          <td class="value-cell" style="width: 16%;">${this.escapeHtml(this.formatDateLong(data.checkOutDate))}</td>
        </tr>
        <tr>
          <td class="peach">Chek In / Chek Out</td>
          <td colspan="3" class="value-cell">${this.escapeHtml(this.formatTimeDisplay(data.checkInTime))} / ${this.escapeHtml(this.formatTimeDisplay(data.checkOutTime))}</td>
        </tr>
        <tr>
          <td class="peach">Hu&eacute;spedes</td>
          <td class="value-cell">${this.escapeHtml(String(data.guests || 1))}</td>
          <td class="peach">Noches</td>
          <td class="value-cell">${this.escapeHtml(String(data.nights || 1).padStart(2, '0'))}</td>
        </tr>
        <tr>
          <td class="peach">Valor Abono</td>
          <td class="value-cell">${this.escapeHtml(this.formatCurrency(data.depositAmount))}</td>
          <td colspan="2" class="peach right-align">Valor Alquiler</td>
          <td class="value-cell">${this.escapeHtml(this.formatCurrency(data.rentAmount))}</td>
        </tr>
        <tr>
          <td class="peach">Fecha Abono</td>
          <td class="value-cell">${this.escapeHtml(this.formatDateLong(data.depositDate))}</td>
          <td colspan="2" class="peach right-align">Valor Limpieza General</td>
          <td class="value-cell">${this.escapeHtml(this.formatCurrency(data.cleaningFee))}</td>
        </tr>
        <tr>
          <td class="peach">Valor Saldo</td>
          <td class="value-cell">${this.escapeHtml(this.formatCurrency(data.balanceAmount))}</td>
          <td colspan="2" class="peach right-align">*Valor Dep&oacute;sito Reembolsable</td>
          <td class="value-cell">${this.escapeHtml(this.formatCurrency(data.refundableDeposit))}</td>
        </tr>
        <tr>
          <td class="peach">Fecha Saldo</td>
          <td class="value-cell">${this.escapeHtml(this.formatDateLong(data.balanceDate))}</td>
          <td colspan="2" class="peach right-align">Valor TOTAL</td>
          <td class="value-cell">${this.escapeHtml(this.formatCurrency(data.totalAmount))}</td>
        </tr>
      </table>

      <table class="table-banks">
        <tr>
          <td style="width: 10%;">BBVA</td><td style="width: 5%;" class="payment-mark">${paymentMarks.bbva}</td>
          <td style="width: 12%;">Bancolombia</td><td style="width: 5%;" class="payment-mark">${paymentMarks.bancolombia}</td>
          <td style="width: 12%;">Davivienda</td><td style="width: 5%;" class="payment-mark">${paymentMarks.davivienda}</td>
          <td style="width: 10%;">Nequi</td><td style="width: 5%;" class="payment-mark">${paymentMarks.nequi}</td>
          <td style="width: 8%;">PSE</td><td style="width: 5%;" class="payment-mark">${paymentMarks.pse}</td>
          <td style="width: 15%;">Tarjeta Cr&eacute;dito</td><td style="width: 8%;" class="payment-mark">${paymentMarks.tarjeta_credito}</td>
        </tr>
        <tr class="status-row">
          <td colspan="12">ESTADO DE PAGO: ${this.escapeHtml(paymentStatusText)}</td>
        </tr>
      </table>

      <table class="table-terms">
        <tr>
          <td class="terms-text">${termsText}</td>
        </tr>
      </table>
    </div>
  </div>
</body>
</html>`;
  }

  private async getLocalAssetDataUrl(
    candidatePaths: string[],
  ): Promise<string | null> {
    for (const filePath of candidatePaths) {
      try {
        await fs.access(filePath);
        const fileBuffer = await fs.readFile(filePath);
        const ext = path.extname(filePath).toLowerCase();
        const mime =
          ext === '.png'
            ? 'image/png'
            : ext === '.svg'
              ? 'image/svg+xml'
              : ext === '.jpg' || ext === '.jpeg'
                ? 'image/jpeg'
                : 'application/octet-stream';
        return `data:${mime};base64,${fileBuffer.toString('base64')}`;
      } catch {
        // Try next path.
      }
    }
    return null;
  }

  private escapeHtml(value: string): string {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private formatTimeDisplay(time: string): string {
    const raw = String(time || '').trim();
    if (!raw) return '-';
    const match = raw.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return raw;
    let h = Number(match[1]);
    const mm = match[2];
    const suffix = h >= 12 ? 'PM' : 'AM';
    if (h === 0) h = 12;
    if (h > 12) h -= 12;
    return `${String(h).padStart(2, '0')}:${mm} ${suffix}`;
  }

  private extractContractNumber(input: string): string {
    if (!input) return '';
    const normalized = String(input);
    const byFile = normalized.match(/_(\d{2,})\.(pdf|docx)$/i);
    if (byFile?.[1]) return byFile[1];
    const byWord = normalized.match(/contrato[^0-9]{0,8}(\d{2,})/i);
    if (byWord?.[1]) return byWord[1];
    const generic = normalized.match(/(\d{3,})/);
    return generic?.[1] || '';
  }

  private normalizePaymentMethod(value: string): ReservationPaymentMethod {
    const normalized = String(value || '')
      .toLowerCase()
      .replace(/\s+/g, '_');
    const allowed: ReservationPaymentMethod[] = [
      'bbva',
      'bancolombia',
      'davivienda',
      'nequi',
      'pse',
      'tarjeta_credito',
    ];
    return allowed.includes(normalized as ReservationPaymentMethod)
      ? (normalized as ReservationPaymentMethod)
      : 'bancolombia';
  }

  private formatDateDisplay(dateLike: string): string {
    const iso = this.toIsoDate(dateLike);
    if (!iso) return '-';
    const [year, month, day] = iso.split('-');
    return `${day}/${month}/${year}`;
  }

  private formatDateLong(dateLike: string): string {
    const iso = this.toIsoDate(dateLike);
    if (!iso) return '-';
    const [year, month, day] = iso.split('-');
    const months = [
      'ENERO',
      'FEBRERO',
      'MARZO',
      'ABRIL',
      'MAYO',
      'JUNIO',
      'JULIO',
      'AGOSTO',
      'SEPTIEMBRE',
      'OCTUBRE',
      'NOVIEMBRE',
      'DICIEMBRE',
    ];
    const monthName = months[Math.max(0, Math.min(11, Number(month) - 1))];
    return `${day} DE ${monthName} DEL ${year}`;
  }

  private formatCurrency(value: number): string {
    const safe = Number.isFinite(value) ? value : 0;
    return new Intl.NumberFormat('es-CO', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(safe);
  }

  private calculateNights(checkInDate: string, checkOutDate: string): number {
    if (!checkInDate || !checkOutDate) return 1;
    const start = new Date(`${checkInDate}T00:00:00`);
    const end = new Date(`${checkOutDate}T00:00:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 1;
    const diffMs = end.getTime() - start.getTime();
    return Math.max(1, Math.round(diffMs / (1000 * 60 * 60 * 24)));
  }

  private toIsoDate(value: any): string {
    if (!value) return '';
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return this.dateToIso(value);
    }
    const raw = String(value).trim();
    if (!raw) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      return raw;
    }
    const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (slash) {
      const day = slash[1].padStart(2, '0');
      const month = slash[2].padStart(2, '0');
      return `${slash[3]}-${month}-${day}`;
    }
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      return this.dateToIso(parsed);
    }
    return '';
  }

  private dateToIso(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private toNumber(value: any): number {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const cleaned = String(value ?? '')
      .replace(/[^\d.-]/g, '')
      .trim();
    if (!cleaned) return 0;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private normalizePhoneE164(phone: string): string {
    let p = (phone || '').replace(/\D/g, '');
    if (p.startsWith('57') && p.length <= 12) {
      // Colombia with country code.
    } else if (p.length === 10 && p.startsWith('3')) {
      p = '57' + p; // Colombia local.
    }
    return p ? `+${p}` : phone;
  }

  private parseBoolean(value: unknown, fallback: boolean): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return value.toLowerCase() === 'true';
    return fallback;
  }

  private parseNumber(value: unknown): number | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    const num = Number(value);
    return Number.isFinite(num) ? num : undefined;
  }
}
