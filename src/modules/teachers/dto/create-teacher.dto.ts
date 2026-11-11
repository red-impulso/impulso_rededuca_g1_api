import {
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  EMPLOYMENT_STATUSES,
  TEACHER_STATUSES,
  type EmploymentStatus,
  type TeacherStatus,
} from './update-teacher.dto.js';

export class CreateTeacherDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  fullName: string;

  @IsEmail()
  @MaxLength(120)
  email: string;

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
