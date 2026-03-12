import {
  IsString,
  IsNumber,
  IsOptional,
  Min,
  Max,
  IsBoolean,
} from 'class-validator';

export class CreateReviewDto {
  @IsString()
  propertyId: string;

  @IsOptional()
  @IsString()
  bookingId?: string;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsNumber()
  @Min(1)
  @Max(5)
  rating: number;

  @IsOptional()
  @IsString()
  comment?: string;

  @IsOptional()
  @IsBoolean()
  verified?: boolean;
}
