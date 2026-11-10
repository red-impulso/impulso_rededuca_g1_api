import { IsDefined, IsUUID, ValidateIf } from 'class-validator';

export class AssignTeacherDto {
  /** UUID de membresía docente, o null para desasignar al docente. */
  @IsDefined()
  @ValidateIf((o) => o.teacherMembershipId !== null)
  @IsUUID()
  teacherMembershipId: string | null;
}
