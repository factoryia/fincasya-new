import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class GenerateContractDto {
  @IsString()
  @IsOptional()
  bankName: string;

  @IsString()
  @IsOptional()
  accountNumber: string;

  @IsString()
  @IsOptional()
  accountHolder: string;

  @IsString()
  @IsOptional()
  idNumber: string;

  @IsString()
  @IsNotEmpty()
  contractNumber: string;

  @IsString()
  @IsOptional()
  conversationId: string;

  @IsString()
  @IsNotEmpty()
  nightlyPrice: string;

  /** Identificador de la finca a la cual pertenece la plantilla */
  @IsString()
  @IsNotEmpty()
  propertyId: string;

  @IsString()
  @IsOptional()
  clientName?: string;

  @IsString()
  @IsOptional()
  clientId?: string;

  @IsString()
  @IsOptional()
  clientEmail?: string;

  @IsString()
  @IsOptional()
  clientPhone?: string;

  @IsString()
  @IsOptional()
  checkInDate?: string;

  @IsString()
  @IsOptional()
  checkOutDate?: string;

  @IsString()
  @IsOptional()
  checkInTime?: string;

  @IsString()
  @IsOptional()
  checkOutTime?: string;

  @IsString()
  @IsOptional()
  clientCity?: string;

  @IsString()
  @IsOptional()
  clientAddress?: string;

  /** Imagen de la firma del cliente en base64 */
  @IsString()
  @IsOptional()
  signature?: string;

  @IsOptional()
  petCount?: number;

  @IsOptional()
  serviceStaffFee?: number;

  @IsOptional()
  petDeposit?: number;

  @IsOptional()
  petSurcharge?: number;

  @IsOptional()
  @IsString()
  totalPrice?: string;

  @IsOptional()
  @IsString()
  bookingId?: string;
}
