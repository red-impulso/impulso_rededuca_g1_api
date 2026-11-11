import {
  IsDateString,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import {
  STUDENT_GENDERS,
  STUDENT_STATUSES,
  type StudentGender,
  type StudentStatus,
} from './create-student.dto.js';

/** Permite null explícito para borrar el campo opcional en la base. */
const nullable = () => ValidateIf((_o, v) => v !== null && v !== undefined);

export class UpdateStudentDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  firstName?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  lastName?: string;

  @IsOptional()
  @nullable()
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  dni?: string | null;

  @IsOptional()
  @nullable()
  @IsString()
  @MaxLength(40)
  fileNumber?: string | null;

  /** Cambia al alumno de curso dentro de la misma institución. */
  @IsOptional()
  @IsUUID()
  courseId?: string;

  @IsOptional()
  @nullable()
  @IsDateString()
  birthDate?: string | null;

  @IsOptional()
  @nullable()
  @IsIn(STUDENT_GENDERS)
  gender?: StudentGender | null;

  @IsOptional()
  @nullable()
  @IsString()
  @MaxLength(200)
  address?: string | null;

  @IsOptional()
  @nullable()
  @IsString()
  @MaxLength(40)
  phone?: string | null;

  @IsOptional()
  @nullable()
  @IsEmail()
  @MaxLength(120)
  email?: string | null;

  @IsOptional()
  @IsIn(STUDENT_STATUSES)
  status?: StudentStatus;

  @IsOptional()
  @nullable()
  @IsDateString()
  enrollmentDate?: string | null;

  @IsOptional()
  @nullable()
  @IsString()
  @MaxLength(2000)
  observationAcademic?: string | null;

  @IsOptional()
  @nullable()
  @IsString()
  @MaxLength(2000)
  observationInstitutional?: string | null;
}
