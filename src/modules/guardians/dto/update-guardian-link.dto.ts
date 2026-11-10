import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import {
  GUARDIAN_LINK_STATUSES,
  GUARDIAN_RELATIONSHIPS,
  type GuardianLinkStatus,
  type GuardianRelationship,
} from './create-guardian-link.dto.js';

export class UpdateGuardianLinkDto {
  @IsOptional()
  @IsIn(GUARDIAN_RELATIONSHIPS)
  relationship?: GuardianRelationship;

  /** Enviar true desmarca automáticamente al principal previo del alumno. */
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @IsOptional()
  @IsBoolean()
  isEmergencyContact?: boolean;

  @IsOptional()
  @IsBoolean()
  isFinancialResponsible?: boolean;

  @IsOptional()
  @IsIn(GUARDIAN_LINK_STATUSES)
  status?: GuardianLinkStatus;
}
