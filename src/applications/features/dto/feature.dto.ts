import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class CreateFeatureDto {
  @IsString()
  @IsNotEmpty()
  name: string;
}

export class UpdateFeatureDto {
  @IsString()
  @IsOptional()
  name?: string;
}
