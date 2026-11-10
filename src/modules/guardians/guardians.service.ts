import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Membership } from '../../auth/membership.guard.js';
import { SupabaseService } from '../../supabase/supabase.service.js';
import type {
  CreateGuardianLinkDto,
  GuardianLinkStatus,
} from './dto/create-guardian-link.dto.js';
import type { UpdateGuardianLinkDto } from './dto/update-guardian-link.dto.js';

export interface GuardianProfile {
  id: string;
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  dni: string | null;
  phone: string | null;
  address: string | null;
}

export interface GuardianLinkResponse {
  guardianMembershipId: string;
  relationship: string;
  isPrimary: boolean;
  isEmergencyContact: boolean;
  isFinancialResponsible: boolean;
  status: GuardianLinkStatus;
  createdAt: string | null;
  updatedAt: string | null;
  profile: GuardianProfile | null;
  email: string | null;
  otherStudentsCount: number;
}

export interface GuardianLinkListResult {
  data: GuardianLinkResponse[];
  total: number;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LINK_COLUMNS =
  'id, student_id, guardian_membership_id, relationship, is_primary, is_emergency_contact, is_financial_responsible, status, created_at, updated_at';

const NON_GUARDIAN_MSG =
  'La membresía asignada debe tener rol de tutor/familiar';
const DUPLICATE_MSG = 'El tutor ya está vinculado a este alumno';
const PRIMARY_UNLINK_MSG =
  'No se puede desvincular al único tutor principal sin designar otro principal primero';

@Injectable()
export class GuardiansService {
  constructor(private readonly supabase: SupabaseService) {}

  /**
   * Tutores vinculados al alumno ordenados por principal primero, luego por
   * estado ('active' antes) y antigüedad del vínculo. Por defecto excluye
   * los vínculos dados de baja ('inactive'); includeInactive los incluye.
   * Cada ítem trae el perfil del tutor, su email y cuántos otros alumnos
   * tiene vinculados (para la advertencia de UX).
   */
  async list(
    membership: Membership,
    studentId: string,
    includeInactive = false,
  ): Promise<GuardianLinkListResult> {
    this.assertStaff(membership);
    await this.studentFor(membership, studentId);

    let query = this.supabase.admin
      .from('guardian_links')
      .select(LINK_COLUMNS)
      .eq('student_id', studentId)
      .order('is_primary', { ascending: false })
      .order('status')
      .order('created_at');
    if (!includeInactive) query = query.neq('status', 'inactive');

    const { data, error } = await query;
    if (error) throw error;

    const links = await this.enrich(membership, studentId, data ?? []);
    return { data: links, total: links.length };
  }

  /**
   * Vincula un tutor al alumno. Exige que la membresía tenga rol 'guardian'
   * en la institución activa (400 si no), rechaza duplicados activos con 409
   * y reactiva vínculos dados de baja en lugar de duplicarlos. Marca el
   * vínculo como principal si lo pidió el cliente o si es el primer tutor
   * activo del alumno, desmarcando al principal previo.
   */
  async link(
    membership: Membership,
    studentId: string,
    dto: CreateGuardianLinkDto,
  ): Promise<GuardianLinkResponse> {
    this.assertStaff(membership);
    await this.studentFor(membership, studentId);
    if (!dto || typeof dto !== 'object') {
      throw new BadRequestException('El cuerpo es obligatorio');
    }
    if (
      typeof dto.guardianMembershipId !== 'string' ||
      !UUID_RE.test(dto.guardianMembershipId)
    ) {
      throw new BadRequestException('guardianMembershipId inválido');
    }

    const { data: guardianMembership, error: membershipError } =
      await this.supabase.admin
        .from('memberships')
        .select('id, role')
        .eq('id', dto.guardianMembershipId)
        .eq('institution_id', membership.institutionId)
        .maybeSingle();
    if (membershipError) throw membershipError;
    if (!guardianMembership) {
      throw new BadRequestException(
        'La membresía del tutor no existe en esta institución',
      );
    }
    if (guardianMembership.role !== 'guardian') {
      throw new BadRequestException(NON_GUARDIAN_MSG);
    }

    const existing = await this.linkFor(
      studentId,
      dto.guardianMembershipId,
    );
    if (existing?.status === 'active') {
      throw new ConflictException(DUPLICATE_MSG);
    }

    const { data: activeLinks, error: activeError } = await this.supabase.admin
      .from('guardian_links')
      .select('id')
      .eq('student_id', studentId)
      .eq('status', 'active');
    if (activeError) throw activeError;

    const isPrimary = dto.isPrimary === true || !(activeLinks ?? []).length;
    if (isPrimary) await this.clearPrimary(studentId);

    const values = {
      relationship: dto.relationship ?? 'familiar-autorizado',
      is_primary: isPrimary,
      is_emergency_contact: dto.isEmergencyContact === true,
      is_financial_responsible: dto.isFinancialResponsible === true,
      status: 'active' as const,
      updated_at: new Date().toISOString(),
    };

    const { data: row, error } = existing
      ? await this.supabase.admin
          .from('guardian_links')
          .update(values)
          .eq('id', existing.id)
          .select(LINK_COLUMNS)
          .single()
      : await this.supabase.admin
          .from('guardian_links')
          .insert({
            student_id: studentId,
            guardian_membership_id: dto.guardianMembershipId,
            ...values,
          })
          .select(LINK_COLUMNS)
          .single();
    if (error) {
      if (error.code === '23505') throw new ConflictException(DUPLICATE_MSG);
      throw error;
    }

    const [enriched] = await this.enrich(membership, studentId, [row]);
    return enriched ?? mapLink(row, null, null, 0);
  }

  /**
   * Edita parentesco, flags y estado del vínculo. Si llega isPrimary en true
   * desmarca al principal previo del alumno antes de actualizar.
   */
  async update(
    membership: Membership,
    studentId: string,
    guardianMembershipId: string,
    dto: UpdateGuardianLinkDto,
  ): Promise<GuardianLinkResponse> {
    this.assertStaff(membership);
    await this.studentFor(membership, studentId);
    const link = await this.findLinkOrFail(studentId, guardianMembershipId);

    const changes: Record<string, unknown> = {};
    if (dto.relationship !== undefined) {
      changes.relationship = dto.relationship;
    }
    if (dto.isPrimary !== undefined) changes.is_primary = dto.isPrimary;
    if (dto.isEmergencyContact !== undefined) {
      changes.is_emergency_contact = dto.isEmergencyContact;
    }
    if (dto.isFinancialResponsible !== undefined) {
      changes.is_financial_responsible = dto.isFinancialResponsible;
    }
    if (dto.status !== undefined) changes.status = dto.status;
    if (!Object.keys(changes).length) {
      throw new BadRequestException(
        'Debe enviar al menos un campo para actualizar',
      );
    }

    if (dto.isPrimary === true) await this.clearPrimary(studentId);

    const { data: row, error } = await this.supabase.admin
      .from('guardian_links')
      .update({ ...changes, updated_at: new Date().toISOString() })
      .eq('id', link.id)
      .select(LINK_COLUMNS)
      .single();
    if (error) throw error;

    const [enriched] = await this.enrich(membership, studentId, [row]);
    return enriched ?? mapLink(row, null, null, 0);
  }

  /**
   * Baja lógica del vínculo (status 'inactive', consistente con la baja de
   * alumnos): conserva el historial y hace que los accesos del tutor a notas
   * y asistencia dejen de contar como vínculo activo. Rechaza con 400 la
   * desvinculación del tutor principal cuando quedan otros tutores activos.
   */
  async unlink(
    membership: Membership,
    studentId: string,
    guardianMembershipId: string,
  ): Promise<void> {
    this.assertStaff(membership);
    await this.studentFor(membership, studentId);
    const link = await this.findLinkOrFail(studentId, guardianMembershipId);

    if (link.is_primary) {
      const { data: others, error } = await this.supabase.admin
        .from('guardian_links')
        .select('id')
        .eq('student_id', studentId)
        .eq('status', 'active')
        .neq('id', link.id);
      if (error) throw error;
      if (others?.length) throw new BadRequestException(PRIMARY_UNLINK_MSG);
    }

    const { error } = await this.supabase.admin
      .from('guardian_links')
      .update({
        status: 'inactive',
        is_primary: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', link.id);
    if (error) throw error;
  }

  /**
   * Acción rápida "Marcar como principal": desmarca al principal previo y
   * marca este vínculo, que debe estar activo.
   */
  async makePrimary(
    membership: Membership,
    studentId: string,
    guardianMembershipId: string,
  ): Promise<GuardianLinkResponse> {
    this.assertStaff(membership);
    await this.studentFor(membership, studentId);
    const link = await this.findLinkOrFail(studentId, guardianMembershipId);
    if (link.status !== 'active') {
      throw new BadRequestException(
        'No se puede marcar como principal a un tutor desvinculado',
      );
    }

    await this.clearPrimary(studentId);

    const { data: row, error } = await this.supabase.admin
      .from('guardian_links')
      .update({ is_primary: true, updated_at: new Date().toISOString() })
      .eq('id', link.id)
      .select(LINK_COLUMNS)
      .single();
    if (error) throw error;

    const [enriched] = await this.enrich(membership, studentId, [row]);
    return enriched ?? mapLink(row, null, null, 0);
  }

  /** Solo admin/director pueden gestionar los vínculos de tutores. */
  private assertStaff(membership: Membership) {
    if (membership.role !== 'admin' && membership.role !== 'director') {
      throw new ForbiddenException(
        'Solo admin o director pueden gestionar los tutores',
      );
    }
  }

  /** Alumno dentro de la institución activa. */
  private async studentFor(membership: Membership, id: string) {
    if (typeof id !== 'string' || !UUID_RE.test(id)) {
      throw new BadRequestException('id de alumno inválido');
    }
    const { data, error } = await this.supabase.admin
      .from('students')
      .select('id')
      .eq('id', id)
      .eq('institution_id', membership.institutionId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new NotFoundException('Alumno no encontrado');
    return data;
  }

  /** Vínculo existente entre el alumno y la membresía del tutor, o null. */
  private async linkFor(studentId: string, guardianMembershipId: string) {
    const { data, error } = await this.supabase.admin
      .from('guardian_links')
      .select(LINK_COLUMNS)
      .eq('student_id', studentId)
      .eq('guardian_membership_id', guardianMembershipId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  private async findLinkOrFail(
    studentId: string,
    guardianMembershipId: string,
  ) {
    const link = await this.linkFor(studentId, guardianMembershipId);
    if (!link) throw new NotFoundException('Vínculo no encontrado');
    return link;
  }

  /** Desmarca is_primary de todos los tutores del alumno. */
  private async clearPrimary(studentId: string) {
    const { error } = await this.supabase.admin
      .from('guardian_links')
      .update({ is_primary: false })
      .eq('student_id', studentId)
      .eq('is_primary', true);
    if (error) throw error;
  }

  /**
   * Resuelve membresías del tutor (solo de la institución activa), perfiles,
   * emails vía auth.admin y la cantidad de otros alumnos vinculados con
   * vínculo activo. Vínculos cuya membresía no pertenece a la institución se
   * omiten por seguridad.
   */
  private async enrich(
    membership: Membership,
    studentId: string,
    links: any[],
  ): Promise<GuardianLinkResponse[]> {
    if (!links.length) return [];

    const membershipIds = [
      ...new Set(links.map((l) => l.guardian_membership_id as string)),
    ];
    const { data: guardianMemberships, error: membershipsError } =
      await this.supabase.admin
        .from('memberships')
        .select('id, user_id')
        .eq('institution_id', membership.institutionId)
        .in('id', membershipIds);
    if (membershipsError) throw membershipsError;

    const membershipById = new Map<string, any>(
      (guardianMemberships ?? []).map((m: any) => [m.id, m]),
    );
    const userIds = [
      ...new Set((guardianMemberships ?? []).map((m: any) => m.user_id)),
    ];

    const [profilesResult, otherCounts, emails] = await Promise.all([
      userIds.length
        ? this.supabase.admin
            .from('profiles')
            .select('id, full_name, first_name, last_name, dni, phone, address')
            .in('id', userIds)
        : Promise.resolve({ data: [], error: null }),
      this.otherStudentsCount(membershipIds, studentId),
      this.emailsByUserId(userIds),
    ]);
    if (profilesResult.error) throw profilesResult.error;

    const profileByUserId = new Map<string, any>(
      (profilesResult.data ?? []).map((p: any) => [p.id, p]),
    );

    const result: GuardianLinkResponse[] = [];
    for (const link of links) {
      const gm = membershipById.get(link.guardian_membership_id);
      if (!gm) continue;
      result.push(
        mapLink(
          link,
          profileByUserId.get(gm.user_id) ?? null,
          emails.get(gm.user_id) ?? null,
          otherCounts.get(link.guardian_membership_id) ?? 0,
        ),
      );
    }
    return result;
  }

  /** Cantidad de otros alumnos con vínculo activo por membresía de tutor. */
  private async otherStudentsCount(
    membershipIds: string[],
    excludeStudentId: string,
  ): Promise<Map<string, number>> {
    const { data, error } = await this.supabase.admin
      .from('guardian_links')
      .select('guardian_membership_id')
      .in('guardian_membership_id', membershipIds)
      .eq('status', 'active')
      .neq('student_id', excludeStudentId);
    if (error) throw error;
    const counts = new Map<string, number>();
    for (const row of data ?? []) {
      const id = row.guardian_membership_id as string;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }

  /** Emails de auth.users por user_id; los fallos individuales devuelven ausencia. */
  private async emailsByUserId(
    userIds: string[],
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    await Promise.all(
      userIds.map(async (userId) => {
        try {
          const { data, error } = await this.supabase.admin.auth.admin
            .getUserById(userId);
          if (!error && data?.user?.email) {
            result.set(userId, data.user.email);
          }
        } catch {
          // Si la consulta a auth falla, el tutor queda con email null.
        }
      }),
    );
    return result;
  }
}

function mapLink(
  link: any,
  profile: any,
  email: string | null,
  otherStudentsCount: number,
): GuardianLinkResponse {
  return {
    guardianMembershipId: link.guardian_membership_id,
    relationship: link.relationship ?? 'familiar-autorizado',
    isPrimary: link.is_primary === true,
    isEmergencyContact: link.is_emergency_contact === true,
    isFinancialResponsible: link.is_financial_responsible === true,
    status: link.status ?? 'active',
    createdAt: link.created_at ?? null,
    updatedAt: link.updated_at ?? null,
    profile: profile
      ? {
          id: profile.id,
          fullName: profile.full_name ?? '',
          firstName: profile.first_name ?? null,
          lastName: profile.last_name ?? null,
          dni: profile.dni ?? null,
          phone: profile.phone ?? null,
          address: profile.address ?? null,
        }
      : null,
    email,
    otherStudentsCount,
  };
}
