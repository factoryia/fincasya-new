import { Type } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

export class UploadPaymentProofDto {
  @IsOptional()
  @IsString()
  fileName?: string;

  @IsOptional()
  @IsString()
  mimeType?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  fileBase64?: string;

  @IsString()
  @MinLength(1)
  nombre!: string;

  @IsString()
  @MinLength(1)
  cedula!: string;

  @IsString()
  @MinLength(1)
  email!: string;

  @IsString()
  @MinLength(1)
  telefono!: string;

  @IsString()
  @MinLength(1)
  direccion!: string;

  @IsOptional()
  @IsString()
  ciudad?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  paymentAmount?: number;

  @IsOptional()
  @IsString()
  cedulaPhotoFileName?: string;

  @IsOptional()
  @IsString()
  cedulaPhotoMimeType?: string;

  @IsOptional()
  @IsString()
  cedulaPhotoBase64?: string;
}
