import { PartialType } from '@nestjs/mapped-types';
import { CreateFincaDto } from './create-finca.dto';
import {
  IsOptional,
  IsString,
  IsNumber,
  IsEnum,
  IsBoolean,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';

const toNumber = (v: unknown) =>
  v === '' || v === undefined || v === null ? undefined : Number(v);

export class UpdateFincaDto extends PartialType(CreateFincaDto) {}
