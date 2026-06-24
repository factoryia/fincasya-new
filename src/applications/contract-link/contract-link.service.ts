import {
  BadRequestException,
  ConflictException,
  GoneException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Response } from 'express';
import { ConvexSiteProxyService } from '../shared/services/convex-site-proxy.service';
import { S3Service } from '../shared/services/s3.service';
import { FincasService } from '../fincas/fincas.service';
import { GenerateContractDto } from '../fincas/dto/generate-contract.dto';
import type { CompleteContractLinkDto } from './dto/complete-contract-link.dto';

const CONVEX_SITE_URL_DEFAULT =
  'https://adventurous-octopus-651.convex.site';

type ContractLinkRow = {
  status?: string;
  source?: string;
  contractDraftJson?: string | null;
  contractSettingsJson?: string | null;
  propertyMetaJson?: string | null;
};

type ContractDraft = {
  propertyId: string;
  contractNumber?: string;
  nightlyPrice?: string | number;
  checkInDate?: string;
  checkOutDate?: string;
  checkInTime?: string;
  checkOutTime?: string;
  guests?: string | number;
  petCount?: string | number;
  petDeposit?: string | number;
  petSurcharge?: string | number;
  serviceStaffIncluded?: boolean;
  serviceStaffFee?: string | number;
  bankName?: string;
  accountNumber?: string;
  accountHolder?: string;
  idNumber?: string;
  cleaningFee?: string | number;
  refundableDeposit?: string | number;
  contractTotal?: number;
};

type ContractSettingsSnapshot = {
  adminSettings?: {
    cleaningFee?: string;
    securityDeposit?: string;
    extraPersonFee?: string;
    petDeposit?: string;
  };
};

type PropertyMeta = {
  ownerDisplayName?: string;
  contractOwnerOverride?: {
    nombreCompleto?: string;
  };
};

@Injectable()
export class ContractLinkService {
  constructor(
    private readonly convexProxy: ConvexSiteProxyService,
    private readonly fincasService: FincasService,
    private readonly s3Service: S3Service,
  ) {}

  async uploadCedulaPhotos(
    token: string,
    files: Express.Multer.File[],
  ): Promise<{ urls: string[] }> {
    if (!token || token.length < 8) {
      throw new BadRequestException('Token inválido');
    }
    if (!files?.length) {
      throw new BadRequestException('Adjunta al menos una foto de la cédula');
    }
    if (files.length > 2) {
      throw new BadRequestException('Máximo 2 fotos de cédula');
    }

    const row = await this.fetchContractLinkRow(token);
    if (row.status === 'filled') {
      throw new ConflictException('already_filled');
    }
    if (row.status === 'expired') {
      throw new GoneException('expired');
    }

    const urls: string[] = [];
    for (const file of files) {
      if (!file.mimetype?.startsWith('image/')) {
        throw new BadRequestException('Solo se permiten imágenes');
      }
      if (file.size > 8 * 1024 * 1024) {
        throw new BadRequestException('Cada imagen debe pesar menos de 8 MB');
      }
      const ext = file.originalname?.split('.').pop() || 'jpg';
      const safeName = `cedula_${Date.now()}_${urls.length + 1}.${ext}`;
      const url = await this.s3Service.uploadFile(
        file,
        `contracts/cedula/${token}`,
        safeName,
      );
      urls.push(url);
    }

    return { urls };
  }

  /**
   * Completa el link de contrato: valida token, genera PDF y registra datos en Convex.
   * En producción fincasya.com reenvía `/api/*` a Nest; este handler replica la route de Next.
   */
  async completeContractLink(
    token: string,
    body: CompleteContractLinkDto,
    res: Response,
  ): Promise<void> {
    if (!token || token.length < 8) {
      throw new BadRequestException('Token inválido');
    }

    const frontendUrl = (
      process.env.FRONTEND_INTERNAL_URL || 'http://127.0.0.1:3000'
    ).replace(/\/$/, '');

    try {
      const fwd = await fetch(
        `${frontendUrl}/api/contract-link/${encodeURIComponent(token)}/complete`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );

      if (fwd.status !== 404) {
        await this.pipeFetchResponse(fwd, res);
        return;
      }
    } catch (err) {
      console.warn(
        '[contract-link] proxy a frontend falló, usando generación inline:',
        err,
      );
    }

    const row = await this.fetchContractLinkRow(token);
    this.assertRowCanComplete(row);

    const draft = JSON.parse(row.contractDraftJson!) as ContractDraft;
    const settings = JSON.parse(
      row.contractSettingsJson || '{}',
    ) as ContractSettingsSnapshot;
    const propertyMeta = JSON.parse(
      row.propertyMetaJson || '{}',
    ) as PropertyMeta;

    const dto = this.buildGenerateContractDto(
      draft,
      settings,
      propertyMeta,
      body,
    );

    const result: any = await this.fincasService.generateContract(
      draft.propertyId,
      dto,
      { previewOnly: true },
    );

    await this.submitFillToConvex(token, body);

    const filename =
      result?.filename ||
      `Contrato_${draft.contractNumber || 'link'}.pdf`;
    const buffer: Buffer = result?.buffer;
    if (!buffer?.length) {
      throw new BadRequestException('No se pudo generar el PDF del contrato');
    }

    res.status(200);
    res.setHeader('Content-Type', result?.mimeType || 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`,
    );
    res.setHeader('Cache-Control', 'no-store');
    res.send(buffer);
  }

  private async fetchContractLinkRow(token: string): Promise<ContractLinkRow> {
    try {
      return (await this.convexProxy.forwardJson(
        'GET',
        `/api/admin/contract-link/${encodeURIComponent(token)}`,
      )) as ContractLinkRow;
    } catch (err) {
      if (err instanceof HttpException) {
        const status = err.getStatus();
        const payload = err.getResponse();
        if (status === 404) {
          throw new NotFoundException(
            typeof payload === 'object' &&
              payload &&
              'error' in payload
              ? (payload as { error: string }).error
              : 'Link no encontrado',
          );
        }
        if (status === 410) {
          throw new GoneException('expired');
        }
      }
      throw err;
    }
  }

  private assertRowCanComplete(row: ContractLinkRow): void {
    if (row.status === 'filled') {
      throw new ConflictException('already_filled');
    }
    if (row.source !== 'admin' || !row.contractDraftJson) {
      throw new BadRequestException(
        'Este link no admite descarga de contrato',
      );
    }
  }

  private buildGenerateContractDto(
    draft: ContractDraft,
    settings: ContractSettingsSnapshot,
    propertyMeta: PropertyMeta,
    client: CompleteContractLinkDto,
  ): GenerateContractDto {
    const dto = new GenerateContractDto();
    dto.propertyId = draft.propertyId;
    dto.contractNumber = draft.contractNumber;
    dto.nightlyPrice = String(draft.nightlyPrice ?? '');
    dto.totalPrice = String(draft.contractTotal ?? '');
    dto.conversationId = 'contract-link';
    dto.clientName = client.nombre;
    dto.clientId = client.cedula;
    dto.clientEmail = client.email;
    dto.clientPhone = client.telefono;
    dto.clientCity = client.ciudad ?? '';
    dto.clientAddress = client.direccion;
    dto.checkInDate = draft.checkInDate;
    dto.checkOutDate = draft.checkOutDate;
    dto.checkInTime = draft.checkInTime;
    dto.checkOutTime = draft.checkOutTime;
    dto.guests = Number(draft.guests || 1);
    dto.petCount = Number(draft.petCount || 0);
    dto.petDeposit = Number(draft.petDeposit || 0);
    dto.petSurcharge = Number(draft.petSurcharge || 0);
    dto.serviceStaffFee = draft.serviceStaffIncluded
      ? Number(draft.serviceStaffFee || 0)
      : 0;
    dto.bankName = draft.bankName;
    dto.accountNumber = draft.accountNumber;
    dto.accountHolder = draft.accountHolder;
    dto.idNumber = draft.idNumber;
    dto.cleaningFee = Number(draft.cleaningFee || 0);
    dto.refundableDeposit = Number(draft.refundableDeposit || 0);
    dto.propertyOwnerName =
      propertyMeta.contractOwnerOverride?.nombreCompleto?.trim() ||
      propertyMeta.ownerDisplayName?.trim() ||
      undefined;
    dto.cleaningFeeLabel = settings.adminSettings?.cleaningFee;
    dto.securityDepositLabel = settings.adminSettings?.securityDeposit;
    dto.extraPersonFeeLabel = settings.adminSettings?.extraPersonFee;
    dto.petDepositLabel = settings.adminSettings?.petDeposit;
    // Firmante elegido en el admin (override del global) que viaja en el draft.
    const d = draft as Record<string, unknown>;
    if (typeof d.adminName === 'string' && d.adminName.trim())
      dto.adminName = d.adminName.trim();
    if (typeof d.adminCedula === 'string' && d.adminCedula.trim())
      dto.adminCedula = d.adminCedula.trim();
    if (typeof d.adminCity === 'string' && d.adminCity.trim())
      dto.adminCity = d.adminCity.trim();
    if (typeof d.firmaArrendadorUrl === 'string' && d.firmaArrendadorUrl.trim())
      dto.firmaArrendadorUrl = d.firmaArrendadorUrl.trim();
    // Vista previa del contrato (cláusulas + firmante + firma) guardada al crear
    // el link. Se usa como customHtml para generar el MISMO contrato completo que
    // en "Confirmación"; los placeholders del cliente se rellenan en el servicio.
    if (typeof d.previewHtml === 'string' && d.previewHtml.trim())
      dto.customHtml = d.previewHtml;
    return dto;
  }

  private async submitFillToConvex(
    token: string,
    body: CompleteContractLinkDto,
  ): Promise<void> {
    const baseUrl = (
      process.env.CONVEX_SITE_URL || CONVEX_SITE_URL_DEFAULT
    ).replace(/\/$/, '');

    const fillRes = await fetch(`${baseUrl}/api/contract-fill/${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombre: body.nombre,
        cedula: body.cedula,
        email: body.email,
        telefono: body.telefono,
        direccion: body.direccion,
        ciudad: body.ciudad,
        cedulaPhotoUrls: body.cedulaPhotoUrls,
      }),
    });

    if (fillRes.status === 409) {
      throw new ConflictException('already_filled');
    }
    if (fillRes.status === 410) {
      throw new GoneException('expired');
    }
    if (!fillRes.ok) {
      const errJson = (await fillRes.json().catch(() => ({}))) as {
        error?: string;
      };
      throw new BadRequestException(
        errJson.error ?? 'No se pudieron guardar los datos',
      );
    }
  }

  private async pipeFetchResponse(
    fwd: globalThis.Response,
    res: Response,
  ): Promise<void> {
    res.status(fwd.status);
    fwd.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      if (lower === 'transfer-encoding' || lower === 'connection') return;
      res.setHeader(key, value);
    });
    const buf = Buffer.from(await fwd.arrayBuffer());
    res.send(buf);
  }
}
