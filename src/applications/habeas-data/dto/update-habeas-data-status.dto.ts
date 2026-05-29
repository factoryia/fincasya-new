import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export const HABEAS_STATUSES = [
  'pending',
  'in_review',
  'resolved',
  'rejected',
] as const;

export type HabeasStatus = (typeof HABEAS_STATUSES)[number];

export class UpdateHabeasDataStatusDto {
  @IsString()
  @IsIn(HABEAS_STATUSES as unknown as string[])
  status!: HabeasStatus;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  internalNotes?: string;
}
