import { IsString, IsOptional, IsArray, IsBoolean, IsNotEmpty } from 'class-validator';

export class GlobalPricingRuleDto {
  @IsString()
  @IsNotEmpty()
  nombre: string;

  /** Format: MM-DD */
  @IsOptional()
  @IsString()
  fechaDesde?: string;

  @IsOptional()
  @IsString()
  fechaHasta?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  fechas?: string[];

  @IsOptional()
  @IsBoolean()
  activa?: boolean;
}

export class UpdateGlobalPricingRuleDto {
  @IsOptional()
  @IsString()
  nombre?: string;

  /** Format: MM-DD */
  @IsOptional()
  @IsString()
  fechaDesde?: string;

  @IsOptional()
  @IsString()
  fechaHasta?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  fechas?: string[];

  @IsOptional()
  @IsBoolean()
  activa?: boolean;
}
