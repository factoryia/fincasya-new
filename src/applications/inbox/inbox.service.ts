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
import { FincasService } from '../fincas/fincas.service';
import { mergeClientDataFromContractDetail } from '../bookings/resolve-contract-client-data';
import { computeConfirmationFinancials } from '../fincas/confirmation-financials';
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
    @Inject(forwardRef(() => FincasService))
    private readonly fincasService: FincasService,
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
    unreadOnly?: boolean;
    tagsAny?: string[];
    lastMessageFrom?: number;
    lastMessageTo?: number;
    channel?: 'whatsapp' | 'web';
    search?: string;
    limit?: number;
    cursor?: string;
  }) {
    return this.convexService.query('conversations:list', params);
  }

  async markInboxRead(conversationId: string) {
    return this.convexService.mutation('conversations:markInboxRead', {
      conversationId,
    });
  }

  async setConversationTags(conversationId: string, tags: string[]) {
    return this.convexService.mutation('conversations:setConversationTags', {
      conversationId,
      tags,
    });
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

  async getAiSettings() {
    return this.convexService.query('platformSettings:getAiSettings', {});
  }

  async setAiEnabled(aiEnabled: boolean) {
    return this.convexService.mutation('platformSettings:setAiEnabled', {
      aiEnabled,
    });
  }

  async setChannelAiEnabled(
    channel: 'whatsapp' | 'web',
    aiEnabled: boolean,
  ) {
    return this.convexService.mutation('platformSettings:setChannelAiEnabledPublic', {
      channel,
      aiEnabled,
    });
  }

  async setAssignedUser(conversationId: string, assignedUserId: string | null, actorUserId?: string) {
    return this.convexService.mutation('conversations:setAssignedUser', {
      conversationId,
      assignedUserId,
      actorUserId: actorUserId ?? undefined,
    });
  }

  async getAuditHistory(conversationId: string) {
    return this.convexService.query('conversationAudit:listByConversation', { conversationId });
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

  async getConversation(conversationId: string) {
    const conv = await this.convexService.query('conversations:getById', {
      conversationId,
    });
    if (!conv) throw new NotFoundException('Conversacion no encontrada');
    const contact = await this.convexService.query('contacts:getById', {
      contactId: (conv as { contactId: string }).contactId,
    });
    return {
      ...conv,
      contact: contact
        ? {
            name: (contact as { name?: string }).name ?? '',
            phone: (contact as { phone?: string }).phone ?? '',
          }
        : { name: '', phone: '' },
    };
  }

  async getMessages(
    conversationId: string,
    opts?: { limit?: number; beforeCreatedAt?: number; beforeCreationTime?: number },
  ) {
    return this.convexService.query('messages:listRecent', {
      conversationId,
      limit: opts?.limit,
      beforeCreatedAt: opts?.beforeCreatedAt,
      beforeCreationTime: opts?.beforeCreationTime,
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
      address?: string;
      fechaNacimiento?: string;
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
    const mediaType = (body.mediaType || (file ? 'audio' : 'text'));
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

  /** Plantillas de WhatsApp (Meta) que el asesor puede enviar manualmente. */
  async listManualTemplates() {
    return this.convexService.query('checkinMessaging:listManualTemplates', {});
  }

  /** Envía una plantilla de WhatsApp a la conversación abierta (envío manual). */
  async sendManualTemplate(
    conversationId: string,
    templateKey: string,
    bodyParams: string[],
    sentByUserId?: string,
  ) {
    return this.convexService.action('checkinMessaging:sendTemplateToConversation', {
      conversationId,
      templateKey,
      bodyParams,
      sentByUserId,
    });
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

  async setStatus(conversationId: string, status: 'ai' | 'human' | 'resolved', actorUserId?: string) {
    if (status === 'ai') {
      const conv = await this.convexService.query('conversations:getById', {
        conversationId,
      });
      if (!conv) {
        throw new NotFoundException('Conversacion no encontrada');
      }
      const channel = ((conv as { channel?: string }).channel ?? 'whatsapp') as
        | 'whatsapp'
        | 'web';
      const settings = await this.getAiSettings();
      const channelEnabled =
        channel === 'web'
          ? settings?.webAiEnabled === true
          : settings?.whatsappAiEnabled === true;
      if (!channelEnabled) {
        throw new BadRequestException(
          channel === 'web'
            ? 'La IA del chat web está desactivada. Actívala desde el panel de chats para usar el bot.'
            : 'La IA de WhatsApp está desactivada. Actívala desde el panel de chats para usar el bot.',
        );
      }
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
        actorUserId: actorUserId ?? undefined,
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
      sentByUserId?: string;
      replyToWamid?: string;
    },
  ) {
    const { type, text, mediaUrl, metadata, file, filename: requestedFilename, sentByUserId, replyToWamid } =
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
      channel: conv.channel === 'web' ? 'web' : 'whatsapp',
      type,
      text: text?.trim() || undefined,
      metadata,
      mediaUrl: finalMediaUrl,
      mediaUrlForStorage,
      filename,
      sentByUserId: sentByUserId || undefined,
      replyToWamid: replyToWamid?.trim() || undefined,
    });
    return result ?? { ok: true };
  }

  async deleteMessage(messageId: string) {
    return this.convexService.mutation('messages:softDelete', { messageId });
  }

  async editMessage(messageId: string, content: string) {
    return this.convexService.mutation('messages:editContent', {
      messageId,
      content,
    });
  }

  async forwardMessage(
    messageId: string,
    targetConversationId: string,
    sentByUserId?: string,
  ) {
    const msg = await this.convexService.query('messages:getById', { messageId });
    if (!msg || msg.deletedAt != null) {
      throw new NotFoundException('Mensaje no encontrado');
    }
    const type = (msg.type ?? 'text') as
      | 'text'
      | 'image'
      | 'audio'
      | 'video'
      | 'document'
      | 'product';
    const prefix =
      type === 'text'
        ? ''
        : type === 'image'
          ? '📷 '
          : type === 'audio'
            ? '🎤 '
            : type === 'video'
              ? '🎬 '
              : type === 'document'
                ? '📄 '
                : '🏡 ';
    const text =
      type === 'text'
        ? String(msg.content ?? '').trim()
        : [prefix + String(msg.content ?? '').trim(), msg.mediaUrl ? msg.mediaUrl : '']
            .filter(Boolean)
            .join('\n');
    if (!text) {
      throw new BadRequestException('No hay contenido para reenviar');
    }
    const forwardType =
      type === 'product'
        ? 'text'
        : type === 'video'
          ? 'document'
          : type;
    return this.sendMessage(targetConversationId, {
      type: forwardType,
      text,
      mediaUrl:
        forwardType !== 'text' ? msg.mediaUrl : undefined,
      sentByUserId,
    });
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

    // Mapear JSON en español de extractContractDataFromHistory → campos del formulario web
    const mapExtracted = (raw: any) => {
      if (!raw || typeof raw !== 'object') return;
      if (raw.nombre && !raw.clientName) raw.clientName = String(raw.nombre).trim();
      if (raw.cedula && !raw.clientId) raw.clientId = String(raw.cedula).trim();
      if (raw.email && !raw.clientEmail) raw.clientEmail = String(raw.email).trim();
      if (raw.telefono && !raw.clientPhone) raw.clientPhone = String(raw.telefono).trim();
      if (raw.direccion && !raw.clientAddress)
        raw.clientAddress = String(raw.direccion).trim();
      if (raw.ciudad_expedicion && !raw.clientCity)
        raw.clientCity = String(raw.ciudad_expedicion).trim();
      if (raw.personas != null && raw.guests == null) {
        const n = Number(raw.personas);
        if (Number.isFinite(n) && n >= 1) raw.guests = n;
      }
      if (raw.mascotas != null && raw.petCount == null) {
        const m = Number(raw.mascotas);
        if (Number.isFinite(m) && m >= 0) raw.petCount = m;
      }
      if (raw.tipoGrupo != null && !raw.groupType) {
        const tg = String(raw.tipoGrupo).trim().toUpperCase();
        if (['FAMILIAR', 'EVENTO', 'AMIGOS', 'EMPRESA'].includes(tg)) {
          raw.groupType = tg;
        } else {
          const t = String(raw.tipoGrupo)
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase();
          if (t.includes('familiar') || t.includes('familia')) raw.groupType = 'FAMILIAR';
          else if (t.includes('evento') || t.includes('fiesta')) raw.groupType = 'EVENTO';
          else if (t.includes('amigo')) raw.groupType = 'AMIGOS';
          else if (t.includes('empresa') || t.includes('corporat')) raw.groupType = 'EMPRESA';
        }
      }
      if (raw.propositoEstancia && !raw.purpose) {
        raw.purpose = String(raw.propositoEstancia).trim().slice(0, 280);
      }
      if (raw.precioPorNocheCop != null && raw.nightlyPrice == null) {
        const p = Math.round(Number(raw.precioPorNocheCop));
        if (Number.isFinite(p) && p > 0) raw.nightlyPrice = String(p);
      }
      if (raw.aseoFinalCop != null && raw.cleaningFee == null) {
        const a = Math.round(Number(raw.aseoFinalCop));
        if (Number.isFinite(a) && a >= 0) raw.cleaningFee = String(a);
      }
      if (raw.depositoGarantiaCop != null && raw.refundableDeposit == null) {
        const d = Math.round(Number(raw.depositoGarantiaCop));
        if (Number.isFinite(d) && d >= 0) raw.refundableDeposit = String(d);
      }
      if (raw.valorAbono != null && raw.depositAmount == null) {
        const a = Math.round(Number(raw.valorAbono));
        if (Number.isFinite(a) && a >= 0) raw.depositAmount = a;
      }
      if (raw.valorSaldo != null && raw.balanceAmount == null) {
        const s = Math.round(Number(raw.valorSaldo));
        if (Number.isFinite(s) && s >= 0) raw.balanceAmount = s;
      }
      if (raw.fechaAbono && !raw.depositDate) {
        raw.depositDate = this.pdfService.toIsoDate(raw.fechaAbono);
      }
      if (raw.fechaSaldo && !raw.balanceDate) {
        raw.balanceDate = this.pdfService.toIsoDate(raw.fechaSaldo);
      }
      if (raw.subtotalAlojamientoCop != null && raw.rentAmount == null) {
        const r = Math.round(Number(raw.subtotalAlojamientoCop));
        if (Number.isFinite(r) && r >= 0) raw.rentAmount = r;
      }
      if (raw.contrato && !raw.contractNumber) {
        raw.contractNumber = String(raw.contrato).trim();
      }
      if (raw.depositoMascotasCop != null && raw.petCount == null) {
        const m = Math.round(Number(raw.depositoMascotasCop));
        if (m === 100000) raw.petCount = 1;
      }
      if (
        raw.subtotalAlojamientoCop != null &&
        !raw.nightlyPrice &&
        raw.checkInDate &&
        raw.checkOutDate
      ) {
        const d1 = new Date(String(raw.checkInDate));
        const d2 = new Date(String(raw.checkOutDate));
        if (!Number.isNaN(d1.getTime()) && !Number.isNaN(d2.getTime())) {
          const n = Math.max(
            1,
            Math.ceil((d2.getTime() - d1.getTime()) / 86400000),
          );
          const sub = Math.round(Number(raw.subtotalAlojamientoCop));
          if (Number.isFinite(sub) && sub > 0 && n > 0) {
            raw.nightlyPrice = String(Math.round(sub / n));
          }
        }
      }
      if (raw.nochesMencionadas != null) {
        const nn = Math.round(Number(raw.nochesMencionadas));
        if (Number.isFinite(nn) && nn >= 1) {
          raw.quotedNights = nn;
        }
      }
      if (
        raw.nochesMencionadas != null &&
        raw.subtotalAlojamientoCop != null &&
        raw.nightlyPrice == null &&
        (!raw.checkInDate || !raw.checkOutDate)
      ) {
        const nn = Math.max(1, Math.round(Number(raw.nochesMencionadas)));
        const sub = Math.round(Number(raw.subtotalAlojamientoCop));
        if (Number.isFinite(nn) && Number.isFinite(sub) && sub > 0) {
          raw.nightlyPrice = String(Math.round(sub / nn));
        }
      }
    };
    mapExtracted(data);

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

    if (!data.propertyId && data.finca && typeof data.finca === 'string') {
      const resolved = await this.resolvePropertyIdFromFincaText(
        String(data.finca),
      );
      if (resolved) data.propertyId = resolved;
    }

    return data;
  }

  /** Busca id de propiedad por línea de catálogo / resumen (código MG#013 o búsqueda por texto). */
  private async resolvePropertyIdFromFincaText(
    fincaText: string,
  ): Promise<string | undefined> {
    const t = fincaText.trim();
    if (!t) return undefined;
    const codeMatch = t.match(/\b([A-Za-z]{2,}#[A-Za-z0-9]+)\b/);
    if (codeMatch) {
      const code = codeMatch[1].toUpperCase();
      const byCode = await this.convexService
        .query('fincas:getByCode', { code })
        .catch(() => null);
      if (byCode?._id) return byCode._id as string;
    }
    const results = (await this.convexService
      .query('fincas:search', { query: t.slice(0, 120), limit: 8 })
      .catch(() => [])) as { _id: string }[];
    return results?.[0]?._id;
  }

  async getSuggestedBookingData(conversationId: string) {
    // Reuse the enriched contract extraction logic for quick booking as well.
    return this.getSuggestedContractData(conversationId);
  }

  /**
   * Último PDF de contrato generado en el chat (mensaje assistant con metadata `generated_contract`).
   * Se usa para adjuntar el mismo archivo a la reserva (multimedia) al confirmar desde inbox.
   */
  private async getLatestGeneratedContractPdfFromConversation(
    conversationId: string,
  ): Promise<{ url: string; name: string } | null> {
    const messages = (await this.convexService
      .query('messages:listRecent', { conversationId, limit: 120 })
      .catch(() => [])) as any[];

    const latest = [...(messages || [])]
      .reverse()
      .find(
        (msg: any) =>
          msg?.sender === 'assistant' &&
          msg?.type === 'document' &&
          msg?.metadata?.kind === 'generated_contract',
      );

    const url = String(latest?.mediaUrl || '').trim();
    if (!url) return null;

    const contractData = latest?.metadata?.contractData || {};
    const name =
      String(contractData.generatedFileName || '').trim() || 'Contrato_reserva.pdf';

    return { url, name };
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
      !(suggestedRaw).error
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
      guests: this.pdfService.toNumber(
        contractData.guests ||
          contractData.numeroPersonas ||
          suggested.guests ||
          suggested.personas ||
          suggested.numeroPersonas ||
          1,
      ),
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
      groupType: String(suggested.groupType || contractData.groupType || '').trim(),
      purpose: String(
        suggested.purpose ||
          contractData.purpose ||
          suggested.propositoEstancia ||
          '',
      ).trim(),
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
    const persistConfirmation = Boolean(payload?.persistConfirmation);
    const prepared = await this.prepareReservationConfirmationData(
      conversationId,
      payload,
    );
    const generated =
      await this.fincasService.generateReservationConfirmationBuffer(prepared);

    if (persistConfirmation && prepared.contractNumber?.trim()) {
      try {
        const file: Express.Multer.File = {
          fieldname: 'file',
          originalname: generated.filename,
          encoding: '7bit',
          mimetype: generated.mimeType,
          buffer: generated.buffer,
          size: generated.buffer.byteLength,
          stream: null as any,
          destination: '',
          filename: '',
          path: '',
        };
        const s3Url = await this.s3Service.uploadFile(
          file,
          'confirmations',
          generated.filename,
        );
        await this.convexService.mutation('contracts:upsert', {
          contractNumber: prepared.contractNumber.trim(),
          propertyId: prepared.propertyId as any,
          propertyTitle: prepared.propertyName,
          propertyLocation: prepared.propertyLocation,
          clienteNombre: prepared.clientName,
          clienteCedula: prepared.clientId,
          clienteEmail: prepared.clientEmail,
          clienteTelefono: prepared.clientPhone,
          valorTotal: prepared.totalAmount || undefined,
          fechaEntrada: prepared.checkInDate,
          fechaSalida: prepared.checkOutDate,
          confirmationPdfUrl: s3Url,
          confirmationPdfFilename: generated.filename,
          estado: prepared.paymentStatus === 'paid' ? 'pagado' : 'generado',
          origen: 'confirmacion',
        });
      } catch (persistErr) {
        console.warn(
          '[inbox] Confirmación generada pero no se pudo guardar en S3/gestor:',
          persistErr instanceof Error ? persistErr.message : String(persistErr),
        );
      }
    }

    return {
      success: true,
      buffer: generated.buffer,
      filename: generated.filename,
      mimeType: generated.mimeType,
      message: 'Previsualizacion generada correctamente',
    };
  }

  async sendReservationConfirmation(conversationId: string, payload: any) {
    const prepared = await this.prepareReservationConfirmationData(
      conversationId,
      payload,
    );

    const propertyId = (prepared.propertyId || '').trim();
    if (!propertyId) {
      throw new BadRequestException(
        'Se requiere la propiedad (propertyId) para crear la reserva en el calendario.',
      );
    }
    if (!(prepared.clientPhone || '').trim()) {
      throw new BadRequestException(
        'Se requiere el teléfono del cliente para crear la reserva.',
      );
    }

    const fechaEntrada = this.isoYmdToBogotaMidnightUtcMs(prepared.checkInDate);
    const fechaSalida = this.isoYmdToBogotaMidnightUtcMs(prepared.checkOutDate);
    if (!Number.isFinite(fechaEntrada) || !Number.isFinite(fechaSalida)) {
      throw new BadRequestException(
        'Las fechas de entrada o salida no son válidas (use formato YYYY-MM-DD).',
      );
    }

    const rawContract = (prepared.contractNumber || '').trim();
    const weakContract =
      rawContract.length < 4 ||
      (rawContract.length < 10 && !/\d/.test(rawContract));

    const contractDoc =
      await this.getLatestGeneratedContractPdfFromConversation(conversationId);
    const multimediaForBooking: { url: string; name: string; type: string }[] = [];
    if (contractDoc?.url) {
      multimediaForBooking.push({
        url: contractDoc.url,
        name: contractDoc.name,
        type: 'application/pdf',
      });
    }

    const observaciones = [
      'Reserva creada al enviar confirmación desde inbox.',
      contractDoc?.url
        ? 'Auditoría: contrato del chat enlazado en multimedia de la reserva.'
        : 'Auditoría: no se detectó PDF de contrato en mensajes recientes.',
      `Conversación: ${conversationId}`,
    ].join(' ');

    const groupType = String(prepared.groupType || '').trim() || undefined;
    const purpose = String(prepared.purpose || '').trim() || undefined;

    const bookingPayload = {
      propertyId,
      nombreCompleto: prepared.clientName.trim(),
      cedula: (prepared.clientId || '').trim() || 'SIN-DOC',
      celular: prepared.clientPhone.trim(),
      correo:
        (prepared.clientEmail || '').trim() ||
        `sin-correo-${Date.now()}@reserva-inbox.fincasya.local`,
      fechaEntrada,
      fechaSalida,
      numeroPersonas: prepared.guests,
      precioTotal: prepared.totalAmount,
      subtotal: prepared.rentAmount,
      temporada: 'ESTANDAR',
      horaEntrada: prepared.checkInTime,
      horaSalida: prepared.checkOutTime,
      city: '',
      address: prepared.clientAddress || '',
      isDirect: false,
      reference: weakContract ? undefined : rawContract.replace(/\s+/g, ''),
      observaciones,
      status: prepared.paymentStatus === 'paid' ? 'PAID' : 'CONFIRMED',
      skipAutoContract: true,
      multimediaLinks:
        multimediaForBooking.length > 0 ? multimediaForBooking : undefined,
      groupType,
      purpose,
    };

    let bookingId =
      await this.findExistingInboxBookingForConversation(
        conversationId,
        propertyId,
        fechaEntrada,
        fechaSalida,
      );
    let createdInThisRequest = false;

    if (!bookingId) {
      const availability = await this.bookingsSyncService.checkAvailability(
        propertyId,
        fechaEntrada,
        fechaSalida,
      );
      if (!availability.available) {
        throw new BadRequestException(
          this.formatAvailabilityError(
            availability.conflictingBookings,
            prepared.checkInDate,
            prepared.checkOutDate,
          ),
        );
      }

      try {
        const result = await this.bookingsSyncService.createBooking(
          bookingPayload,
          undefined,
        );
        bookingId = String(result.bookingId);
        createdInThisRequest = true;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new BadRequestException(
          `No se pudo crear la reserva en el calendario: ${msg}`,
        );
      }
    }

    if (weakContract && bookingId) {
      const suffix = bookingId.replace(/[^a-zA-Z0-9]/g, '').slice(-10).toUpperCase();
      prepared.contractNumber = `FY-${suffix}`;
    }

    const safeContract = (prepared.contractNumber || String(Date.now())).replace(
      /[^a-zA-Z0-9_-]/g,
      '',
    );

    let generatedFile: Express.Multer.File;
    let outputFilename = `Confirmacion_Reserva_${safeContract}.pdf`;
    try {
      const generated =
        await this.fincasService.generateReservationConfirmationBuffer(prepared);
      outputFilename = generated.filename;
      generatedFile = {
        fieldname: 'file',
        originalname: outputFilename,
        encoding: '7bit',
        mimetype: generated.mimeType,
        buffer: generated.buffer,
        size: generated.buffer.byteLength,
        stream: null as any,
        destination: '',
        filename: '',
        path: '',
      };

      await this.sendMessage(conversationId, {
        type: 'document',
        text: `Hola ${prepared.clientName}, aqui tienes tu confirmacion de reserva No. ${prepared.contractNumber}.`,
        file: generatedFile,
        filename: outputFilename,
        metadata: {
          kind: 'reservation_confirmation',
          reservationConfirmationData: prepared,
          bookingId,
        },
      });
    } catch (postCreateErr) {
      if (createdInThisRequest && bookingId) {
        try {
          await this.convexService.mutation('bookings:cancel', {
            id: bookingId as any,
            reason:
              'Cancelada: falló envío de confirmación desde inbox (reintente).',
          });
        } catch (rollbackErr) {
          console.error(
            '[inbox] No se pudo revertir reserva tras error de confirmación:',
            rollbackErr instanceof Error
              ? rollbackErr.message
              : String(rollbackErr),
          );
        }
      }
      throw postCreateErr;
    }

    try {
      const confirmationUrl = await this.s3Service.uploadFile(
        generatedFile,
        'bookings/multimedia',
      );
      await this.convexService.mutation('bookings:appendMultimedia', {
        bookingId: bookingId as any,
        file: {
          url: confirmationUrl,
          name: outputFilename,
          type: generatedFile.mimetype,
          size: generatedFile.size,
          uploadedAt: Date.now(),
        },
      });
    } catch (attachErr) {
      console.error(
        '[inbox] No se pudo adjuntar PDF de confirmación a la reserva:',
        attachErr instanceof Error ? attachErr.message : String(attachErr),
      );
    }

    return {
      success: true,
      filename: outputFilename,
      bookingId,
      message: bookingId && !createdInThisRequest
        ? 'Confirmacion reenviada (la reserva ya existia en el calendario)'
        : 'Confirmacion de reserva enviada correctamente',
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
    calendarLabel?: string;
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

    const precioContrato = this.pdfService.toNumber(
      safePayload.precioTotal ?? safePayload.rentAmount,
    );
    let damageDeposit = this.pdfService.toNumber(
      safePayload.damageDeposit ?? safePayload.refundableDeposit,
    );
    if (damageDeposit <= 0 && property?.depositoDanosReembolsable != null) {
      damageDeposit = this.pdfService.toNumber(property.depositoDanosReembolsable);
    }
    const petCount = this.pdfService.toNumber(
      safePayload.petCount ?? safePayload.numeroMascotas,
    );
    const depositoMascotas = this.pdfService.toNumber(safePayload.depositoMascotas);
    const petSurcharge = this.pdfService.toNumber(
      safePayload.costoMascotas ?? safePayload.petSurcharge,
    );

    const financials = computeConfirmationFinancials({
      precioTotal: precioContrato,
      subtotal: this.pdfService.toNumber(safePayload.subtotal),
      petSurcharge: petSurcharge > 0 ? petSurcharge : undefined,
      cleaningFee: 0,
      damageDeposit,
      petCount,
      depositoMascotas: depositoMascotas > 0 ? depositoMascotas : undefined,
    });

    const computedTotal = financials.totalAmount;

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
      rentAmount: financials.rentAmount,
      cleaningFee: financials.cleaningFee,
      petCleaningFee: financials.petCleaningFee,
      refundableDeposit: financials.refundableDeposit,
      totalAmount: computedTotal,
      paymentMethod: this.pdfService.normalizePaymentMethod(safePayload.paymentMethod),
      paymentStatus:
        safePayload.paymentStatus === 'paid' ? 'paid' : 'pending',
    };
    const g = String(safePayload.groupType || '').trim();
    const p = String(safePayload.purpose || '').trim();
    if (g) prepared.groupType = g;
    if (p) prepared.purpose = p;

    const contractNumber = prepared.contractNumber.trim();
    if (contractNumber) {
      try {
        const detail = await this.convexService.query('contracts:getDetail', {
          contractNumber,
        });
        const merged = mergeClientDataFromContractDetail(
          {
            nombreCompleto: prepared.clientName,
            cedula: prepared.clientId,
            correo: prepared.clientEmail,
            celular: prepared.clientPhone,
            address: prepared.clientAddress,
          },
          detail as any,
        );
        if (merged.nombreCompleto) {
          prepared.clientName = String(merged.nombreCompleto);
        }
        if (merged.cedula) prepared.clientId = String(merged.cedula);
        if (merged.correo) prepared.clientEmail = String(merged.correo);
        if (merged.celular) prepared.clientPhone = String(merged.celular);
        if (merged.address) prepared.clientAddress = String(merged.address);
      } catch {
        // Sin gestor de contratos: se usa el payload del admin.
      }
    }

    if (!prepared.clientName || !prepared.checkInDate || !prepared.checkOutDate) {
      throw new BadRequestException(
        'Faltan datos obligatorios para generar la confirmacion de reserva',
      );
    }

    // Saldo = resto del contrato (abono es 50% del total del contrato).
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

  /** Reserva previa del mismo envío desde inbox (reintento tras fallo de PDF/WhatsApp). */
  private async findExistingInboxBookingForConversation(
    conversationId: string,
    propertyId: string,
    fechaEntrada: number,
    fechaSalida: number,
  ): Promise<string | null> {
    const marker = `Conversación: ${conversationId}`;
    const result = await this.convexService.query('bookings:list', {
      propertyId: propertyId as any,
      limit: 200,
    });
    const bookings = (result as { bookings?: Array<Record<string, unknown>> })
      ?.bookings;
    if (!Array.isArray(bookings)) return null;

    for (const b of bookings) {
      if (b.status === 'CANCELLED') continue;
      const obs = String(b.observaciones || '');
      if (!obs.includes(marker)) continue;
      if (b.fechaEntrada === fechaEntrada && b.fechaSalida === fechaSalida) {
        return String(b._id);
      }
    }
    return null;
  }

  private formatAvailabilityError(
    conflicts: Array<{
      nombreCompleto?: string;
      fechaEntrada?: number;
      fechaSalida?: number;
      status?: string;
    }> | undefined,
    checkInDate: string,
    checkOutDate: string,
  ): string {
    const base =
      'La propiedad no está disponible para las fechas seleccionadas';
    if (!conflicts?.length) {
      return `${base} (${checkInDate} → ${checkOutDate}).`;
    }
    const details = conflicts
      .map((c) => {
        const inDate = c.fechaEntrada
          ? this.pdfService.toIsoDate(String(c.fechaEntrada)) ||
            new Date(c.fechaEntrada).toISOString().slice(0, 10)
          : '?';
        const outDate = c.fechaSalida
          ? this.pdfService.toIsoDate(String(c.fechaSalida)) ||
            new Date(c.fechaSalida).toISOString().slice(0, 10)
          : '?';
        return `${c.nombreCompleto || 'Reserva'} (${inDate} → ${outDate}, ${c.status || 'activa'})`;
      })
      .join('; ');
    return `${base} (${checkInDate} → ${checkOutDate}). Conflicto con: ${details}.`;
  }

  /**
   * Inicio del día civil en America/Bogotá (UTC-5 sin DST) como ms UTC,
   * alineado con `bookings` / `assertBookingDatesAreFuture` (calendarDateColombia).
   */
  private isoYmdToBogotaMidnightUtcMs(ymd: string): number {
    const iso = this.pdfService.toIsoDate(ymd);
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return NaN;
    const [y, m, d] = iso.split('-').map(Number);
    return Date.UTC(y, m - 1, d, 5, 0, 0, 0);
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

  /**
   * Envía al cliente el link de autorrelleno de contrato por WhatsApp.
   * El asesor llama a este método desde el panel.
   */
  async sendContractFillLink(
    conversationId: string,
    opts?: {
      propertyTitle?: string;
      propertyLocation?: string;
      fechaEntrada?: string;
      fechaSalida?: string;
      cupo?: number;
      precioTotal?: number;
      sentByUserId?: string;
    },
  ): Promise<{ ok: boolean; token: string; link: string }> {
    const conv = await this.convexService.query('conversations:getById', { conversationId });
    if (!conv) throw new NotFoundException('Conversacion no encontrada');
    const contact = await this.convexService.query('contacts:getById', {
      contactId: (conv as { contactId: string }).contactId,
    });
    if (!contact) throw new NotFoundException('Contacto no encontrado');

    const phone = this.normalizePhoneE164((contact as { phone: string }).phone);
    const channel =
      (conv as { channel?: string }).channel === 'web' ? 'web' : 'whatsapp';

    const prepared = (await this.convexService.action(
      'contractFillTokensAction:prepareContractFillLink',
      { conversationId, ...opts },
    )) as { ok: boolean; token: string; link: string };

    const text = [
      '✨ Para agilizar tu reserva, te compartimos el siguiente link para ingresar tus datos personales:',
      '',
      `👉 ${prepared.link}`,
      '',
      'Es un link único y seguro (expira en 48 horas). Apenas lo completes, tu asesor continuará el proceso contigo 🤝',
    ].join('\n');

    await this.convexService.action('inbox:sendMessage', {
      conversationId,
      phone,
      channel,
      type: 'text',
      text,
      sentByUserId: opts?.sentByUserId,
    });

    return prepared;
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
