import { IsIn } from 'class-validator';
import {
  MEMBERSHIP_ROLES,
  type MembershipRole,
} from '../memberships.constants.js';

export class UpdateMembershipRoleDto {
  /** Nuevo rol de la membresía dentro de la institución activa. */
  @IsIn(MEMBERSHIP_ROLES)
  role: MembershipRole;
}
