import { IsString, IsOptional, IsArray } from 'class-validator';
import { Transform } from 'class-transformer';

export type OwnerBankAccountInput = {
  id: string;
  bankName: string;
  accountNumber: string;
  accountType?: string;
  accountHolderName?: string;
};

export class UpdateOwnerInfoDto {
  @IsOptional()
  @IsString()
  ownerUserId?: string;

  @IsOptional()
  @IsString()
  rutNumber?: string;

  @IsOptional()
  @IsString()
  bankName?: string;

  @IsOptional()
  @IsString()
  accountNumber?: string;

  @IsOptional()
  @IsArray()
  @Transform(({ value }) => {
    if (!value) return undefined;
    const raw =
      typeof value === 'string'
        ? (() => {
            try {
              return JSON.parse(value);
            } catch {
              return undefined;
            }
          })()
        : value;
    if (!Array.isArray(raw)) return undefined;
    return raw
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const row = item as Record<string, unknown>;
        return {
          id: String(row.id ?? row.Id ?? '').trim(),
          bankName: String(row.bankName ?? row.BankName ?? '').trim(),
          accountNumber: String(
            row.accountNumber ?? row.AccountNumber ?? '',
          ).trim(),
          accountType: String(
            row.accountType ?? row.AccountType ?? '',
          ).trim(),
          accountHolderName: String(
            row.accountHolderName ??
              row.AccountHolderName ??
              row.ownerName ??
              row.OwnerName ??
              '',
          ).trim(),
        };
      })
      .filter(Boolean);
  })
  bankAccounts?: OwnerBankAccountInput[];

  @IsOptional()
  @IsString()
  rntNumber?: string;

  @IsOptional()
  @IsString()
  bankCertificationUrl?: string;

  @IsOptional()
  @IsString()
  idCopyUrl?: string;

  @IsOptional()
  @IsString()
  rntPdfUrl?: string;

  @IsOptional()
  @IsString()
  chamberOfCommerceUrl?: string;

  @IsOptional()
  @IsString()
  propietarioNombre?: string;

  @IsOptional()
  @IsString()
  propietarioTratamiento?: string;

  @IsOptional()
  @IsString()
  propietarioTelefono?: string;

  @IsOptional()
  @IsString()
  propietarioCedula?: string;

  @IsOptional()
  @IsString()
  propietarioCorreo?: string;

  @IsOptional()
  @IsString()
  checkinUbicacionUrl?: string;

  @IsOptional()
  @IsString()
  checkinIndicacionesLlegada?: string;

  @IsOptional()
  @IsString()
  checkinUbicacionImageUrl?: string;

  /**
   * Orden final de las imágenes de referencia. Cada token es una URL existente
   * que se conserva, o el literal "__new__" que indica "tomar el siguiente
   * archivo subido en checkinUbicacionImages". Llega como JSON string.
   */
  @IsOptional()
  @IsArray()
  @Transform(({ value }) => {
    if (value === undefined || value === null) return undefined;
    const raw =
      typeof value === 'string'
        ? (() => {
            try {
              return JSON.parse(value);
            } catch {
              return undefined;
            }
          })()
        : value;
    if (!Array.isArray(raw)) return undefined;
    return raw.map((item) => String(item ?? '')).filter((s) => s.length > 0);
  })
  checkinUbicacionImageOrder?: string[];
}
