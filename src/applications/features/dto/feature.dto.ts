import {
  IsString,
  IsNotEmpty,
  IsOptional,
  ValidateNested,
  ArrayNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateFeatureDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  emoji?: string;

  @IsOptional()
  icon?: any;
}

export class UpdateFeatureDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  emoji?: string;

  @IsOptional()
  icon?: any;
}

export class BulkCreateFeaturesDto {
  @ValidateNested({ each: true })
  @Type(() => CreateFeatureDto)
  @ArrayNotEmpty()
  features: CreateFeatureDto[];
}
