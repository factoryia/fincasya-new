import {
  IsOptional,
  IsNumber,
  IsString,
  IsEnum,
  Min,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PropertyType, PropertyCategory } from './create-finca.dto';

export class ListFincasDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsEnum(PropertyType)
  type?: PropertyType;

  @IsOptional()
  @IsEnum(PropertyCategory)
  category?: PropertyCategory;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  minCapacity?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxPrice?: number;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isFavorite?: boolean;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  all?: boolean;

  @IsOptional()
  @IsString()
  search?: string;
}
