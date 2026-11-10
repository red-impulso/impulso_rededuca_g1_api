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
import {
  STUDENT_GENDERS,
  STUDENT_STATUSES,
  type StudentGender,
  type StudentStatus,
} from './create-student.dto.js';

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
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  dni?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  fileNumber?: string;

  /** Cambia al alumno de curso dentro de la misma institución. */
  @IsOptional()
  @IsUUID()
  courseId?: string;

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
  @IsIn(STUDENT_STATUSES)
  status?: StudentStatus;

  @IsOptional()
  @IsDateString()
  enrollmentDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  observationAcademic?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  observationInstitutional?: string;
}
