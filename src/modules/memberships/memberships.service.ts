import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Membership } from '../../auth/membership.guard.js';
import { SupabaseService } from '../../supabase/supabase.service.js';
import {
  ACTIVE_MEMBERSHIP_STATUSES,
  MEMBERSHIP_ROLES,
  type MembershipRole,
} from './memberships.constants.js';
import type { UpdateMembershipRoleDto } from './dto/update-membership-role.dto.js';

export interface MembershipRecord {
  membershipId: string;
  userId: string;
  institutionId: string;
  role: string;
  status: string;
  createdAt: string;
  updatedAt: string | null;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MEMBERSHIP_COLUMNS =
  'id, user_id, institution_id, role, status, created_at, updated_at';

const LAST_ADMIN_ROLE_MSG =
  'No se puede quitar el rol de administrador al único administrador de la institución';

const LAST_ADMIN_DELETE_MSG =
  'No se puede eliminar al único administrador de la institución';

const PROMOTE_ADMIN_MSG =
  'Solo un administrador puede asignar el rol de administrador';

@Injectable()
export class MembershipsService {
  constructor(private readonly supabase: SupabaseService) {}

  /**
   * Cambia el rol de una membresía de la institución activa. Rechaza con
   * 404 si la membresía no pertenece a la institución, con 403 si un
   * directivo intenta promover a alguien a 'admin' y con 409 si la
   * operación degradaría al único administrador activo (regla del último
   * administrador).
   */
  async updateRole(
    membership: Membership,
    id: string,
    dto: UpdateMembershipRoleDto,
  ): Promise<MembershipRecord> {
    this.assertStaff(membership);
    const target = await this.membershipFor(membership, id);
    const role = this.validateRole(dto);

    if (role === 'admin' && membership.role !== 'admin') {
      throw new ForbiddenException(PROMOTE_ADMIN_MSG);
    }

    if (target.role === 'admin' && role !== 'admin') {
      const admins = await this.activeAdminsCount(membership.institutionId);
      if (admins <= 1) throw new ConflictException(LAST_ADMIN_ROLE_MSG);
    }

    const { data, error } = await this.supabase.admin
      .from('memberships')
      .update({ role, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('institution_id', membership.institutionId)
      .select(MEMBERSHIP_COLUMNS)
      .single();
    if (error) throw error;
    return mapRecord(data);
  }

  /**
   * Baja lógica de la membresía (status 'inactive', consistente con la
   * baja de vínculos de tutores). Rechaza con 404 si no pertenece a la
   * institución activa y con 409 si es el único administrador activo.
   */
  async remove(membership: Membership, id: string): Promise<void> {
    this.assertStaff(membership);
    const target = await this.membershipFor(membership, id);

    if (target.role === 'admin') {
      const admins = await this.activeAdminsCount(membership.institutionId);
      if (admins <= 1) throw new ConflictException(LAST_ADMIN_DELETE_MSG);
    }

    const { error } = await this.supabase.admin
      .from('memberships')
      .update({ status: 'inactive', updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('institution_id', membership.institutionId);
    if (error) throw error;
  }

  /**
   * Reactiva una membresía dada de baja lógica: status vuelve a 'active'
   * y se limpia el motivo de bloqueo. 404 si la membresía no pertenece a
   * la institución activa.
   */
  async reactivate(membership: Membership, id: string): Promise<void> {
    this.assertStaff(membership);
    await this.membershipFor(membership, id);

    const { error } = await this.supabase.admin
      .from('memberships')
      .update({
        status: 'active',
        blocked_reason: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('institution_id', membership.institutionId);
    if (error) throw error;
  }

  /**
   * Admin y director administran usuarios y membresías. Las únicas
   * operaciones vedadas al directivo son promover a alguien a 'admin'
   * (verificado en updateRole) y degradar/eliminar al último
   * administrador activo (verificado por conteo).
   */
  private assertStaff(membership: Membership) {
    if (membership.role !== 'admin' && membership.role !== 'director') {
      throw new ForbiddenException(
        'Solo admin o director pueden administrar usuarios y roles',
      );
    }
  }

  /** Membresía dentro de la institución activa (para edición/baja). */
  private async membershipFor(membership: Membership, id: string) {
    if (typeof id !== 'string' || !UUID_RE.test(id)) {
      throw new BadRequestException('id de membresía inválido');
    }
    const { data, error } = await this.supabase.admin
      .from('memberships')
      .select(MEMBERSHIP_COLUMNS)
      .eq('id', id)
      .eq('institution_id', membership.institutionId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new NotFoundException('Membresía no encontrada');
    return data;
  }

  /** Cantidad de administradores con membresía vigente en la institución. */
  private async activeAdminsCount(institutionId: string): Promise<number> {
    const { count, error } = await this.supabase.admin
      .from('memberships')
      .select('id', { count: 'exact', head: true })
      .eq('institution_id', institutionId)
      .eq('role', 'admin')
      .in('status', [...ACTIVE_MEMBERSHIP_STATUSES]);
    if (error) throw error;
    return count ?? 0;
  }

  private validateRole(dto: UpdateMembershipRoleDto): MembershipRole {
    const role = dto?.role;
    if (!(MEMBERSHIP_ROLES as readonly string[]).includes(role)) {
      throw new BadRequestException(
        "role debe ser 'admin', 'director', 'teacher' o 'guardian'",
      );
    }
    return role;
  }
}

function mapRecord(r: any): MembershipRecord {
  return {
    membershipId: r.id,
    userId: r.user_id,
    institutionId: r.institution_id,
    role: r.role,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at ?? null,
  };
}
