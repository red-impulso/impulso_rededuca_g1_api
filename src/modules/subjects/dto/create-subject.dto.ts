import {
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

export class CreateSubjectDto {
  @IsUUID()
  courseId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsUUID()
  teacherMembershipId?: string;

  /** Carga horaria semanal de la materia. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(80)
  weeklyHours?: number;

  /** Descripción libre de la materia; null la deja vacía. */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(2000)
  description?: string | null;
}
