import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDefined,
  IsUUID,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class CourseAssignmentItem {
  @IsUUID()
  subjectId: string;

  /** UUID de membresía docente, o null para desasignar la materia. */
  @IsDefined()
  @ValidateIf((o) => o.teacherMembershipId !== null)
  @IsUUID()
  teacherMembershipId: string | null;
}

export class UpdateCourseAssignmentsDto {
  @IsDefined()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => CourseAssignmentItem)
  assignments: CourseAssignmentItem[];
}
