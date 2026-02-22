import { PartialType } from '@nestjs/mapped-types';
import { CreateFincaDto } from './create-finca.dto';
import { IsOptional, IsString, IsNumber, IsEnum, Min } from 'class-validator';

export class UpdateFincaDto extends PartialType(CreateFincaDto) {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  capacity?: number;

  @IsOptional()
  @IsNumber()
  lat?: number;

  @IsOptional()
  @IsNumber()
  lng?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  priceBase?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  priceBaja?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  priceMedia?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  priceAlta?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  priceEspeciales?: number;

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  video?: string;
}
