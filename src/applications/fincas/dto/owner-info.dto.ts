import { IsString, IsOptional, IsArray } from 'class-validator';
import { Transform } from 'class-transformer';

export type OwnerBankAccountInput = {
  id: string;
  bankName: string;
  accountNumber: string;
  accountType?: string;
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
  propietarioTelefono?: string;

  @IsOptional()
  @IsString()
  propietarioCedula?: string;

  @IsOptional()
  @IsString()
  propietarioCorreo?: string;
}
