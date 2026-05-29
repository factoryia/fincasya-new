import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export const HABEAS_REQUEST_TYPES = [
  'acceso',
  'rectificacion',
  'cancelacion',
  'oposicion',
  'revocatoria',
  'queja',
] as const;

export type HabeasRequestType = (typeof HABEAS_REQUEST_TYPES)[number];

export class CreateHabeasDataDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  fullName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  documentType!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  documentNumber!: string;

  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @IsString()
  @IsIn(HABEAS_REQUEST_TYPES as unknown as string[])
  requestType!: HabeasRequestType;

  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  description!: string;
}
