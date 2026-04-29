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
import { BookingsSyncService } from '../bookings/bookings-sync.service';
import { PdfService, ReservationConfirmationData, ReservationPaymentMethod } from '../shared/services/pdf.service';


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
    private readonly pdfService: PdfService,
    @Inject(forwardRef(() => BookingsSyncService))
    private readonly bookingsSyncService: BookingsSyncService,
  ) {}

  /**
   * `contacts.name` suele ser el apodo de perfil de WhatsApp (p. ej. "S").
   * No debe reemplazar un nombre completo extraído del chat.
   */
  private pickBetterClientName(storedName: string, extractedName: string): string {
    const db = (storedName ?? '').trim();
    const ex = (extractedName ?? '').trim();
    if (!ex) return db;
    if (!db) return ex;
    const dbT = db.split(/\s+/).filter(Boolean);
    const exT = ex.split(/\s+/).filter(Boolean);
    const looksLikeWhatsAppAlias =
      db.length <= 2 || (dbT.length === 1 && db.length <= 3 && !/\d/.test(db));
    if (looksLikeWhatsAppAlias && ex.length > db.length) return ex;
    if (exT.length >= 2 && dbT.length === 1 && ex.length > db.length) return ex;
    if (exT.length >= 3 && ex.length > db.length + 5) return ex;
    return db;
  }

  async listOperationalStateDefinitions() {
    return this.convexService.query('conversations:listOperationalStateDefinitions', {});
  }

  async listConversations(params: {
    status?: 'ai' | 'human' | 'resolved';
    attended?: boolean;
    priority?: 'urgent' | 'low' | 'medium' | 'resolved';
    operationalStates?: Array<
      | 'requires_advisor'
      | 'validate_availability'
      | 'ready_to_book'
      | 'pending_payment'
      | 'pending_data'
    >;
    assignedUserIds?: string[];
    unassignedOnly?: boolean;
    lastMessageFrom?: number;
    lastMessageTo?: number;
    limit?: number;
  }) {
    return this.convexService.query('conversations:list', params);
  }

  /**
   * Usuarios que pueden aparecer como asesores en el inbox (roles de equipo).
   */
  async listAssignableUsers() {
    const users = await this.convexService.query('users:list', { limit: 300 });
    const list = Array.isArray(users) ? users : [];
    return list
      .filter((u: { banned?: boolean; role?: string | null }) => u.banned !== true)
      .filter((u: { role?: string | null }) => {
        const r = u.role;
        return r === 'admin' || r === 'assistant' || r === 'vendedor';
      })
      .map((u: { _id: string; name: string; email: string; role?: string | null }) => ({
        _id: String(u._id),
        name: u.name,
        email: u.email,
        role: u.role ?? null,
      }));
  }

  async setAssignedUser(conversationId: string, assignedUserId: string | null) {
    return this.convexService.mutation('conversations:setAssignedUser', {
      conversationId,
      assignedUserId,
    });
  }

  async setOperationalState(
    conversationId: string,
    operationalState:
      | 'requires_advisor'
      | 'validate_availability'
      | 'ready_to_book'
      | 'pending_payment'
      | 'pending_data',
    userId?: string,
  ) {
    return this.convexService.mutation('conversations:setOperationalState', {
      conversationId,
      operationalState,
      userId,
    });
  }

  async getMessages(conversationId: string, limit?: number) {
    return this.convexService.query('messages:listRecent', {
      conversationId,
      limit,
    });
  }

  async getContactForConversation(conversationId: string) {
    const conv = await this.convexService.query('conversations:getById', {
      conversationId,
    });
    if (!conv) throw new NotFoundException('Conversacion no encontrada');
    const contact = await this.convexService.query('contacts:getById', {
      contactId: (conv as { contactId: string }).contactId,
    });
    if (!contact) throw new NotFoundException('Contacto no encontrado');
    return { contact, conversationId, contactId: (conv as { contactId: string }).contactId };
  }

  async updateContactForConversation(
    conversationId: string,
    body: {
      name?: string;
      cedula?: string;
      email?: string;
      city?: string;
      crmType?: 'lead' | 'client';
    },
  ) {
    const conv = await this.convexService.query('conversations:getById', {
      conversationId,
    });
    if (!conv) throw new NotFoundException('Conversacion no encontrada');
    return this.convexService.mutation('contacts:update', {
      contactId: (conv as { contactId: string }).contactId,
      ...body,
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
        fileToUpload = await this.pdfService.ensureImageCompatible(file);
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
        // Nombre: unir CRM y extracción sin dejar que el alias de WhatsApp pise el nombre del chat
        if (contact.name) {
          data.clientName = this.pickBetterClientName(
            contact.name,
            String(data.clientName ?? ''),
          );
        }
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

    const checkInDate = this.pdfService.toIsoDate(
      contractData.checkInDate || suggested.checkInDate || '',
    );
    const checkOutDate = this.pdfService.toIsoDate(
      contractData.checkOutDate || suggested.checkOutDate || '',
    );
    const nights = this.pdfService.calculateNights(checkInDate, checkOutDate);
    const totalAmount = this.pdfService.toNumber(
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
      issueDate: this.pdfService.toIsoDate(new Date()),
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
      guests: this.pdfService.toNumber(contractData.numeroPersonas || suggested.numeroPersonas || 1),
      nights,
      depositAmount,
      depositDate: this.pdfService.toIsoDate(new Date()),
      balanceAmount,
      balanceDate: checkInDate || '',
      rentAmount: this.pdfService.toNumber(contractData.subtotal || suggested.subtotal || totalAmount),
      cleaningFee: this.pdfService.toNumber(contractData.cleaningFee || suggested.cleaningFee || 0),
      refundableDeposit: this.pdfService.toNumber(
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
    const pdfBuffer = await this.pdfService.generateReservationConfirmationPdfBuffer(prepared);
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
    const pdfBuffer = await this.pdfService.generateReservationConfirmationPdfBuffer(prepared);
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

    const checkInDate = this.pdfService.toIsoDate(safePayload.checkInDate);
    const checkOutDate = this.pdfService.toIsoDate(safePayload.checkOutDate);
    const nights =
      this.pdfService.toNumber(safePayload.nights) ||
      this.pdfService.calculateNights(checkInDate, checkOutDate);

    const payloadTotal = this.pdfService.toNumber(safePayload.totalAmount);
    const rentAmount = this.pdfService.toNumber(safePayload.rentAmount);
    const cleaningFee = this.pdfService.toNumber(safePayload.cleaningFee);
    const refundableDeposit = this.pdfService.toNumber(safePayload.refundableDeposit);
    const computedTotal =
      payloadTotal || rentAmount + cleaningFee + refundableDeposit;

    const prepared: ReservationConfirmationData = {
      propertyId,
      contractNumber: String(safePayload.contractNumber || ''),
      clientName: String(safePayload.clientName || ''),
      clientId: String(safePayload.clientId || ''),
      clientEmail: String(safePayload.clientEmail || ''),
      issueDate: this.pdfService.toIsoDate(safePayload.issueDate || new Date()),
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
      guests: Math.max(1, this.pdfService.toNumber(safePayload.guests || 1)),
      nights: Math.max(1, nights),
      depositAmount: this.pdfService.toNumber(safePayload.depositAmount),
      depositDate: this.pdfService.toIsoDate(safePayload.depositDate || new Date()),
      balanceAmount: this.pdfService.toNumber(safePayload.balanceAmount),
      balanceDate: this.pdfService.toIsoDate(safePayload.balanceDate || checkInDate),
      rentAmount,
      cleaningFee,
      refundableDeposit,
      totalAmount: computedTotal,
      paymentMethod: this.pdfService.normalizePaymentMethod(safePayload.paymentMethod),
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
