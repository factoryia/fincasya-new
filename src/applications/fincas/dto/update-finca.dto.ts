import { OmitType, PartialType } from '@nestjs/mapped-types';
import { IsInt, IsOptional, Min, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';
import { CreateFincaDto } from './create-finca.dto';

const toNumber = (v: unknown) =>
  v === '' || v === undefined || v === null ? undefined : Number(v);

/**
 * `IntersectionType` no expone bien la metadata de class-validator en una sola
 * clase, y con `forbidNonWhitelisted` el body multipart con `eventCapacity` daba 400.
 *
 * Se omite `eventCapacity` del Partial base y se vuelve a declarar aquí (misma
 * lógica que `CreateFincaDto`) para que el whitelist lo reconozca.
 */
export class UpdateFincaDto extends PartialType(
  OmitType(CreateFincaDto, ['eventCapacity'] as const),
) {
  @IsOptional()
  @Transform(({ value }) => {
    const n = toNumber(value);
    if (n === undefined || !Number.isFinite(n) || n < 1) return undefined;
    return Math.floor(n);
  })
  @ValidateIf((_, v) => v !== undefined && v !== null)
  @IsInt()
  @Min(1)
  eventCapacity?: number;
}
