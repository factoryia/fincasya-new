import { IsString, IsOptional, IsNotEmpty } from 'class-validator';

export class UpdateOwnerInfoDto {
  @IsNotEmpty()
  @IsString()
  ownerUserId: string;

  @IsNotEmpty()
  @IsString()
  rutNumber: string;

  @IsNotEmpty()
  @IsString()
  bankName: string;

  @IsNotEmpty()
  @IsString()
  accountNumber: string;

  @IsNotEmpty()
  @IsString()
  rntNumber: string;

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
}
