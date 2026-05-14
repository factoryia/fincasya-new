import { Transform } from 'class-transformer';
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

  /** Si viene vacío, el servicio asigna uno automático (reserva directa / preview). */
  @IsOptional()
  @IsString()
  @Transform(({ value }) => {
    if (value === null || value === undefined) return undefined;
    const s = String(value).trim();
    return s.length > 0 ? s : undefined;
  })
  contractNumber?: string;

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

  /**
   * HTML pre-renderizado en el frontend (preview rico con cláusulas, cuentas,
   * propietario, etc.). Si la finca no tiene `contractTemplateUrl`, este HTML
   * se usa tal cual para generar el PDF. Si la finca tiene plantilla propia,
   * se ignora y se respeta la plantilla. Limitado a ~400KB para evitar abuso.
   */
  @IsOptional()
  @IsString()
  customHtml?: string;
}
