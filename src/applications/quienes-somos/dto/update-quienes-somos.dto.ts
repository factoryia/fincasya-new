import { IsString, IsArray, IsOptional, ValidateNested, IsObject } from 'class-validator';
import { Type } from 'class-transformer';

class StatDto {
  @IsString()
  label: string;

  @IsString()
  value: string;
}

export class UpdateQuienesSomosDto {
  @IsOptional()
  @IsString()
  queEsFincasYa?: string;

  @IsOptional()
  @IsString()
  mision?: string;

  @IsOptional()
  @IsString()
  vision?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  objetivos?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  politicas?: string[];

  @IsOptional()
  @IsString()
  trayectoriaTitle?: string;

  @IsOptional()
  @IsString()
  trayectoriaParagraphs?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StatDto)
  stats?: StatDto[];

  @IsOptional()
  @IsString()
  recognitionTitle?: string;

  @IsOptional()
  @IsString()
  recognitionSubtitle?: string;

  @IsOptional()
  @IsString()
  presenciaInstitucional?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  carouselImages?: string[];

  @IsOptional()
  @IsString()
  videoUrl?: string;

  @IsOptional()
  @IsString()
  videoTitle?: string;

  @IsOptional()
  @IsString()
  videoDescription?: string;

  @IsOptional()
  @IsString()
  videoBadge?: string;
}
