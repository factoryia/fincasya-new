import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CompleteContractLinkDto {
  @IsString()
  @IsNotEmpty()
  nombre: string;

  @IsString()
  @IsNotEmpty()
  cedula: string;

  @IsString()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  telefono: string;

  @IsString()
  @IsNotEmpty()
  direccion: string;

  @IsString()
  @IsOptional()
  ciudad?: string;

  @IsOptional()
  cedulaPhotoUrls?: string[];
}
