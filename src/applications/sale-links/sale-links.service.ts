import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Readable } from 'stream';
import { ConvexSiteProxyService } from '../shared/services/convex-site-proxy.service';
import { ConvexService } from '../shared/services/convex.service';
import { S3Service } from '../shared/services/s3.service';
import { BrevoEmailService } from '../shared/services/brevo-email.service';
import { FincasService } from '../fincas/fincas.service';
import { computeConfirmationFinancials } from '../fincas/confirmation-financials';
import {
  PdfService,
  ReservationConfirmationData,
} from '../shared/services/pdf.service';
import type { CreateSaleLinkDto } from './dto/create-sale-link.dto';
import type { UpdateSaleLinkDto } from './dto/update-sale-link.dto';

const FRONTEND_BASE =
  (process.env.NEXT_PUBLIC_APP_URL || process.env.FRONTEND_INTERNAL_URL || 'https://fincasya.com').replace(/\/$/, '');

const DEFAULT_PAYMENT_ALERT_EMAIL = 'comercial@fincasya.com';

function resolveSaleLinkPaymentAlertEmail(): string {
  const override = process.env.SALE_LINK_PAYMENT_ALERT_EMAIL?.trim();
  if (override) return override;
  return DEFAULT_PAYMENT_ALERT_EMAIL;
}

/** Formatea un número como COP (sin decimales) */
function formatCOP(amount: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

/** Formatea una fecha Unix ms a "dd/mm/yyyy" */
function formatDate(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

@Injectable()
export class SaleLinksService {
  constructor(
    private readonly convexProxy: ConvexSiteProxyService,
    private readonly convexService: ConvexService,
    private readonly s3Service: S3Service,
    private readonly brevoEmail: BrevoEmailService,
    private readonly fincasService: FincasService,
    private readonly pdfService: PdfService,
  ) {}

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  async create(dto: CreateSaleLinkDto, userId: string, userName?: string) {
    const result = await this.convexProxy.forwardJson('POST', '/api/admin/sale-link', {
      ...dto,
      createdBy: userId,
      createdByName: userName,
    });
    return result;
  }

  async list(filters?: { createdBy?: string; status?: string }) {
    const params = new URLSearchParams();
    if (filters?.createdBy) params.set('createdBy', filters.createdBy);
    if (filters?.status) params.set('status', filters.status);
    const query = params.toString() ? `?${params.toString()}` : '';
    const result = await this.convexProxy.forwardJson('GET', `/api/admin/sale-links${query}`);
    return result;
  }

  async getByToken(token: string) {
    const result = await this.convexProxy.forwardJson('GET', `/api/admin/sale-link/${encodeURIComponent(token)}`);
    return result;
  }

  async update(id: string, dto: UpdateSaleLinkDto) {
    const result = await this.convexProxy.forwardJson('PATCH', `/api/admin/sale-link/${encodeURIComponent(id)}`, dto);
    return result;
  }

  async remove(id: string) {
    const result = await this.convexProxy.forwardJson('DELETE', `/api/admin/sale-link/${encodeURIComponent(id)}`);
    return result;
  }

  // ---------------------------------------------------------------------------
  // Subida de comprobante de pago (cliente)
  // ---------------------------------------------------------------------------

  async uploadPaymentProof(
    token: string,
    file: Express.Multer.File,
    clientData: {
      nombre: string;
      cedula: string;
      email: string;
      telefono: string;
      direccion: string;
      ciudad?: string;
      paymentAmount?: number;
    },
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Debes adjuntar un comprobante');
    }

    const ext = file.originalname?.split('.').pop()?.toLowerCase() ?? '';
    const mime = String(file.mimetype ?? '').toLowerCase();
    const isImage = mime.startsWith('image/');
    const isPdf = mime === 'application/pdf' || ext === 'pdf';
    const imageExts = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif']);
    const allowedByExt = imageExts.has(ext) || ext === 'pdf';

    if (!isImage && !isPdf && !allowedByExt) {
      throw new BadRequestException('Solo se permiten imágenes o PDF');
    }
    if (file.size > 10 * 1024 * 1024) {
      throw new BadRequestException('El archivo debe pesar menos de 10 MB');
    }
    const safeName = `pago_${Date.now()}.${ext || 'jpg'}`;
    const proofUrl = await this.s3Service.uploadFile(
      file,
      `sale-links/${token}`,
      safeName,
    );

    // 2. Generar clave de validación de un solo uso
    const validationKey = Array.from(
      { length: 32 },
      () => Math.floor(Math.random() * 16).toString(16),
    ).join('');

    // 3. Guardar en Convex
    const mutResult = await this.convexService.mutation('saleLinks:submitClientData', {
      token,
      nombre: clientData.nombre,
      cedula: clientData.cedula,
      email: clientData.email,
      telefono: clientData.telefono,
      direccion: clientData.direccion,
      ciudad: clientData.ciudad,
      paymentProofUrl: proofUrl,
      paymentProofFileName: file.originalname,
      paymentProofMimeType: file.mimetype,
      paymentProofAmount: clientData.paymentAmount,
      paymentValidationKey: validationKey,
    }) as { ok?: boolean; reason?: string };

    if (!mutResult?.ok) {
      throw new BadRequestException(mutResult?.reason ?? 'Error al guardar datos del cliente');
    }

    // 4. Obtener datos del link para el email
    const linkData = (await this.convexProxy.forwardJson('GET', `/api/admin/sale-link/${encodeURIComponent(token)}`)) as {
      ok: boolean;
      row: {
        propertyId?: string;
        totalValue?: number;
        checkIn?: number;
        checkOut?: number;
        nights?: number;
      };
    };

    // 5. Enviar email al admin (local → pruebas; producción → Hernán)
    const adminEmail = resolveSaleLinkPaymentAlertEmail();
    const validateUrl = `${FRONTEND_BASE}/admin/ventas/validar/${encodeURIComponent(token)}?key=${validationKey}`;
    const proofViewUrl = `${FRONTEND_BASE}/venta/comprobante/${encodeURIComponent(token)}?key=${validationKey}`;

    try {
      await this.brevoEmail.sendSaleLinkPaymentAlert({
        adminEmail,
        clientName: clientData.nombre,
        clientEmail: clientData.email,
        clientPhone: clientData.telefono,
        totalValue: linkData.row?.totalValue ?? 0,
        checkIn: linkData.row?.checkIn ?? 0,
        checkOut: linkData.row?.checkOut ?? 0,
        nights: linkData.row?.nights ?? 0,
        paymentProofUrl: proofUrl,
        proofViewUrl,
        validateUrl,
        token,
      });
    } catch (e) {
      console.error('[sale-links] Error enviando email al admin:', e);
    }

    return { ok: true, proofUrl };
  }

  // ---------------------------------------------------------------------------
  // Subida de contrato firmado (cliente)
  // ---------------------------------------------------------------------------

  async uploadSignedContract(token: string, file: Express.Multer.File) {
    if (file.size > 20 * 1024 * 1024) {
      throw new BadRequestException('El archivo debe pesar menos de 20 MB');
    }
    const ext = file.originalname?.split('.').pop() ?? 'pdf';
    const safeName = `contrato_firmado_${Date.now()}.${ext}`;
    const signedUrl = await this.s3Service.uploadFile(
      file,
      `sale-links/${token}/signed`,
      safeName,
    );

    const mutResult = await this.convexService.mutation('saleLinks:submitSignedContract', {
      token,
      signedContractUrl: signedUrl,
      signedContractFileName: file.originalname,
    }) as { ok?: boolean; reason?: string };

    if (!mutResult?.ok) {
      throw new BadRequestException(mutResult?.reason ?? 'Error al guardar el contrato firmado');
    }

    try {
      await this.generateCr(token);
    } catch (err) {
      console.error(
        '[sale-links] No se pudo generar la CR tras subir contrato firmado:',
        err,
      );
    }

    return { ok: true, signedUrl };
  }

  // ---------------------------------------------------------------------------
  // Generación de contrato (admin/sistema)
  // ---------------------------------------------------------------------------

  async generateContract(token: string) {
    const linkResp = (await this.convexProxy.forwardJson('GET', `/api/admin/sale-link/${encodeURIComponent(token)}`)) as {
      ok: boolean;
      row: Record<string, unknown>;
    };

    if (!linkResp?.ok || !linkResp.row) {
      throw new NotFoundException('Link de venta no encontrado');
    }

    const row = linkResp.row as {
      _id: string;
      propertyId: string;
      clientData?: {
        nombre: string;
        cedula: string;
        email: string;
        telefono: string;
        direccion: string;
        ciudad?: string;
      };
      checkIn: number;
      checkOut: number;
      nights: number;
      guests: number;
      checkInTime?: string;
      checkOutTime?: string;
      totalValue: number;
      rentalValue: number;
      depositAmount: number;
      cleaningFee: number;
      petDeposit?: number;
      petSurcharge?: number;
      petCount?: number;
    };

    if (!row.clientData) {
      throw new BadRequestException('El cliente aún no ha enviado sus datos');
    }

    const { GenerateContractDto } = await import('../fincas/dto/generate-contract.dto');
    const dto = new GenerateContractDto();
    dto.propertyId = row.propertyId;
    dto.nightlyPrice = String(Math.round(row.rentalValue / (row.nights || 1)));
    dto.totalPrice = String(row.totalValue);
    dto.conversationId = 'sale-link';
    dto.clientName = row.clientData.nombre;
    dto.clientId = row.clientData.cedula;
    dto.clientEmail = row.clientData.email;
    dto.clientPhone = row.clientData.telefono;
    dto.clientAddress = row.clientData.direccion;
    dto.clientCity = row.clientData.ciudad ?? '';
    dto.checkInDate = new Date(row.checkIn).toISOString().split('T')[0];
    dto.checkOutDate = new Date(row.checkOut).toISOString().split('T')[0];
    dto.checkInTime = row.checkInTime;
    dto.checkOutTime = row.checkOutTime;
    dto.guests = row.guests;
    dto.petCount = row.petCount ?? 0;
    dto.petDeposit = row.petDeposit ?? 0;
    dto.petSurcharge = row.petSurcharge ?? 0;
    dto.cleaningFee = row.cleaningFee;
    dto.refundableDeposit = row.depositAmount;
    dto.contractNumber = `VL-${token.slice(0, 8).toUpperCase()}`;

    const result = await this.fincasService.generateContract(row.propertyId, dto, {});

    const generated = result as {
      url?: string;
      buffer?: Buffer;
      filename?: string;
      mimeType?: string;
    };

    let contractUrl = generated.url?.trim();

    if (!contractUrl) {
      const contractBuffer = generated.buffer;
      const contractFilename =
        generated.filename ?? `Contrato_${token.slice(0, 8)}.pdf`;
      const mimeType = generated.mimeType ?? 'application/pdf';

      if (!contractBuffer?.length) {
        throw new BadRequestException('No se pudo generar el contrato PDF');
      }

      const fakeFile: Express.Multer.File = {
        fieldname: 'file',
        originalname: contractFilename,
        encoding: '7bit',
        mimetype: mimeType,
        buffer: contractBuffer,
        size: contractBuffer.length,
        stream: Readable.from(contractBuffer),
        destination: '',
        filename: contractFilename,
        path: '',
      };

      contractUrl = await this.s3Service.uploadFile(
        fakeFile,
        `sale-links/${token}/contract`,
        contractFilename,
      );
    }

    // Guardar en Convex
    await this.convexProxy.forwardJson(
      'PATCH',
      `/api/admin/sale-link/${encodeURIComponent(row._id)}/set-contract-url`,
      { contractUrl },
    );

    return { ok: true, contractUrl };
  }

  // ---------------------------------------------------------------------------
  // Generación de confirmación de reserva (CR)
  // ---------------------------------------------------------------------------

  async generateCr(token: string) {
    const linkResp = (await this.convexProxy.forwardJson(
      'GET',
      `/api/admin/sale-link/${encodeURIComponent(token)}`,
    )) as {
      ok: boolean;
      row: Record<string, unknown>;
    };

    if (!linkResp?.ok || !linkResp.row) {
      throw new NotFoundException('Link de venta no encontrado');
    }

    const row = linkResp.row as {
      _id: string;
      propertyId: string;
      crUrl?: string;
      clientData?: {
        nombre: string;
        cedula: string;
        email: string;
        telefono: string;
        direccion: string;
        ciudad?: string;
      };
      checkIn: number;
      checkOut: number;
      nights: number;
      guests: number;
      checkInTime?: string;
      checkOutTime?: string;
      totalValue: number;
      rentalValue: number;
      depositAmount: number;
      cleaningFee: number;
      petDeposit?: number;
      petSurcharge?: number;
      petCount?: number;
      paymentValidated?: boolean;
    };

    if (row.crUrl?.trim()) {
      return { ok: true, crUrl: row.crUrl, alreadyExists: true };
    }

    if (!row.clientData) {
      throw new BadRequestException('El cliente aún no ha enviado sus datos');
    }

    // La CR (Confirmación de Reserva) solo se genera con el pago YA validado.
    if (!row.paymentValidated) {
      return { ok: false as const, reason: 'payment_not_validated' as const };
    }

    const property = (await this.convexService
      .query('fincas:getById', { id: row.propertyId })
      .catch(() => null)) as { title?: string; location?: string } | null;

    const checkInDate = new Date(row.checkIn).toISOString().split('T')[0];
    const checkOutDate = new Date(row.checkOut).toISOString().split('T')[0];
    const contractNumber = `VL-${token.slice(0, 8).toUpperCase()}`;

    const financials = computeConfirmationFinancials({
      precioTotal: row.totalValue,
      subtotal: row.rentalValue,
      petSurcharge: row.petSurcharge,
      cleaningFee: row.cleaningFee ?? 0,
      damageDeposit: row.depositAmount,
      petCount: row.petCount,
      depositoMascotas: row.petDeposit,
    });

    const depositAmount = Math.round(row.totalValue * 0.5);
    const balanceAmount = Math.max(row.totalValue - depositAmount, 0);

    const prepared: ReservationConfirmationData = {
      propertyId: row.propertyId,
      contractNumber,
      clientName: row.clientData.nombre,
      clientId: row.clientData.cedula,
      clientEmail: row.clientData.email,
      issueDate: this.pdfService.toIsoDate(new Date()),
      clientPhone: row.clientData.telefono,
      clientAddress: row.clientData.direccion,
      propertyName: property?.title ?? '',
      propertyLocation: property?.location ?? '',
      checkInDate,
      checkOutDate,
      checkInTime: row.checkInTime ?? '10:00',
      checkOutTime: row.checkOutTime ?? '16:00',
      guests: row.guests,
      nights: row.nights,
      depositAmount,
      depositDate: this.pdfService.toIsoDate(new Date()),
      balanceAmount,
      balanceDate: checkInDate,
      rentAmount: financials.rentAmount,
      cleaningFee: financials.cleaningFee,
      petCleaningFee: financials.petCleaningFee,
      refundableDeposit: financials.refundableDeposit,
      totalAmount: financials.totalAmount,
      paymentMethod: 'bancolombia',
      paymentStatus: row.paymentValidated ? 'paid' : 'pending',
    };

    const { buffer, filename, mimeType } =
      await this.fincasService.generateReservationConfirmationBuffer(prepared);

    if (!buffer?.length) {
      throw new BadRequestException('No se pudo generar la confirmación de reserva');
    }

    const crFilename = filename ?? `CR_${contractNumber}.pdf`;
    const fakeFile: Express.Multer.File = {
      fieldname: 'file',
      originalname: crFilename,
      encoding: '7bit',
      mimetype: mimeType ?? 'application/pdf',
      buffer,
      size: buffer.length,
      stream: Readable.from(buffer),
      destination: '',
      filename: crFilename,
      path: '',
    };

    const crUrl = await this.s3Service.uploadFile(
      fakeFile,
      `sale-links/${token}/cr`,
      crFilename,
    );

    await this.convexProxy.forwardJson(
      'PATCH',
      `/api/admin/sale-link/${encodeURIComponent(row._id)}/set-cr-url`,
      { crUrl },
    );

    return { ok: true, crUrl };
  }

  // ---------------------------------------------------------------------------
  // Validar pago (admin desde el correo)
  // ---------------------------------------------------------------------------

  async validatePayment(token: string, validationKey: string, validatedBy = 'admin') {
    const result = (await this.convexProxy.forwardJson(
      'POST',
      `/api/admin/sale-link/${encodeURIComponent(token)}/validate-payment`,
      { validationKey, validatedBy },
    )) as { ok?: boolean; alreadyValidated?: boolean };

    if (result?.ok) {
      try {
        await this.generateContract(token);
      } catch (err) {
        console.error(
          '[sale-links] No se pudo generar el contrato tras validar pago:',
          err,
        );
      }
      // Con el pago ya validado, se genera la Confirmación de Reserva (CR).
      try {
        await this.generateCr(token);
      } catch (err) {
        console.error(
          '[sale-links] No se pudo generar la CR tras validar pago:',
          err,
        );
      }
    }

    return result;
  }
}
