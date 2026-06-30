import {
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateSaleLinkDto {
  @IsString()
  @IsNotEmpty()
  propertyId: string;

  @IsString()
  @IsNotEmpty()
  contractCode: string;

  @IsNumber()
  checkIn: number;

  @IsNumber()
  checkOut: number;

  @IsNumber()
  @Min(1)
  nights: number;

  @IsNumber()
  @Min(1)
  guests: number;

  @IsString()
  @IsOptional()
  checkInTime?: string;

  @IsString()
  @IsOptional()
  checkOutTime?: string;

  @IsNumber()
  @Min(0)
  totalValue: number;

  @IsNumber()
  @Min(0)
  rentalValue: number;

  @IsNumber()
  @Min(0)
  depositAmount: number;

  @IsNumber()
  @Min(0)
  cleaningFee: number;

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
  selectedBankAccountIds: string[];

  @IsString()
  @IsOptional()
  notes?: string;
}
