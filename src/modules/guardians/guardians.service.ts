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
import type { CreateGuardianDto } from './dto/create-guardian.dto.js';
import type { UpdateGuardianLinkDto } from './dto/update-guardian-link.dto.js';
import type { UpdateGuardianDto } from './dto/update-guardian.dto.js';

export interface GuardianProfile {
  id: string;
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  dni: string | null;
  phone: string | null;
  altPhone: string | null;
  address: string | null;
}

export interface GuardianItem {
  membershipId: string;
  userId: string;
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  dni: string | null;
  email: string | null;
  phone: string | null;
  altPhone: string | null;
  address: string | null;
  status: string;
  createdAt: string;
}

export interface GuardianListResult {
  data: GuardianItem[];
  total: number;
  page: number;
  limit: number;
}

export interface CreateGuardianResult extends GuardianItem {
  /** false cuando se reutilizó un tutor ya existente por DNI o email. */
  created: boolean;
}

export interface ListGuardiansParams {
  q?: string;
  page?: number;
  limit?: number;
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
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const GUARDIAN_COLUMNS =
  'id, user_id, status, created_at, profiles!inner(full_name, first_name, last_name, dni, phone, alt_phone, address)';

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

  /**
   * Listado paginado de tutores (memberships con role 'guardian') de la
   * institución activa, ordenado por nombre. `q` busca en nombre y DNI,
   * insensible a mayúsculas. Solo admin/director.
   */
  async search(
    membership: Membership,
    params: ListGuardiansParams = {},
  ): Promise<GuardianListResult> {
    this.assertStaff(membership);
    const page = params.page ?? 1;
    const limit = params.limit ?? 25;
    if (!Number.isInteger(page) || page < 1) {
      throw new BadRequestException('page debe ser un entero mayor o igual a 1');
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new BadRequestException('limit debe ser un entero entre 1 y 100');
    }
    const term = this.searchTerm(params.q);
    const institutionId = membership.institutionId;

    let query = this.supabase.admin
      .from('memberships')
      .select(GUARDIAN_COLUMNS, { count: 'exact' })
      .eq('institution_id', institutionId)
      .eq('role', 'guardian')
      .order('full_name', { referencedTable: 'profiles' })
      .order('created_at');
    if (term) {
      const ids = await this.guardianIdsMatching(institutionId, term);
      if (!ids.length) return { data: [], total: 0, page, limit };
      query = query.in('id', ids);
    }

    const from = (page - 1) * limit;
    const { data, count, error } = await query.range(from, from + limit - 1);
    if (error) throw error;

    const rows = data ?? [];
    const emails = await this.emailsByUserId(
      unique(rows.map((r: any) => r.user_id as string)),
    );
    return {
      data: rows.map((r: any) =>
        mapGuardianItem(r, emails.get(r.user_id) ?? null),
      ),
      total: count ?? rows.length,
      page,
      limit,
    };
  }

  /**
   * Alta de tutor: crea el usuario en Auth (si no existe por email), su
   * perfil y la membresía con rol 'guardian'. Si ya existe un tutor por
   * DNI o por email devuelve su membresía con `created: false`.
   */
  async createGuardian(
    membership: Membership,
    dto: CreateGuardianDto,
  ): Promise<CreateGuardianResult> {
    this.assertStaff(membership);
    const input = this.validateCreate(dto);
    const institutionId = membership.institutionId;

    // Reutiliza un tutor existente por DNI o por email.
    let userId: string | null = null;
    if (input.dni) {
      const { data: profile, error } = await this.supabase.admin
        .from('profiles')
        .select('id')
        .eq('dni', input.dni)
        .maybeSingle();
      if (error) throw error;
      userId = profile?.id ?? null;
    }
    if (!userId && input.email) {
      const authUser = await this.findAuthUserByEmail(input.email);
      userId = authUser?.id ?? null;
    }
    if (!userId && !input.email) {
      throw new BadRequestException(
        'email es obligatorio para dar de alta un tutor nuevo',
      );
    }

    if (userId) {
      const existing = await this.guardianMembershipByUser(
        institutionId,
        userId,
      );
      if (existing) {
        const emails = await this.emailsByUserId([existing.user_id]);
        return {
          ...mapGuardianItem(existing, emails.get(existing.user_id) ?? null),
          created: false,
        };
      }
    } else {
      const { data, error } = await this.supabase.admin.auth.admin
        .createUser({ email: input.email!, email_confirm: true });
      if (error) throw error;
      if (!data?.user) {
        throw new BadRequestException('No se pudo crear el usuario en auth');
      }
      userId = data.user.id;
    }

    await this.upsertProfile(userId, input);

    const { data: created, error: insertError } = await this.supabase.admin
      .from('memberships')
      .insert({
        user_id: userId,
        institution_id: institutionId,
        role: 'guardian',
        status: 'active',
      })
      .select(GUARDIAN_COLUMNS)
      .single();
    if (insertError) {
      if (insertError.code === '23505') {
        const existing = await this.guardianMembershipByUser(
          institutionId,
          userId,
        );
        if (existing) {
          const emails = await this.emailsByUserId([existing.user_id]);
          return {
            ...mapGuardianItem(existing, emails.get(existing.user_id) ?? null),
            created: false,
          };
        }
      }
      throw insertError;
    }

    const emails = await this.emailsByUserId([created.user_id]);
    return {
      ...mapGuardianItem(
        created,
        input.email ?? emails.get(created.user_id) ?? null,
      ),
      created: true,
    };
  }

  /**
   * Edita los datos personales del tutor (nombre, DNI, teléfonos,
   * dirección y email de acceso) sobre su perfil y auth.
   */
  async updateGuardian(
    membership: Membership,
    membershipId: string,
    dto: UpdateGuardianDto,
  ): Promise<GuardianItem> {
    this.assertStaff(membership);
    const guardian = await this.guardianMembershipFor(membership, membershipId);
    const { profileChanges, email } = this.validateUpdatePerson(dto);

    if (email) {
      await this.updateAuthEmail(guardian.user_id, email);
    }
    const { data, error } = await this.supabase.admin
      .from('profiles')
      .update(profileChanges)
      .eq('id', guardian.user_id)
      .select('id')
      .single();
    if (error) throw error;
    void data;

    const refreshed = await this.guardianMembershipFor(membership, membershipId);
    const emails = await this.emailsByUserId([refreshed.user_id]);
    return mapGuardianItem(
      refreshed,
      email ?? emails.get(refreshed.user_id) ?? null,
    );
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
            .select(
              'id, full_name, first_name, last_name, dni, phone, alt_phone, address',
            )
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

  /** Membresía guardian de la institución activa para un user_id, o null. */
  private async guardianMembershipByUser(institutionId: string, userId: string) {
    const { data, error } = await this.supabase.admin
      .from('memberships')
      .select(GUARDIAN_COLUMNS)
      .eq('institution_id', institutionId)
      .eq('user_id', userId)
      .eq('role', 'guardian')
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  /** Membresía guardian dentro de la institución activa, o 404. */
  private async guardianMembershipFor(membership: Membership, id: string) {
    if (typeof id !== 'string' || !UUID_RE.test(id)) {
      throw new BadRequestException('membershipId inválido');
    }
    const { data, error } = await this.supabase.admin
      .from('memberships')
      .select(GUARDIAN_COLUMNS)
      .eq('id', id)
      .eq('institution_id', membership.institutionId)
      .eq('role', 'guardian')
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new NotFoundException('Tutor no encontrado');
    return data;
  }

  /**
   * Ids de membresías guardian de la institución cuyo perfil coincide con
   * `term` por nombre o DNI (insensible a mayúsculas).
   */
  private async guardianIdsMatching(
    institutionId: string,
    term: string,
  ): Promise<string[]> {
    const { data: profiles, error: profilesError } = await this.supabase.admin
      .from('profiles')
      .select('id')
      .or(`full_name.ilike.%${term}%,dni.ilike.%${term}%`);
    if (profilesError) throw profilesError;
    const userIds = unique((profiles ?? []).map((p: any) => p.id));
    if (!userIds.length) return [];

    const { data, error } = await this.supabase.admin
      .from('memberships')
      .select('id')
      .eq('institution_id', institutionId)
      .eq('role', 'guardian')
      .in('user_id', userIds);
    if (error) throw error;
    return (data ?? []).map((r: any) => r.id as string);
  }

  /** Usuario de auth por email (comparación insensible a mayúsculas). */
  private async findAuthUserByEmail(email: string) {
    const { data, error } = await this.supabase.admin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    if (error) throw error;
    return (
      (data?.users ?? []).find(
        (u) => (u.email ?? '').toLowerCase() === email,
      ) ?? null
    );
  }

  /** Crea el perfil si no existe; si existe, completa los datos del alta. */
  private async upsertProfile(
    userId: string,
    input: ReturnType<GuardiansService['validateCreate']>,
  ) {
    const { data: existing, error } = await this.supabase.admin
      .from('profiles')
      .select('id')
      .eq('id', userId)
      .maybeSingle();
    if (error) throw error;

    const row = {
      full_name: `${input.firstName} ${input.lastName}`,
      first_name: input.firstName,
      last_name: input.lastName,
      dni: input.dni,
      phone: input.phone,
      alt_phone: input.altPhone,
      address: input.address,
    };
    if (existing) {
      const { error: updateError } = await this.supabase.admin
        .from('profiles')
        .update(row)
        .eq('id', userId);
      if (updateError) throw updateError;
      return;
    }
    const { error: insertError } = await this.supabase.admin
      .from('profiles')
      .insert({ id: userId, ...row });
    if (insertError) throw insertError;
  }

  /** Actualiza el email del usuario en auth; 400 si la API lo rechaza. */
  private async updateAuthEmail(userId: string, email: string) {
    try {
      const { error } = await this.supabase.admin.auth.admin.updateUserById(
        userId,
        { email },
      );
      if (error) {
        throw new BadRequestException(
          'No se pudo actualizar el email del tutor',
        );
      }
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      throw new BadRequestException('No se pudo actualizar el email del tutor');
    }
  }

  /** Normaliza el término de búsqueda para los filtros ilike/or. */
  private searchTerm(q?: string): string | null {
    if (typeof q !== 'string' || !q.trim()) return null;
    const term = q
      .trim()
      .replace(/[\\%_]/g, (m) => `\\${m}`)
      .replace(/[(),"']/g, ' ')
      .trim();
    return term || null;
  }

  /** Valida y normaliza el alta de tutor. */
  private validateCreate(dto: CreateGuardianDto) {
    if (!dto || typeof dto !== 'object') {
      throw new BadRequestException('El cuerpo es obligatorio');
    }
    const firstName =
      typeof dto.firstName === 'string' ? dto.firstName.trim() : '';
    const lastName =
      typeof dto.lastName === 'string' ? dto.lastName.trim() : '';
    if (!firstName || !lastName) {
      throw new BadRequestException('firstName y lastName son obligatorios');
    }
    const email = this.optionalText(dto.email);
    if (email !== null && !EMAIL_RE.test(email.toLowerCase())) {
      throw new BadRequestException('email inválido');
    }
    return {
      firstName,
      lastName,
      dni: this.optionalText(dto.dni),
      email: email?.toLowerCase() ?? null,
      phone: this.optionalText(dto.phone),
      altPhone: this.optionalText(dto.altPhone),
      address: this.optionalText(dto.address),
    };
  }

  /** Valida la edición del tutor y separa cambios de perfil y auth. */
  private validateUpdatePerson(dto: UpdateGuardianDto) {
    if (!dto || typeof dto !== 'object') {
      throw new BadRequestException('El cuerpo es obligatorio');
    }
    const profileChanges: Record<string, unknown> = {};
    let email: string | null | undefined;

    const firstName =
      dto.firstName !== undefined ? dto.firstName.trim() : undefined;
    if (firstName !== undefined && !firstName) {
      throw new BadRequestException('firstName no puede estar vacío');
    }
    const lastName =
      dto.lastName !== undefined ? dto.lastName.trim() : undefined;
    if (lastName !== undefined && !lastName) {
      throw new BadRequestException('lastName no puede estar vacío');
    }
    if (dto.fullName !== undefined && !dto.fullName.trim()) {
      throw new BadRequestException('fullName no puede estar vacío');
    }

    if (firstName !== undefined) profileChanges.first_name = firstName;
    if (lastName !== undefined) profileChanges.last_name = lastName;
    if (dto.fullName !== undefined) {
      profileChanges.full_name = dto.fullName.trim();
    } else if (firstName !== undefined || lastName !== undefined) {
      profileChanges.full_name =
        `${firstName ?? ''} ${lastName ?? ''}`.trim() ||
        `${firstName ?? lastName}`;
    }
    if (dto.dni !== undefined) profileChanges.dni = this.optionalText(dto.dni);
    if (dto.email !== undefined) {
      const normalized = this.optionalText(dto.email);
      if (normalized !== null && !EMAIL_RE.test(normalized.toLowerCase())) {
        throw new BadRequestException('email inválido');
      }
      email = normalized?.toLowerCase() ?? null;
    }
    if (dto.phone !== undefined) {
      profileChanges.phone = this.optionalText(dto.phone);
    }
    if (dto.altPhone !== undefined) {
      profileChanges.alt_phone = this.optionalText(dto.altPhone);
    }
    if (dto.address !== undefined) {
      profileChanges.address = this.optionalText(dto.address);
    }

    if (!Object.keys(profileChanges).length && email === undefined) {
      throw new BadRequestException(
        'Debe enviar al menos un campo para actualizar',
      );
    }
    return { profileChanges, email };
  }

  private optionalText(value: unknown): string | null {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string') {
      throw new BadRequestException('El campo debe ser texto');
    }
    return value.trim() || null;
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
          altPhone: profile.alt_phone ?? null,
          address: profile.address ?? null,
        }
      : null,
    email,
    otherStudentsCount,
  };
}

function mapGuardianItem(r: any, email: string | null): GuardianItem {
  const profile = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
  return {
    membershipId: r.id,
    userId: r.user_id,
    fullName: profile?.full_name ?? '',
    firstName: profile?.first_name ?? null,
    lastName: profile?.last_name ?? null,
    dni: profile?.dni ?? null,
    email,
    phone: profile?.phone ?? null,
    altPhone: profile?.alt_phone ?? null,
    address: profile?.address ?? null,
    status: r.status ?? 'active',
    createdAt: r.created_at,
  };
}

function unique(values: (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v)))];
}
