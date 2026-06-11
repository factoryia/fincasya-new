import { IsString, IsOptional, IsArray, ValidateNested } from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class OwnerBankAccountDto {
  @IsString()
  id: string;

  @IsString()
  bankName: string;

  @IsString()
  accountNumber: string;

  @IsOptional()
  @IsString()
  accountType?: string;
}

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
  @ValidateNested({ each: true })
  @Type(() => OwnerBankAccountDto)
  @Transform(({ value }) => {
    if (!value) return undefined;
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : undefined;
      } catch {
        return undefined;
      }
    }
    return Array.isArray(value) ? value : undefined;
  })
  bankAccounts?: OwnerBankAccountDto[];

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
