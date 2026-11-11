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

export const SUBJECT_STATUSES = ['active', 'inactive'] as const;

export type SubjectStatus = (typeof SUBJECT_STATUSES)[number];

export class UpdateSubjectDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  /** UUID de membresía docente, o null para desasignar al docente. */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  teacherMembershipId?: string | null;

  /** Carga horaria semanal de la materia. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(80)
  weeklyHours?: number;

  /** Descripción libre de la materia; null explícito la borra. */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @IsOptional()
  @IsIn(SUBJECT_STATUSES)
  status?: SubjectStatus;
}
