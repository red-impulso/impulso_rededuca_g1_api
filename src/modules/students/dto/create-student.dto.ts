import {
  IsDateString,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export const STUDENT_GENDERS = ['Femenino', 'Masculino', 'Otro'] as const;

export type StudentGender = (typeof STUDENT_GENDERS)[number];

export const STUDENT_STATUSES = ['active', 'inactive', 'draft'] as const;

export type StudentStatus = (typeof STUDENT_STATUSES)[number];

/** Un alumno nuevo nace activo o como borrador; nunca inactivo. */
export const CREATABLE_STATUSES = ['active', 'draft'] as const;

export type CreatableStudentStatus = (typeof CREATABLE_STATUSES)[number];

export class CreateStudentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  firstName: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  lastName: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  dni?: string;

  /** Legajo interno del alumno. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  fileNumber?: string;

  @IsUUID()
  courseId: string;

  @IsOptional()
  @IsDateString()
  birthDate?: string;

  @IsOptional()
  @IsIn(STUDENT_GENDERS)
  gender?: StudentGender;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(120)
  email?: string;

  @IsOptional()
  @IsIn(CREATABLE_STATUSES)
  status?: CreatableStudentStatus;

  @IsOptional()
  @IsDateString()
  enrollmentDate?: string;
}
