import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Membership } from '../../auth/membership.guard.js';
import { storeExport, toCsv } from '../../common/export-storage.js';
import { SupabaseService } from '../../supabase/supabase.service.js';
import {
  MEMBERSHIP_ROLES,
  MEMBERSHIP_STATUSES,
  type MembershipRole,
} from '../memberships/memberships.constants.js';
import type { CreateUserDto } from './dto/create-user.dto.js';
import type { UpdateUserDto } from './dto/update-user.dto.js';

export interface UserProfileSummary {
  id: string;
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  dni: string | null;
  phone: string | null;
}

export interface UserListItem {
  membershipId: string;
  userId: string;
  role: string;
  status: string;
  blockedReason: string | null;
  profile: UserProfileSummary;
  email: string | null;
  lastAccess: string | null;
  createdAt: string;
}

export interface UserCounts {
  all: number;
  active: number;
  pending: number;
  blocked: number;
  inactive: number;
}

export interface UserListResult {
  data: UserListItem[];
  total: number;
  page: number;
  limit: number;
}

export interface CreatedUser {
  membershipId: string;
  userId: string;
  institutionId: string;
  role: string;
  status: string;
  email: string;
  profile: UserProfileSummary;
  createdAt: string;
}

export interface ListUsersParams {
  q?: string;
  role?: string;
  status?: string;
  lastAccess?: string;
  page?: number;
  limit?: number;
}

export const LAST_ACCESS_FILTERS = [
  'today',
  '7d',
  '30d',
  '90d+',
  'never',
] as const;

interface AuthInfo {
  email: string | null;
  lastSignInAt: string | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ALREADY_MEMBER_MSG =
  'El usuario ya es miembro de esta institución';

const USER_COLUMNS =
  'id, user_id, role, status, blocked_reason, created_at, updated_at, profiles!inner(id, full_name, first_name, last_name, dni, phone)';

@Injectable()
export class UsersService {
  constructor(private readonly supabase: SupabaseService) {}

  /**
   * Listado paginado de las membresías (usuarios) de la institución
   * activa, ordenado por nombre. Filtros opcionales: `q` (nombre, email o
   * DNI, insensible a mayúsculas), `role` y `status`. El email y el
   * último acceso se resuelven desde auth.users por user_id.
   */
  async list(
    membership: Membership,
    params: ListUsersParams = {},
  ): Promise<UserListResult> {
    this.assertStaff(membership);
    const { role, status, lastAccess, page, limit } =
      this.validateListParams(params);
    const term = this.searchTerm(params.q);
    const institutionId = membership.institutionId;

    let query = this.supabase.admin
      .from('memberships')
      .select(USER_COLUMNS, { count: 'exact' })
      .eq('institution_id', institutionId)
      .order('full_name', { referencedTable: 'profiles' })
      .order('created_at');
    if (role) query = query.eq('role', role);
    if (status) query = query.eq('status', status);
    if (term) {
      const ids = await this.memberIdsMatching(institutionId, term);
      if (!ids.length) return { data: [], total: 0, page, limit };
      query = query.in('id', ids);
    }

    const from = (page - 1) * limit;
    // El filtro por último acceso depende de auth.users: se resuelve en
    // memoria, así que se omite la paginación en base y se recorta después.
    if (!lastAccess) query = query.range(from, from + limit - 1);
    const { data, count, error } = await query;
    if (error) throw error;

    const rows = data ?? [];
    const authInfo = await this.authInfoByUserId(
      unique(rows.map((r: any) => r.user_id as string)),
    );

    let items = rows.map((r: any) => mapItem(r, authInfo.get(r.user_id)));
    let total = count ?? rows.length;
    if (lastAccess) {
      items = items.filter((item) =>
        matchesLastAccess(authInfo.get(item.userId)?.lastSignInAt ?? null, lastAccess),
      );
      total = items.length;
      items = items.slice(from, from + limit);
    }

    return { data: items, total, page, limit };
  }

  /** Conteo de usuarios por estado de membresía para las solapas. */
  async counts(membership: Membership): Promise<UserCounts> {
    this.assertStaff(membership);
    const institutionId = membership.institutionId;
    const count = async (status?: string) => {
      let query = this.supabase.admin
        .from('memberships')
        .select('id', { count: 'exact', head: true })
        .eq('institution_id', institutionId);
      if (status) query = query.eq('status', status);
      const { count: total, error } = await query;
      if (error) throw error;
      return total ?? 0;
    };
    const [all, active, pending, blocked, inactive] = await Promise.all([
      count(),
      count('active'),
      count('pending'),
      count('blocked'),
      count('inactive'),
    ]);
    return { all, active, pending, blocked, inactive };
  }

  /**
   * Edita los datos del usuario (perfil y email de acceso). Rechaza con
   * 404 si el usuario no tiene membresía en la institución activa.
   */
  async update(
    membership: Membership,
    userId: string,
    dto: UpdateUserDto,
  ): Promise<UserListItem> {
    this.assertAdmin(membership);
    const target = await this.membershipByUser(membership, userId);
    const { profileChanges, email } = this.validateUpdate(dto);

    if (email !== undefined) {
      await this.updateAuthEmail(userId, email);
    }
    if (Object.keys(profileChanges).length) {
      const { error } = await this.supabase.admin
        .from('profiles')
        .update(profileChanges)
        .eq('id', userId);
      if (error) throw error;
    }

    const { data, error } = await this.supabase.admin
      .from('memberships')
      .select(USER_COLUMNS)
      .eq('id', target.id)
      .single();
    if (error) throw error;
    const authInfo = await this.authInfoByUserId([userId]);
    const item = mapItem(data, authInfo.get(userId));
    if (email) item.email = email;
    return item;
  }

  /**
   * Envía el email de restablecimiento de contraseña al usuario. Siempre
   * responde sin contenido: los fallos del envío no se propagan.
   */
  async resetPassword(membership: Membership, userId: string): Promise<void> {
    this.assertAdmin(membership);
    await this.membershipByUser(membership, userId);

    try {
      const { data, error } = await this.supabase.admin.auth.admin
        .getUserById(userId);
      if (error || !data?.user?.email) return;
      await (this.supabase.admin.auth as any).resetPasswordForEmail(
        data.user.email,
      );
    } catch {
      // El endpoint responde 204 aunque el envío falle.
    }
  }

  /**
   * Exporta usuarios de la institución (todos o las membresías indicadas)
   * a CSV y devuelve el enlace de descarga.
   */
  async exportCsv(
    membership: Membership,
    membershipIds?: string[],
  ): Promise<{ url: string }> {
    this.assertStaff(membership);
    const institutionId = membership.institutionId;
    const cleanIds = (membershipIds ?? []).filter((id) =>
      /^[0-9a-f-]{36}$/i.test(id),
    );

    let query = this.supabase.admin
      .from('memberships')
      .select(USER_COLUMNS)
      .eq('institution_id', institutionId)
      .order('full_name', { referencedTable: 'profiles' });
    if (cleanIds.length) query = query.in('id', cleanIds);
    const { data, error } = await query;
    if (error) throw error;

    const rows = data ?? [];
    const authInfo = await this.authInfoByUserId(
      unique(rows.map((r: any) => r.user_id as string)),
    );

    const csv = toCsv(
      [
        'membershipId',
        'userId',
        'fullName',
        'firstName',
        'lastName',
        'dni',
        'email',
        'phone',
        'role',
        'status',
        'blockedReason',
        'lastAccess',
        'createdAt',
      ],
      rows.map((r: any) => {
        const item = mapItem(r, authInfo.get(r.user_id));
        return [
          item.membershipId,
          item.userId,
          item.profile.fullName,
          item.profile.firstName,
          item.profile.lastName,
          item.profile.dni,
          item.email,
          item.profile.phone,
          item.role,
          item.status,
          item.blockedReason,
          item.lastAccess,
          item.createdAt,
        ];
      }),
    );
    const url = await storeExport(
      this.supabase.admin,
      `users/${institutionId}-${Date.now()}.csv`,
      csv,
      'text/csv',
    );
    return { url };
  }

  /**
   * Alta de usuario en la institución activa. Si el email ya existe en
   * Supabase Auth (p. ej. miembro de otra escuela) se reutiliza ese
   * user_id; si no, se crea con email_confirm y su fila en profiles.
   * Rechaza con 409 si el usuario ya tiene membresía en la institución.
   */
  async create(
    membership: Membership,
    dto: CreateUserDto,
  ): Promise<CreatedUser> {
    this.assertAdmin(membership);
    const input = this.validateCreate(dto);
    const institutionId = membership.institutionId;

    const existing = await this.findAuthUserByEmail(input.email);
    let userId: string;
    if (existing) {
      userId = existing.id;
      const { data: prev, error: prevError } = await this.supabase.admin
        .from('memberships')
        .select('id')
        .eq('user_id', userId)
        .eq('institution_id', institutionId);
      if (prevError) throw prevError;
      if (prev?.length) throw new ConflictException(ALREADY_MEMBER_MSG);
    } else {
      const { data, error } = await this.supabase.admin.auth.admin
        .createUser({
          email: input.email,
          password: input.temporaryPassword ?? randomUUID(),
          email_confirm: true,
        });
      if (error) throw error;
      if (!data?.user) {
        throw new BadRequestException('No se pudo crear el usuario en auth');
      }
      userId = data.user.id;
    }

    await this.ensureProfile(userId, input);

    const { data: created, error: insertError } = await this.supabase.admin
      .from('memberships')
      .insert({
        user_id: userId,
        institution_id: institutionId,
        role: input.role,
        status: 'active',
      })
      .select(USER_COLUMNS)
      .single();
    if (insertError) throw insertError;

    return {
      membershipId: created.id,
      userId: created.user_id,
      institutionId,
      role: created.role,
      status: created.status,
      email: input.email,
      profile: profileSummary(created.user_id, profileOf(created), input),
      createdAt: created.created_at,
    };
  }

  /**
   * Membresía del usuario en la institución activa (cualquier rol), o 404.
   * Usada para operaciones dirigidas por user_id.
   */
  private async membershipByUser(membership: Membership, userId: string) {
    if (!/^[0-9a-f-]{36}$/i.test(userId)) {
      throw new BadRequestException('userId inválido');
    }
    const { data, error } = await this.supabase.admin
      .from('memberships')
      .select('id')
      .eq('institution_id', membership.institutionId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new NotFoundException('Usuario no encontrado');
    return data;
  }

  /** Valida la edición y separa cambios de perfil y de auth. */
  private validateUpdate(dto: UpdateUserDto) {
    if (!dto || typeof dto !== 'object') {
      throw new BadRequestException('El cuerpo es obligatorio');
    }
    const profileChanges: Record<string, unknown> = {};
    let email: string | undefined;

    const text = (v: unknown): string | null =>
      v === undefined || v === null ? null : String(v).trim() || null;

    const firstName =
      dto.firstName !== undefined ? dto.firstName?.trim() : undefined;
    const lastName =
      dto.lastName !== undefined ? dto.lastName?.trim() : undefined;
    if (dto.fullName !== undefined && !dto.fullName.trim()) {
      throw new BadRequestException('fullName no puede estar vacío');
    }
    if (dto.firstName !== undefined && dto.firstName !== null && !firstName) {
      throw new BadRequestException('firstName no puede estar vacío');
    }
    if (dto.lastName !== undefined && dto.lastName !== null && !lastName) {
      throw new BadRequestException('lastName no puede estar vacío');
    }

    if (firstName !== undefined) profileChanges.first_name = firstName;
    if (lastName !== undefined) profileChanges.last_name = lastName;
    if (dto.fullName !== undefined) {
      profileChanges.full_name = dto.fullName.trim();
    } else if (firstName !== undefined || lastName !== undefined) {
      profileChanges.full_name =
        `${firstName ?? ''} ${lastName ?? ''}`.trim() || null;
    }
    if (dto.dni !== undefined) profileChanges.dni = text(dto.dni);
    if (dto.phone !== undefined) profileChanges.phone = text(dto.phone);
    if (dto.email !== undefined) email = dto.email.trim().toLowerCase();

    if (!Object.keys(profileChanges).length && email === undefined) {
      throw new BadRequestException(
        'Debe enviar al menos un campo para actualizar',
      );
    }
    return { profileChanges, email };
  }

  /** Actualiza el email del usuario en auth; 400 si la API lo rechaza. */
  private async updateAuthEmail(userId: string, email: string) {
    try {
      const { error } = await this.supabase.admin.auth.admin.updateUserById(
        userId,
        { email },
      );
      if (error) {
        throw new BadRequestException('No se pudo actualizar el email');
      }
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      throw new BadRequestException('No se pudo actualizar el email');
    }
  }

  /** Lectura: admin y director pueden consultar usuarios. */
  private assertStaff(membership: Membership) {
    if (membership.role !== 'admin' && membership.role !== 'director') {
      throw new ForbiddenException(
        'Solo admin o director pueden consultar usuarios',
      );
    }
  }

  /** Solo admin puede administrar usuarios y roles. */
  private assertAdmin(membership: Membership) {
    if (membership.role !== 'admin') {
      throw new ForbiddenException(
        'Solo admin puede administrar usuarios y roles',
      );
    }
  }

  /**
   * Ids de membresías de la institución cuyo perfil (nombre o DNI) o
   * email coincide con `term` (insensible a mayúsculas). El email vive
   * en auth.users, así que se resuelve en pasos separados: profiles →
   * auth.users → memberships, evitando filtros or() sobre embeds.
   */
  private async memberIdsMatching(
    institutionId: string,
    term: string,
  ): Promise<string[]> {
    const { data: profiles, error: profilesError } =
      await this.supabase.admin
        .from('profiles')
        .select('id')
        .or(
          `full_name.ilike.%${term}%,dni.ilike.%${term}%,dni.ilike.%${term.replace(/[\s.]/g, '')}%`,
        );
    if (profilesError) throw profilesError;

    const userIds = new Set<string>(
      (profiles ?? []).map((p: any) => p.id as string),
    );
    for (const id of await this.userIdsMatchingEmail(term)) {
      userIds.add(id);
    }
    if (!userIds.size) return [];

    const { data, error } = await this.supabase.admin
      .from('memberships')
      .select('id')
      .eq('institution_id', institutionId)
      .in('user_id', [...userIds]);
    if (error) throw error;
    return (data ?? []).map((r: any) => r.id as string);
  }

  /** user_ids de auth.users cuyo email contiene el término buscado. */
  private async userIdsMatchingEmail(term: string): Promise<string[]> {
    const { data, error } = await this.supabase.admin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    if (error) throw error;
    return (data?.users ?? [])
      .filter((u) => (u.email ?? '').toLowerCase().includes(term))
      .map((u) => u.id);
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

  /** Email y última conexión de auth.users por user_id. */
  private async authInfoByUserId(
    userIds: string[],
  ): Promise<Map<string, AuthInfo>> {
    const result = new Map<string, AuthInfo>();
    await Promise.all(
      userIds.map(async (userId) => {
        try {
          const { data, error } = await this.supabase.admin.auth.admin
            .getUserById(userId);
          if (!error && data?.user) {
            result.set(userId, {
              email: data.user.email ?? null,
              lastSignInAt: data.user.last_sign_in_at ?? null,
            });
          }
        } catch {
          // Si la consulta a auth falla, el usuario queda sin email/acceso.
        }
      }),
    );
    return result;
  }

  /**
   * Crea la fila en profiles si el usuario todavía no la tiene; una
   * existente no se toca (el perfil es global del usuario, no por
   * institución).
   */
  private async ensureProfile(
    userId: string,
    input: ReturnType<UsersService['validateCreate']>,
  ) {
    const { data: existing, error } = await this.supabase.admin
      .from('profiles')
      .select('id')
      .eq('id', userId)
      .maybeSingle();
    if (error) throw error;
    if (existing) return;

    const { error: insertError } = await this.supabase.admin
      .from('profiles')
      .insert({
        id: userId,
        full_name: input.fullName,
        first_name: input.firstName ?? null,
        last_name: input.lastName ?? null,
        dni: input.dni ?? null,
        phone: input.phone ?? null,
      });
    if (insertError) throw insertError;
  }

  private validateListParams(params: ListUsersParams) {
    const page = params.page ?? 1;
    const limit = params.limit ?? 25;
    if (!Number.isInteger(page) || page < 1) {
      throw new BadRequestException('page debe ser >= 1');
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new BadRequestException('limit debe estar entre 1 y 100');
    }
    const role = params.role || undefined;
    if (
      role !== undefined &&
      !(MEMBERSHIP_ROLES as readonly string[]).includes(role)
    ) {
      throw new BadRequestException(
        "role debe ser 'admin', 'director', 'teacher' o 'guardian'",
      );
    }
    const status = params.status || undefined;
    if (
      status !== undefined &&
      !(MEMBERSHIP_STATUSES as readonly string[]).includes(status)
    ) {
      throw new BadRequestException(
        "status debe ser 'active', 'inactive', 'pending' o 'blocked'",
      );
    }
    const lastAccess = params.lastAccess || undefined;
    if (
      lastAccess !== undefined &&
      !(LAST_ACCESS_FILTERS as readonly string[]).includes(lastAccess)
    ) {
      throw new BadRequestException(
        "lastAccess debe ser 'today', '7d', '30d', '90d+' o 'never'",
      );
    }
    return { role, status, lastAccess, page, limit };
  }

  private validateCreate(dto: CreateUserDto) {
    if (!dto || typeof dto !== 'object') {
      throw new BadRequestException('Body inválido');
    }
    const email =
      typeof dto.email === 'string' ? dto.email.trim().toLowerCase() : '';
    if (!EMAIL_RE.test(email)) {
      throw new BadRequestException('email inválido');
    }
    const fullName =
      typeof dto.fullName === 'string' ? dto.fullName.trim() : '';
    if (!fullName) {
      throw new BadRequestException('fullName es obligatorio');
    }
    if (!(MEMBERSHIP_ROLES as readonly string[]).includes(dto.role)) {
      throw new BadRequestException(
        "role debe ser 'admin', 'director', 'teacher' o 'guardian'",
      );
    }
    if (
      dto.temporaryPassword !== undefined &&
      (typeof dto.temporaryPassword !== 'string' ||
        dto.temporaryPassword.length < 8)
    ) {
      throw new BadRequestException(
        'temporaryPassword debe tener al menos 8 caracteres',
      );
    }
    return {
      email,
      fullName,
      role: dto.role as MembershipRole,
      temporaryPassword: dto.temporaryPassword,
      phone: optString(dto.phone),
      dni: optString(dto.dni),
      firstName: optString(dto.firstName),
      lastName: optString(dto.lastName),
    };
  }

  private searchTerm(q?: string) {
    const t = q?.trim().toLowerCase();
    return t ? t.replace(/[%,()]/g, '') : undefined;
  }
}

function mapItem(r: any, auth: AuthInfo | undefined): UserListItem {
  return {
    membershipId: r.id,
    userId: r.user_id,
    role: r.role,
    status: r.status,
    blockedReason: r.blocked_reason ?? null,
    profile: profileSummary(r.user_id, profileOf(r)),
    email: auth?.email ?? null,
    lastAccess: auth?.lastSignInAt ?? r.updated_at ?? r.created_at,
    createdAt: r.created_at,
  };
}

function profileOf(r: any) {
  return Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
}

function profileSummary(
  userId: string,
  p: any,
  input?: {
    fullName: string;
    firstName?: string;
    lastName?: string;
    dni?: string;
    phone?: string;
  },
): UserProfileSummary {
  return {
    id: p?.id ?? userId,
    fullName: p?.full_name ?? input?.fullName ?? '',
    firstName: p?.first_name ?? input?.firstName ?? null,
    lastName: p?.last_name ?? input?.lastName ?? null,
    dni: p?.dni ?? input?.dni ?? null,
    phone: p?.phone ?? input?.phone ?? null,
  };
}

function optString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function unique<T>(values: (T | null | undefined)[]): T[] {
  return [...new Set(values.filter((v): v is T => v != null))];
}

/**
 * Aplica el filtro de último acceso sobre last_sign_in_at de auth.users:
 * today | 7d | 30d | 90d+ (más de 90 días sin entrar) | never.
 */
function matchesLastAccess(
  lastSignInAt: string | null,
  filter: string,
): boolean {
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  if (filter === 'never') return !lastSignInAt;
  if (!lastSignInAt) return false;
  const ts = Date.parse(lastSignInAt);
  if (Number.isNaN(ts)) return false;
  if (filter === 'today') {
    const date = new Date(ts);
    const today = new Date(now);
    return (
      date.getFullYear() === today.getFullYear() &&
      date.getMonth() === today.getMonth() &&
      date.getDate() === today.getDate()
    );
  }
  if (filter === '7d') return now - ts <= 7 * DAY;
  if (filter === '30d') return now - ts <= 30 * DAY;
  if (filter === '90d+') return now - ts > 90 * DAY;
  return false;
}
