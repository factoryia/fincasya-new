import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class UpdateSaleLinkDto {
  @IsString()
  @IsOptional()
  propertyId?: string;

  @IsNumber()
  @IsOptional()
  checkIn?: number;

  @IsNumber()
  @IsOptional()
  checkOut?: number;

  @IsNumber()
  @IsOptional()
  @Min(1)
  nights?: number;

  @IsNumber()
  @IsOptional()
  @Min(1)
  guests?: number;

  @IsString()
  @IsOptional()
  checkInTime?: string;

  @IsString()
  @IsOptional()
  checkOutTime?: string;

  @IsNumber()
  @IsOptional()
  @Min(0)
  totalValue?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  rentalValue?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  depositAmount?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  cleaningFee?: number;

  @IsNumber()
  @IsOptional()
  petDeposit?: number;

  @IsNumber()
  @IsOptional()
  petSurcharge?: number;

  @IsNumber()
  @IsOptional()
  petCount?: number;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  selectedBankAccountIds?: string[];

  @IsString()
  @IsOptional()
  notes?: string;

  @IsString()
  @IsOptional()
  status?: 'active' | 'completed' | 'cancelled';

  @IsNumber()
  @IsOptional()
  @Min(0)
  ownerOfferAmount?: number;

  @IsBoolean()
  @IsOptional()
  markOwnerOfferSent?: boolean;
}
