import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Membership } from '../../auth/membership.guard.js';
import { SupabaseService } from '../../supabase/supabase.service.js';
import type { AssignTeacherDto } from './dto/assign-teacher.dto.js';
import {
  EMPLOYMENT_STATUSES,
  TEACHER_STATUSES,
  type UpdateTeacherDto,
} from './dto/update-teacher.dto.js';

export interface TeacherCourseRef {
  id: string;
  name: string;
  year: number | null;
  division: string | null;
  shift: string | null;
  schoolYear: number | null;
}

export interface TeacherSubjectSummary {
  id: string;
  name: string;
  weeklyHours: number;
  course: Omit<TeacherCourseRef, 'schoolYear'> | null;
}

export interface TeacherSummary {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  fileNumber: string | null;
  employmentStatus: string;
  status: string;
  coursesCount: number;
  subjects: TeacherSubjectSummary[];
  weeklyHours: number;
  maxWeeklyHours: number;
}

export interface TeacherListResult {
  data: TeacherSummary[];
  total: number;
  page: number;
  limit: number;
}

export interface TeacherDetail {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  fileNumber: string | null;
  employmentStatus: string;
  status: string;
  hiredAt: string | null;
  seniority: { years: number; months: number } | null;
  kpis: {
    weeklyHours: number;
    maxWeeklyHours: number;
    subjectsCount: number;
    coursesCount: number;
    studentsReached: number;
  };
  subjects: {
    id: string;
    name: string;
    weeklyHours: number;
    course: TeacherCourseRef | null;
  }[];
  /** Grilla semanal del docente; vacía hasta que se modelen los horarios. */
  schedule: unknown[];
}

export interface TeacherRecord {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  fileNumber: string | null;
  employmentStatus: string;
  status: string;
  maxWeeklyHours: number;
  hiredAt: string | null;
}

export interface AssignedSubject {
  id: string;
  name: string;
  weeklyHours: number;
  course: TeacherCourseRef | null;
  teacher: { id: string; fullName: string | null } | null;
}

export interface CourseAssignments {
  course: TeacherCourseRef;
  subjects: {
    id: string;
    name: string;
    weeklyHours: number;
    teacher: { id: string; fullName: string | null } | null;
  }[];
}

export interface ListTeachersParams {
  q?: string;
  status?: string;
  employmentStatus?: string;
  courseId?: string;
  subjectId?: string;
  page?: number;
  limit?: number;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const DEFAULT_MAX_WEEKLY_HOURS = 30;
const DEFAULT_SUBJECT_WEEKLY_HOURS = 4;

const NOT_TEACHER_MSG =
  'La membresía asignada debe tener rol de docente';

const TEACHER_COLUMNS =
  'id, user_id, file_number, employment_status, status, max_weekly_hours, hired_at, created_at, profiles!inner(full_name, phone)';

const SUBJECT_COLUMNS =
  'id, name, weekly_hours, teacher_membership_id, course_id, courses!inner(id, name, year, division, shift, school_year, institution_id)';

@Injectable()
export class TeachersService {
  constructor(private readonly supabase: SupabaseService) {}

  /**
   * Listado paginado de docentes (memberships con role 'teacher') de la
   * institución activa, ordenado por nombre. Filtros opcionales: `q`
   * (nombre o legajo, insensible a mayúsculas), `status`,
   * `employmentStatus`, `courseId` y `subjectId` (últimos dos sobre el
   * ciclo lectivo activo). Cada elemento trae sus materias del ciclo
   * lectivo activo con la carga horaria acumulada.
   */
  async list(
    membership: Membership,
    params: ListTeachersParams = {},
  ): Promise<TeacherListResult> {
    this.assertStaff(membership);
    const { status, employmentStatus, courseId, subjectId, page, limit } =
      this.validateListParams(params);
    const term = this.searchTerm(params.q);

    const institutionId = membership.institutionId;
    const activeYear = await this.activeSchoolYear(institutionId);

    let query = this.supabase.admin
      .from('memberships')
      .select(TEACHER_COLUMNS, { count: 'exact' })
      .eq('institution_id', institutionId)
      .eq('role', 'teacher')
      .order('full_name', { referencedTable: 'profiles' })
      .order('created_at');
    if (status) query = query.eq('status', status);
    if (employmentStatus) query = query.eq('employment_status', employmentStatus);

    if (term) {
      const ids = await this.teacherIdsMatching(institutionId, term);
      if (!ids.length) return { data: [], total: 0, page, limit };
      query = query.in('id', ids);
    }
    if (courseId || subjectId) {
      const ids = await this.teacherIdsTeaching(institutionId, activeYear, {
        courseId,
        subjectId,
      });
      if (!ids.length) return { data: [], total: 0, page, limit };
      query = query.in('id', ids);
    }

    const from = (page - 1) * limit;
    const { data, count, error } = await query.range(from, from + limit - 1);
    if (error) throw error;

    const rows = data ?? [];
    const subjectsByTeacher = await this.subjectsByTeacher(
      institutionId,
      rows.map((r: any) => r.id as string),
      activeYear,
    );
    const emails = await this.emailsByUserId(
      unique(rows.map((r: any) => r.user_id as string)),
    );

    return {
      data: rows.map((r: any) =>
        mapSummary(
          r,
          subjectsByTeacher.get(r.id) ?? [],
          emails.get(r.user_id) ?? null,
        ),
      ),
      total: count ?? rows.length,
      page,
      limit,
    };
  }

  /**
   * Ficha completa del docente para la pantalla de detalle: datos
   * personales y laborales, KPIs (carga horaria vs límite, materias,
   * cursos a cargo y alumnos alcanzados), materias del ciclo lectivo
   * activo y la grilla de horarios (vacía hasta que se modele).
   */
  async detail(membership: Membership, id: string): Promise<TeacherDetail> {
    this.assertStaff(membership);
    const teacher = await this.teacherFor(membership, id);

    const institutionId = membership.institutionId;
    const activeYear = await this.activeSchoolYear(institutionId);
    const subjectsByTeacher = await this.subjectsByTeacher(
      institutionId,
      [id],
      activeYear,
    );
    const subjects = subjectsByTeacher.get(id) ?? [];
    const emails = await this.emailsByUserId([teacher.user_id]);
    const courseIds = unique(subjects.map((s: any) => s.course_id));
    const studentsReached = await this.studentsInCourses(
      institutionId,
      courseIds,
    );

    const profile = profileOf(teacher);
    const weeklyHours = subjects.reduce(
      (a: number, s: any) => a + weeklyHoursOf(s),
      0,
    );
    return {
      id: teacher.id,
      fullName: profile?.full_name ?? '',
      email: emails.get(teacher.user_id) ?? null,
      phone: profile?.phone ?? null,
      fileNumber: teacher.file_number ?? null,
      employmentStatus: teacher.employment_status ?? 'titular',
      status: teacher.status ?? 'activo',
      hiredAt: teacher.hired_at ?? null,
      seniority: seniorityFrom(teacher.hired_at),
      kpis: {
        weeklyHours,
        maxWeeklyHours: teacher.max_weekly_hours ?? DEFAULT_MAX_WEEKLY_HOURS,
        subjectsCount: subjects.length,
        coursesCount: courseIds.length,
        studentsReached,
      },
      subjects: subjects.map(mapDetailSubject),
      schedule: [],
    };
  }

  /**
   * Edita los datos laborales del docente (legajo, situación de revista,
   * estado, límite horario y fecha de alta) dentro de la institución
   * activa. Rechaza con 404 si la membresía docente no existe en ella.
   */
  async update(
    membership: Membership,
    id: string,
    dto: UpdateTeacherDto,
  ): Promise<TeacherRecord> {
    this.assertStaff(membership);
    await this.teacherFor(membership, id);
    const changes = this.validateUpdate(dto);

    const { data, error } = await this.supabase.admin
      .from('memberships')
      .update(changes)
      .eq('id', id)
      .eq('institution_id', membership.institutionId)
      .eq('role', 'teacher')
      .select(TEACHER_COLUMNS)
      .single();
    if (error) throw error;

    const emails = await this.emailsByUserId([data.user_id]);
    return mapRecord(data, emails.get(data.user_id) ?? null);
  }

  /**
   * Asigna (o desasigna con null) el docente de una materia de la
   * institución activa. Rechaza con 404 si la materia no pertenece a la
   * institución y con 400 si la membresía no existe en ella o no tiene
   * rol estrictamente 'teacher'.
   */
  async assignTeacher(
    membership: Membership,
    subjectId: string,
    dto: AssignTeacherDto,
  ): Promise<AssignedSubject> {
    this.assertStaff(membership);
    await this.subjectFor(membership, subjectId);
    if (!dto || typeof dto !== 'object' || !('teacherMembershipId' in dto)) {
      throw new BadRequestException(
        'teacherMembershipId es obligatorio (puede ser null)',
      );
    }

    let teacher: { id: string; fullName: string | null } | null = null;
    if (dto.teacherMembershipId !== null) {
      teacher = await this.teacherMembershipFor(
        membership,
        dto.teacherMembershipId,
      );
    }

    const { data, error } = await this.supabase.admin
      .from('subjects')
      .update({ teacher_membership_id: teacher?.id ?? null })
      .eq('id', subjectId)
      .select(SUBJECT_COLUMNS)
      .single();
    if (error) throw error;

    const teachers = teacher
      ? new Map([[teacher.id, teacher]])
      : await this.teachersById(unique([data.teacher_membership_id]));
    return this.toAssignedSubject(data, teachers);
  }

  /**
   * Materias del curso con el docente asignado actualmente y la carga
   * horaria semanal, para la pantalla de asignación por curso.
   */
  async courseAssignments(
    membership: Membership,
    courseId: string,
  ): Promise<CourseAssignments> {
    this.assertStaff(membership);
    const course = await this.courseFor(membership, courseId);

    const { data, error } = await this.supabase.admin
      .from('subjects')
      .select('id, name, weekly_hours, teacher_membership_id')
      .eq('course_id', courseId)
      .order('name');
    if (error) throw error;

    const rows = data ?? [];
    const teachers = await this.teachersById(
      unique(rows.map((r: any) => r.teacher_membership_id)),
    );
    return {
      course: mapCourse(course)!,
      subjects: rows.map((s: any) => ({
        id: s.id,
        name: s.name,
        weeklyHours: weeklyHoursOf(s),
        teacher: s.teacher_membership_id
          ? (teachers.get(s.teacher_membership_id) ?? {
              id: s.teacher_membership_id,
              fullName: null,
            })
          : null,
      })),
    };
  }

  /** Solo admin/director pueden gestionar docentes y sus asignaciones. */
  private assertStaff(membership: Membership) {
    if (membership.role !== 'admin' && membership.role !== 'director') {
      throw new ForbiddenException(
        'Solo admin o director pueden gestionar los docentes',
      );
    }
  }

  /**
   * Ciclo lectivo activo de la institución: el mayor school_year entre
   * sus cursos, o null si todavía no tiene cursos cargados.
   */
  private async activeSchoolYear(institutionId: string): Promise<number | null> {
    const { data, error } = await this.supabase.admin
      .from('courses')
      .select('school_year')
      .eq('institution_id', institutionId)
      .order('school_year', { ascending: false })
      .limit(1);
    if (error) throw error;
    const year = data?.[0]?.school_year;
    return typeof year === 'number' ? year : null;
  }

  /**
   * Ids de membresías docentes de la institución cuyo legajo o nombre de
   * perfil coincide con `term` (insensible a mayúsculas). El nombre vive
   * en profiles, así que se resuelve en dos pasos: profiles → user_ids →
   * memberships, lo que evita depender de filtros or() sobre embeds.
   */
  private async teacherIdsMatching(
    institutionId: string,
    term: string,
  ): Promise<string[]> {
    const { data: profiles, error: profilesError } = await this.supabase.admin
      .from('profiles')
      .select('id')
      .ilike('full_name', `%${term}%`);
    if (profilesError) throw profilesError;
    const userIds = (profiles ?? []).map((p: any) => p.id as string);

    const filters = [`file_number.ilike.%${term}%`];
    if (userIds.length) filters.push(`user_id.in.(${userIds.join(',')})`);

    const { data, error } = await this.supabase.admin
      .from('memberships')
      .select('id')
      .eq('institution_id', institutionId)
      .eq('role', 'teacher')
      .or(filters.join(','));
    if (error) throw error;
    return (data ?? []).map((r: any) => r.id as string);
  }

  /**
   * Ids de membresías docentes que dictan al menos una materia del curso
   * o la materia indicada, dentro del ciclo lectivo activo.
   */
  private async teacherIdsTeaching(
    institutionId: string,
    activeYear: number | null,
    filter: { courseId?: string; subjectId?: string },
  ): Promise<string[]> {
    if (activeYear === null) return [];
    let query = this.supabase.admin
      .from('subjects')
      .select('teacher_membership_id, courses!inner(id)')
      .eq('courses.institution_id', institutionId)
      .eq('courses.school_year', activeYear)
      .not('teacher_membership_id', 'is', null);
    if (filter.courseId) query = query.eq('course_id', filter.courseId);
    if (filter.subjectId) query = query.eq('id', filter.subjectId);
    const { data, error } = await query;
    if (error) throw error;
    return unique(
      (data ?? []).map((r: any) => r.teacher_membership_id as string | null),
    );
  }

  /**
   * Materias del ciclo lectivo activo agrupadas por membresía docente,
   * restringidas a la institución activa vía el join con courses.
   */
  private async subjectsByTeacher(
    institutionId: string,
    teacherIds: string[],
    activeYear: number | null,
  ): Promise<Map<string, any[]>> {
    const map = new Map<string, any[]>();
    if (!teacherIds.length || activeYear === null) return map;

    const { data, error } = await this.supabase.admin
      .from('subjects')
      .select(SUBJECT_COLUMNS)
      .in('teacher_membership_id', teacherIds)
      .eq('courses.institution_id', institutionId)
      .eq('courses.school_year', activeYear)
      .order('name');
    if (error) throw error;

    for (const s of data ?? []) {
      const list = map.get(s.teacher_membership_id) ?? [];
      list.push(s);
      map.set(s.teacher_membership_id, list);
    }
    return map;
  }

  /** Alumnos activos de la institución cursando en los cursos dados. */
  private async studentsInCourses(
    institutionId: string,
    courseIds: string[],
  ): Promise<number> {
    if (!courseIds.length) return 0;
    const { count, error } = await this.supabase.admin
      .from('students')
      .select('id', { count: 'exact', head: true })
      .eq('institution_id', institutionId)
      .eq('status', 'active')
      .in('course_id', courseIds);
    if (error) throw error;
    return count ?? 0;
  }

  /** Membresía docente dentro de la institución activa (para ficha/edición). */
  private async teacherFor(membership: Membership, id: string) {
    if (typeof id !== 'string' || !UUID_RE.test(id)) {
      throw new BadRequestException('id de docente inválido');
    }
    const { data, error } = await this.supabase.admin
      .from('memberships')
      .select(TEACHER_COLUMNS)
      .eq('id', id)
      .eq('institution_id', membership.institutionId)
      .eq('role', 'teacher')
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new NotFoundException('Docente no encontrado');
    return data;
  }

  /**
   * Membresía asignable a una materia: debe existir en la institución
   * activa y tener rol estrictamente 'teacher' (caso clave del backlog:
   * admin/director/guardian → 400).
   */
  private async teacherMembershipFor(membership: Membership, id: string) {
    if (typeof id !== 'string' || !UUID_RE.test(id)) {
      throw new BadRequestException('teacherMembershipId inválido');
    }
    const { data, error } = await this.supabase.admin
      .from('memberships')
      .select('id, user_id, role')
      .eq('id', id)
      .eq('institution_id', membership.institutionId)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      throw new BadRequestException(
        'La membresía asignada no pertenece a la institución',
      );
    }
    if (data.role !== 'teacher') {
      throw new BadRequestException(NOT_TEACHER_MSG);
    }

    const { data: profile, error: profileError } = await this.supabase.admin
      .from('profiles')
      .select('id, full_name')
      .eq('id', data.user_id)
      .maybeSingle();
    if (profileError) throw profileError;
    return { id: data.id, fullName: profile?.full_name ?? null };
  }

  /** Materia dentro de la institución activa (vía su curso). */
  private async subjectFor(membership: Membership, id: string) {
    if (typeof id !== 'string' || !UUID_RE.test(id)) {
      throw new BadRequestException('id de materia inválido');
    }
    const { data, error } = await this.supabase.admin
      .from('subjects')
      .select('id, course_id, courses!inner(id)')
      .eq('id', id)
      .eq('courses.institution_id', membership.institutionId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new NotFoundException('Materia no encontrada');
    return data;
  }

  /** Curso dentro de la institución activa. */
  private async courseFor(membership: Membership, courseId: string) {
    if (typeof courseId !== 'string' || !UUID_RE.test(courseId)) {
      throw new BadRequestException('courseId inválido');
    }
    const { data, error } = await this.supabase.admin
      .from('courses')
      .select('id, name, year, division, shift, school_year')
      .eq('id', courseId)
      .eq('institution_id', membership.institutionId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new NotFoundException('Curso no encontrado');
    return data;
  }

  /** Mapa membership_id → { id, fullName } para los docentes dados. */
  private async teachersById(ids: string[]) {
    const map = new Map<string, { id: string; fullName: string | null }>();
    if (!ids.length) return map;
    const { data, error } = await this.supabase.admin
      .from('memberships')
      .select('id, user_id')
      .in('id', ids);
    if (error) throw error;
    const rows = data ?? [];
    const userIds = unique(rows.map((m: any) => m.user_id));
    const profiles = new Map<string, string | null>();
    if (userIds.length) {
      const { data: profs, error: profsError } = await this.supabase.admin
        .from('profiles')
        .select('id, full_name')
        .in('id', userIds);
      if (profsError) throw profsError;
      for (const p of profs ?? []) profiles.set(p.id, p.full_name);
    }
    for (const m of rows) {
      map.set(m.id, {
        id: m.id,
        fullName: profiles.get(m.user_id) ?? null,
      });
    }
    return map;
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
          // Si la consulta a auth falla, el docente queda con email null.
        }
      }),
    );
    return result;
  }

  private validateListParams(params: ListTeachersParams) {
    const page = params.page ?? 1;
    const limit = params.limit ?? 25;
    if (!Number.isInteger(page) || page < 1) {
      throw new BadRequestException('page debe ser un entero mayor o igual a 1');
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new BadRequestException('limit debe ser un entero entre 1 y 100');
    }
    const status = params.status || undefined;
    if (
      status !== undefined &&
      !(TEACHER_STATUSES as readonly string[]).includes(status)
    ) {
      throw new BadRequestException(
        "status debe ser 'activo', 'licencia' o 'inactivo'",
      );
    }
    const employmentStatus = params.employmentStatus || undefined;
    if (
      employmentStatus !== undefined &&
      !(EMPLOYMENT_STATUSES as readonly string[]).includes(employmentStatus)
    ) {
      throw new BadRequestException(
        "employmentStatus debe ser 'titular', 'interino' o 'suplente'",
      );
    }
    const courseId = params.courseId;
    if (courseId !== undefined && !UUID_RE.test(courseId)) {
      throw new BadRequestException('courseId inválido');
    }
    const subjectId = params.subjectId;
    if (subjectId !== undefined && !UUID_RE.test(subjectId)) {
      throw new BadRequestException('subjectId inválido');
    }
    return { status, employmentStatus, courseId, subjectId, page, limit };
  }

  /**
   * Normaliza el término de búsqueda: escapa los comodines de LIKE y quita
   * los caracteres que romperían la sintaxis de or() de PostgREST.
   */
  private searchTerm(q?: string): string | null {
    if (typeof q !== 'string' || !q.trim()) return null;
    const term = q
      .trim()
      .replace(/[\\%_]/g, (m) => `\\${m}`)
      .replace(/[(),."']/g, ' ')
      .trim();
    return term || null;
  }

  /** Valida la edición y devuelve solo las columnas provistas. */
  private validateUpdate(dto: UpdateTeacherDto) {
    if (!dto || typeof dto !== 'object') {
      throw new BadRequestException('El cuerpo es obligatorio');
    }
    const changes: Record<string, unknown> = {};

    if (dto.fileNumber !== undefined) {
      changes.file_number = this.optionalText(dto.fileNumber);
    }
    if (dto.employmentStatus !== undefined) {
      if (
        !(EMPLOYMENT_STATUSES as readonly string[]).includes(
          dto.employmentStatus,
        )
      ) {
        throw new BadRequestException(
          "employmentStatus debe ser 'titular', 'interino' o 'suplente'",
        );
      }
      changes.employment_status = dto.employmentStatus;
    }
    if (dto.status !== undefined) {
      if (!(TEACHER_STATUSES as readonly string[]).includes(dto.status)) {
        throw new BadRequestException(
          "status debe ser 'activo', 'licencia' o 'inactivo'",
        );
      }
      changes.status = dto.status;
    }
    if (dto.maxWeeklyHours !== undefined) {
      const hours = dto.maxWeeklyHours;
      if (
        typeof hours !== 'number' ||
        !Number.isInteger(hours) ||
        hours < 0 ||
        hours > 80
      ) {
        throw new BadRequestException(
          'maxWeeklyHours debe ser un entero entre 0 y 80',
        );
      }
      changes.max_weekly_hours = hours;
    }
    if (dto.hiredAt !== undefined) {
      changes.hired_at = this.optionalDate(dto.hiredAt, 'hiredAt');
    }

    if (!Object.keys(changes).length) {
      throw new BadRequestException(
        'Debe enviar al menos un campo para actualizar',
      );
    }
    return changes;
  }

  private optionalText(value: unknown): string | null {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string') {
      throw new BadRequestException('El campo debe ser texto');
    }
    return value.trim() || null;
  }

  /** Fecha YYYY-MM-DD real (sin restricción de futuro/pasado), o null. */
  private optionalDate(value: unknown, field: string): string | null {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string' || !DATE_RE.test(value)) {
      throw new BadRequestException(`${field} debe tener formato YYYY-MM-DD`);
    }
    const parsed = new Date(`${value}T00:00:00Z`);
    if (
      Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== value
    ) {
      throw new BadRequestException(`${field} no es una fecha válida`);
    }
    return value;
  }

  private toAssignedSubject(
    row: any,
    teachers: Map<string, { id: string; fullName: string | null }>,
  ): AssignedSubject {
    const teacherId = row.teacher_membership_id;
    return {
      id: row.id,
      name: row.name,
      weeklyHours: weeklyHoursOf(row),
      course: mapCourse(Array.isArray(row.courses) ? row.courses[0] : row.courses),
      teacher: teacherId
        ? (teachers.get(teacherId) ?? { id: teacherId, fullName: null })
        : null,
    };
  }
}

function unique(values: (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v)))];
}

function profileOf(row: any) {
  return Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
}

function weeklyHoursOf(subject: any): number {
  const raw = subject?.weekly_hours;
  if (raw === null || raw === undefined) return DEFAULT_SUBJECT_WEEKLY_HOURS;
  const value = Number(raw);
  return Number.isFinite(value) ? value : DEFAULT_SUBJECT_WEEKLY_HOURS;
}

function mapCourse(c: any): TeacherCourseRef | null {
  if (!c) return null;
  const course = Array.isArray(c) ? c[0] : c;
  if (!course) return null;
  return {
    id: course.id,
    name: course.name ?? '',
    year: course.year ?? null,
    division: course.division ?? null,
    shift: course.shift ?? null,
    schoolYear: course.school_year ?? null,
  };
}

function mapSubjectSummary(s: any): TeacherSubjectSummary {
  const course = mapCourse(s.courses);
  return {
    id: s.id,
    name: s.name,
    weeklyHours: weeklyHoursOf(s),
    course: course
      ? {
          id: course.id,
          name: course.name,
          year: course.year,
          division: course.division,
          shift: course.shift,
        }
      : null,
  };
}

function mapDetailSubject(s: any) {
  return {
    id: s.id,
    name: s.name,
    weeklyHours: weeklyHoursOf(s),
    course: mapCourse(s.courses),
  };
}

function mapSummary(
  r: any,
  subjects: any[],
  email: string | null,
): TeacherSummary {
  const profile = profileOf(r);
  const courseIds = new Set(
    subjects.map((s) => s.course_id).filter(Boolean),
  );
  return {
    id: r.id,
    fullName: profile?.full_name ?? '',
    email,
    phone: profile?.phone ?? null,
    fileNumber: r.file_number ?? null,
    employmentStatus: r.employment_status ?? 'titular',
    status: r.status ?? 'activo',
    coursesCount: courseIds.size,
    subjects: subjects.map(mapSubjectSummary),
    weeklyHours: subjects.reduce((a, s) => a + weeklyHoursOf(s), 0),
    maxWeeklyHours: r.max_weekly_hours ?? DEFAULT_MAX_WEEKLY_HOURS,
  };
}

function mapRecord(r: any, email: string | null): TeacherRecord {
  const profile = profileOf(r);
  return {
    id: r.id,
    fullName: profile?.full_name ?? '',
    email,
    phone: profile?.phone ?? null,
    fileNumber: r.file_number ?? null,
    employmentStatus: r.employment_status ?? 'titular',
    status: r.status ?? 'activo',
    maxWeeklyHours: r.max_weekly_hours ?? DEFAULT_MAX_WEEKLY_HOURS,
    hiredAt: r.hired_at ?? null,
  };
}

/**
 * Antigüedad cumplida (años y meses) entre hired_at y hoy; null si el
 * docente todavía no tiene fecha de alta cargada.
 */
function seniorityFrom(
  hiredAt: string | null | undefined,
): { years: number; months: number } | null {
  if (!hiredAt) return null;
  const start = new Date(`${String(hiredAt).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) return null;
  const now = new Date();
  let years = now.getUTCFullYear() - start.getUTCFullYear();
  let months = now.getUTCMonth() - start.getUTCMonth();
  if (now.getUTCDate() < start.getUTCDate()) months -= 1;
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  if (years < 0) return { years: 0, months: 0 };
  return { years, months };
}
