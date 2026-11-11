import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  COURSE_SHIFTS,
  COURSE_STATUSES,
  type CourseShift,
  type CourseStatus,
} from './create-course.dto.js';

export class UpdateCourseDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  year?: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  division?: string;

  @IsOptional()
  @IsIn(COURSE_SHIFTS)
  shift?: CourseShift;

  @IsOptional()
  @IsInt()
  @Min(1900)
  @Max(2100)
  schoolYear?: number;

  /** Aula física del curso; null explícito la borra. */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(60)
  classroom?: string | null;

  @IsOptional()
  @IsIn(COURSE_STATUSES)
  status?: CourseStatus;

  /** Membresía docente preceptora; null explícito la desasigna. */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  homeroomTeacherMembershipId?: string | null;
}
