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

export const COURSE_SHIFTS = ['morning', 'afternoon', 'evening'] as const;

export type CourseShift = (typeof COURSE_SHIFTS)[number];

export const COURSE_STATUSES = ['active', 'inactive', 'draft'] as const;

export type CourseStatus = (typeof COURSE_STATUSES)[number];

export class CreateCourseDto {
  @IsInt()
  @Min(1)
  @Max(12)
  year: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  division: string;

  @IsIn(COURSE_SHIFTS)
  shift: CourseShift;

  @IsInt()
  @Min(1900)
  @Max(2100)
  schoolYear: number;

  /** Aula física del curso; null la deja sin asignar. */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(60)
  classroom?: string | null;

  @IsOptional()
  @IsIn(COURSE_STATUSES)
  status?: CourseStatus;

  /** Membresía docente preceptora del curso; null la deja sin asignar. */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  homeroomTeacherMembershipId?: string | null;
}
