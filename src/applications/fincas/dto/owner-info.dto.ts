import { IsString, IsOptional } from 'class-validator';

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
