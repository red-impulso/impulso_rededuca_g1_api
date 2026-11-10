import { IsBoolean, IsIn, IsOptional, IsUUID } from 'class-validator';

export const GUARDIAN_RELATIONSHIPS = [
  'madre',
  'padre',
  'tutor-legal',
  'encargado',
  'familiar-autorizado',
  'otro',
] as const;

export type GuardianRelationship = (typeof GUARDIAN_RELATIONSHIPS)[number];

export const GUARDIAN_LINK_STATUSES = [
  'active',
  'inactive',
  'pending',
] as const;

export type GuardianLinkStatus = (typeof GUARDIAN_LINK_STATUSES)[number];

export class CreateGuardianLinkDto {
  /** Membresía con rol 'guardian' en la institución activa. */
  @IsUUID()
  guardianMembershipId: string;

  @IsOptional()
  @IsIn(GUARDIAN_RELATIONSHIPS)
  relationship?: GuardianRelationship;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @IsOptional()
  @IsBoolean()
  isEmergencyContact?: boolean;

  @IsOptional()
  @IsBoolean()
  isFinancialResponsible?: boolean;
}
