import {
  IsDateString,
  IsEmail,
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
  /** Nombre completo del docente (actualiza profiles.full_name). */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  fullName?: string;

  /** Email de acceso (actualiza auth.users). */
  @IsOptional()
  @IsEmail()
  @MaxLength(120)
  email?: string;

  /** Teléfono del docente (actualiza profiles.phone). */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

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
