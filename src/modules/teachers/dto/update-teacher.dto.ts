import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const EMPLOYMENT_STATUSES = [
  'titular',
  'interino',
  'suplente',
] as const;

export type EmploymentStatus = (typeof EMPLOYMENT_STATUSES)[number];

export const TEACHER_STATUSES = ['activo', 'licencia', 'inactivo'] as const;

export type TeacherStatus = (typeof TEACHER_STATUSES)[number];

export class UpdateTeacherDto {
  /** Legajo interno del docente (ej. 'L-1042'). */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  fileNumber?: string;

  @IsOptional()
  @IsIn(EMPLOYMENT_STATUSES)
  employmentStatus?: EmploymentStatus;

  @IsOptional()
  @IsIn(TEACHER_STATUSES)
  status?: TeacherStatus;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(80)
  maxWeeklyHours?: number;

  /** Fecha de alta del docente (YYYY-MM-DD). */
  @IsOptional()
  @IsDateString()
  hiredAt?: string;
}
