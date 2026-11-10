import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class UpdateSubjectDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  /** UUID de membresía docente, o null para desasignar al docente. */
  @IsOptional()
  @ValidateIf((o) => o.teacherMembershipId !== null)
  @IsUUID()
  teacherMembershipId?: string | null;
}
