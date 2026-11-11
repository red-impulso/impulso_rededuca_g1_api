import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Membership } from '../../auth/membership.guard.js';
import { storeExport, toCsv } from '../../common/export-storage.js';
import { SupabaseService } from '../../supabase/supabase.service.js';
import type { AssignTeacherDto } from './dto/assign-teacher.dto.js';
import type { CreateTeacherDto } from './dto/create-teacher.dto.js';
import type { UpdateCourseAssignmentsDto } from './dto/course-assignments.dto.js';
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
  dni: string | null;
  address: string | null;
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

export interface TeacherScheduleEntry {
  day: number;
  start: string;
  end: string;
  subjectId: string;
  subjectName: string;
  courseName: string | null;
}

export interface TeacherActivityItem {
  id: string;
  kind: 'grade' | 'attendance' | 'announcement' | 'event';
  title: string;
  occurredAt: string;
}

export interface TeacherDetail {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  dni: string | null;
  address: string | null;
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
  schedule: TeacherScheduleEntry[];
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

export interface TeacherCandidate {
  id: string;
  fullName: string;
  status: string;
  weeklyHours: number;
  maxWeeklyHours: number;
  conflict: string | null;
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

export interface TeacherCounts {
  all: number;
  activo: number;
  licencia: number;
  inactivo: number;
}

export interface TeacherImportResult {
  created: number;
  updated: number;
  errors: { row: number; message: string }[];
}

export interface ListTeachersParams {
  q?: string;
  status?: string;
  employmentStatus?: string;
  courseId?: string;
  subjectId?: string;
  shift?: string;
  sort?: string;
  page?: number;
  limit?: number;
}

interface UploadedFile {
  originalname?: string;
  mimetype?: string;
  size?: number;
  buffer?: Buffer;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const DEFAULT_MAX_WEEKLY_HOURS = 30;
const DEFAULT_SUBJECT_WEEKLY_HOURS = 4;

const TEACHER_SORTS = ['name', 'fileNumber', '-weeklyHours'] as const;

const IMPORT_MAX_BYTES = 2 * 1024 * 1024;

const NOT_TEACHER_MSG = 'La membresía asignada debe tener rol de docente';
const INACTIVE_TEACHER_MSG = 'No se puede asignar un docente inactivo';
const OVER_HOURS_MSG =
  'El docente supera su límite de horas semanales con esta asignación';
const ALREADY_MEMBER_MSG = 'El docente ya es miembro de esta institución';

const TEACHER_COLUMNS =
  'id, user_id, file_number, employment_status, status, max_weekly_hours, hired_at, created_at, profiles!inner(full_name, phone, dni, address)';

const SUBJECT_COLUMNS =
  'id, name, weekly_hours, teacher_membership_id, course_id, courses!inner(id, name, year, division, shift, school_year, institution_id)';

const IMPORT_HEADER_MAP: Record<string, string> = {
  fullname: 'fullName',
  nombre: 'fullName',
  email: 'email',
  phone: 'phone',
  telefono: 'phone',
  filenumber: 'fileNumber',
  legajo: 'fileNumber',
  employmentstatus: 'employmentStatus',
  situacionrevista: 'employmentStatus',
  status: 'status',
  estado: 'status',
  maxweeklyhours: 'maxWeeklyHours',
  horasmaximas: 'maxWeeklyHours',
  hiredat: 'hiredAt',
  fechaalta: 'hiredAt',
};

@Injectable()
export class TeachersService {
  constructor(private readonly supabase: SupabaseService) {}

  /**
   * Listado paginado de docentes (memberships con role 'teacher') de la
   * institución activa, ordenado por nombre. Filtros opcionales: `q`
   * (nombre o legajo, insensible a mayúsculas), `status`,
   * `employmentStatus`, `courseId`, `subjectId` y `shift` (sobre el ciclo
   * lectivo activo). `sort` admite 'name' (default), 'fileNumber' y
   * '-weeklyHours'. Cada elemento trae sus materias del ciclo lectivo
   * activo con la carga horaria acumulada.
   */
  async list(
    membership: Membership,
    params: ListTeachersParams = {},
  ): Promise<TeacherListResult> {
    this.assertStaff(membership);
    const {
      status,
      employmentStatus,
      courseId,
      subjectId,
      shift,
      sort,
      page,
      limit,
    } = this.validateListParams(params);
    const term = this.searchTerm(params.q);
    const sensitive = this.canSeeSensitive(membership);

    const institutionId = membership.institutionId;
    const activeYear = await this.activeSchoolYear(institutionId);

    let query = this.supabase.admin
      .from('memberships')
      .select(TEACHER_COLUMNS, { count: 'exact' })
      .eq('institution_id', institutionId)
      .eq('role', 'teacher');
    if (status) query = query.eq('status', status);
    if (employmentStatus) query = query.eq('employment_status', employmentStatus);

    if (term) {
      const ids = await this.teacherIdsMatching(institutionId, term);
      if (!ids.length) return { data: [], total: 0, page, limit };
      query = query.in('id', ids);
    }
    if (courseId || subjectId || shift) {
      const ids = await this.teacherIdsTeaching(institutionId, activeYear, {
        courseId,
        subjectId,
        shift,
      });
      if (!ids.length) return { data: [], total: 0, page, limit };
      query = query.in('id', ids);
    }

    const from = (page - 1) * limit;
    const inMemorySort = sort === '-weeklyHours';
    if (!inMemorySort) {
      if (sort === 'fileNumber') {
        query = query
          .order('file_number', { nullsFirst: false })
          .order('created_at');
      } else {
        query = query
          .order('full_name', { referencedTable: 'profiles' })
          .order('created_at');
      }
      query = query.range(from, from + limit - 1);
    }

    const { data, count, error } = await query;
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

    let items = rows.map((r: any) =>
      mapSummary(
        r,
        subjectsByTeacher.get(r.id) ?? [],
        emails.get(r.user_id) ?? null,
        sensitive,
      ),
    );
    let total = count ?? rows.length;
    if (inMemorySort) {
      items = items
        .slice()
        .sort(
          (a, b) =>
            b.weeklyHours - a.weeklyHours || a.fullName.localeCompare(b.fullName),
        );
      total = items.length;
      items = items.slice(from, from + limit);
    }

    return { data: items, total, page, limit };
  }

  /** Conteo de docentes por estado laboral para las solapas del listado. */
  async counts(membership: Membership): Promise<TeacherCounts> {
    this.assertStaff(membership);
    const institutionId = membership.institutionId;
    const count = async (status?: string) => {
      let query = this.supabase.admin
        .from('memberships')
        .select('id', { count: 'exact', head: true })
        .eq('institution_id', institutionId)
        .eq('role', 'teacher');
      if (status) query = query.eq('status', status);
      const { count: total, error } = await query;
      if (error) throw error;
      return total ?? 0;
    };
    const [all, activo, licencia, inactivo] = await Promise.all([
      count(),
      count('activo'),
      count('licencia'),
      count('inactivo'),
    ]);
    return { all, activo, licencia, inactivo };
  }

  /**
   * Alta integral de docente: crea el usuario en Auth si no existe (o lo
   * reutiliza por email), asegura su perfil y crea la membresía con rol
   * 'teacher' en la institución activa. Rechaza con 409 si el usuario ya
   * tiene membresía docente en la institución.
   */
  async create(
    membership: Membership,
    dto: CreateTeacherDto,
  ): Promise<TeacherRecord> {
    this.assertStaff(membership);
    const input = this.validateCreate(dto);
    const institutionId = membership.institutionId;

    const existing = await this.findAuthUserByEmail(input.email);
    let userId: string;
    if (existing) {
      userId = existing.id;
    } else {
      const { data, error } = await this.supabase.admin.auth.admin
        .createUser({ email: input.email, email_confirm: true });
      if (error) throw error;
      if (!data?.user) {
        throw new BadRequestException('No se pudo crear el usuario en auth');
      }
      userId = data.user.id;
    }

    const { data: prev, error: prevError } = await this.supabase.admin
      .from('memberships')
      .select('id')
      .eq('user_id', userId)
      .eq('institution_id', institutionId)
      .eq('role', 'teacher');
    if (prevError) throw prevError;
    if (prev?.length) throw new ConflictException(ALREADY_MEMBER_MSG);

    await this.ensureProfile(userId, {
      fullName: input.fullName,
      phone: input.phone,
    });

    const { data: created, error: insertError } = await this.supabase.admin
      .from('memberships')
      .insert({
        user_id: userId,
        institution_id: institutionId,
        role: 'teacher',
        status: input.status,
        file_number: input.fileNumber,
        employment_status: input.employmentStatus,
        max_weekly_hours: input.maxWeeklyHours,
        hired_at: input.hiredAt,
      })
      .select(TEACHER_COLUMNS)
      .single();
    if (insertError) throw insertError;

    return mapRecord(created, input.email);
  }

  /**
   * Ficha completa del docente para la pantalla de detalle: datos
   * personales y laborales, KPIs (carga horaria vs límite, materias,
   * cursos a cargo y alumnos alcanzados), materias del ciclo lectivo
   * activo y la grilla semanal mapeada desde esas materias.
   */
  async detail(membership: Membership, id: string): Promise<TeacherDetail> {
    this.assertStaff(membership);
    const teacher = await this.teacherFor(membership, id);
    const sensitive = this.canSeeSensitive(membership);

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
      dni: sensitive ? (profile?.dni ?? null) : null,
      address: sensitive ? (profile?.address ?? null) : null,
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
      schedule: scheduleFrom(subjects),
    };
  }

  /**
   * Actividad reciente del docente: cambios de notas, registros de
   * asistencia y comunicados que creó, ordenados por fecha descendente.
   */
  async activity(
    membership: Membership,
    id: string,
    limit = 10,
  ): Promise<{ data: TeacherActivityItem[] }> {
    this.assertStaff(membership);
    const teacher = await this.teacherFor(membership, id);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new BadRequestException('limit debe ser un entero entre 1 y 50');
    }
    const institutionId = membership.institutionId;
    const userId = teacher.user_id as string;

    const [gradeChanges, attendance, announcements] = await Promise.all([
      this.supabase.admin
        .from('grade_changes')
        .select('id, created_at')
        .eq('institution_id', institutionId)
        .eq('changed_by', userId)
        .order('created_at', { ascending: false })
        .limit(limit),
      this.supabase.admin
        .from('attendance_records')
        .select('id, date, created_at')
        .eq('institution_id', institutionId)
        .eq('recorded_by', userId)
        .order('created_at', { ascending: false })
        .limit(limit),
      this.supabase.admin
        .from('announcements')
        .select('id, title, created_at')
        .eq('institution_id', institutionId)
        .eq('author_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit),
    ]);
    if (gradeChanges.error) throw gradeChanges.error;
    if (attendance.error) throw attendance.error;
    if (announcements.error) throw announcements.error;

    const events: TeacherActivityItem[] = [];
    for (const g of gradeChanges.data ?? []) {
      events.push({
        id: `grade-${g.id}`,
        kind: 'grade',
        title: 'Actualizó una calificación',
        occurredAt: g.created_at ?? '',
      });
    }
    for (const a of attendance.data ?? []) {
      events.push({
        id: `attendance-${a.id}`,
        kind: 'attendance',
        title: `Registró asistencia del ${a.date}`,
        occurredAt: a.created_at ?? `${a.date}T00:00:00.000Z`,
      });
    }
    for (const a of announcements.data ?? []) {
      events.push({
        id: `announcement-${a.id}`,
        kind: 'announcement',
        title: a.title,
        occurredAt: a.created_at ?? '',
      });
    }
    events.sort((x, y) => (x.occurredAt < y.occurredAt ? 1 : -1));
    return { data: events.slice(0, limit) };
  }

  /**
   * Docentes candidatos para una asignación: todos los docentes de la
   * institución con su carga horaria actual, su límite y el conflicto que
   * impediría asignarlos (inactivo, de licencia o sin horas disponibles
   * para la materia indicada).
   */
  async candidates(
    membership: Membership,
    filter: { courseId?: string; subjectId?: string } = {},
  ): Promise<TeacherCandidate[]> {
    this.assertStaff(membership);
    const { courseId, subjectId } = this.validateCandidateParams(filter);
    const institutionId = membership.institutionId;

    if (courseId) await this.courseFor(membership, courseId);
    let subjectHours = 0;
    if (subjectId) {
      const subject = await this.subjectFor(membership, subjectId);
      subjectHours = weeklyHoursOf(subject);
    }

    const activeYear = await this.activeSchoolYear(institutionId);
    const { data, error } = await this.supabase.admin
      .from('memberships')
      .select(TEACHER_COLUMNS)
      .eq('institution_id', institutionId)
      .eq('role', 'teacher')
      .order('full_name', { referencedTable: 'profiles' });
    if (error) throw error;

    const rows = data ?? [];
    const subjectsByTeacher = await this.subjectsByTeacher(
      institutionId,
      rows.map((r: any) => r.id as string),
      activeYear,
    );

    return rows.map((r: any) => {
      const profile = profileOf(r);
      const status = r.status ?? 'activo';
      const weeklyHours = (subjectsByTeacher.get(r.id) ?? []).reduce(
        (a: number, s: any) => a + weeklyHoursOf(s),
        0,
      );
      const maxWeeklyHours = r.max_weekly_hours ?? DEFAULT_MAX_WEEKLY_HOURS;
      let conflict: string | null = null;
      if (status === 'inactivo') conflict = 'El docente está inactivo';
      else if (status === 'licencia') conflict = 'El docente está de licencia';
      else if (weeklyHours + subjectHours > maxWeeklyHours) {
        conflict = 'Supera el límite de horas semanales';
      }
      return {
        id: r.id,
        fullName: profile?.full_name ?? '',
        status,
        weeklyHours,
        maxWeeklyHours,
        conflict,
      };
    });
  }

  /**
   * Edita los datos personales (nombre, email, teléfono → auth/profile) y
   * laborales (legajo, situación de revista, estado, límite horario y
   * fecha de alta → memberships) del docente dentro de la institución
   * activa. Rechaza con 404 si la membresía docente no existe en ella.
   */
  async update(
    membership: Membership,
    id: string,
    dto: UpdateTeacherDto,
  ): Promise<TeacherRecord> {
    this.assertStaff(membership);
    const teacher = await this.teacherFor(membership, id);
    const { membershipChanges, profileChanges, email } =
      this.validateUpdate(dto);

    if (Object.keys(profileChanges).length) {
      const { error } = await this.supabase.admin
        .from('profiles')
        .update(profileChanges)
        .eq('id', teacher.user_id);
      if (error) throw error;
    }
    if (email !== undefined) {
      await this.updateAuthEmail(teacher.user_id, email);
    }

    let row = teacher;
    if (Object.keys(membershipChanges).length) {
      const { data, error } = await this.supabase.admin
        .from('memberships')
        .update(membershipChanges)
        .eq('id', id)
        .eq('institution_id', membership.institutionId)
        .eq('role', 'teacher')
        .select(TEACHER_COLUMNS)
        .single();
      if (error) throw error;
      row = data;
    } else if (Object.keys(profileChanges).length) {
      // Relee la membresía para devolver el perfil actualizado.
      row = await this.teacherFor(membership, id);
    }

    const emails = await this.emailsByUserId([row.user_id]);
    return mapRecord(row, email ?? emails.get(row.user_id) ?? null);
  }

  /**
   * Asigna (o desasigna con null) el docente de una materia de la
   * institución activa. Rechaza con 404 si la materia no pertenece a la
   * institución, con 400 si la membresía no existe o no tiene rol
   * 'teacher' y con 409 si el docente está inactivo o la asignación lo
   * deja por encima de su límite de horas semanales.
   */
  async assignTeacher(
    membership: Membership,
    subjectId: string,
    dto: AssignTeacherDto,
  ): Promise<AssignedSubject> {
    this.assertStaff(membership);
    const subject = await this.subjectFor(membership, subjectId);
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
      await this.assertAssignable(
        membership,
        teacher.id,
        weeklyHoursOf(subject),
        subject.teacher_membership_id === teacher.id
          ? weeklyHoursOf(subject)
          : 0,
      );
    }

    const { data, error } = await this.supabase.admin
      .from('subjects')
      .update({
        teacher_membership_id: teacher?.id ?? null,
        updated_at: new Date().toISOString(),
      })
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
   * Actualización en lote de las asignaciones docentes de un curso. Cada
   * entrada fija (o limpia con null) el docente de una materia del curso.
   * Rechaza con 409 si algún docente está inactivo o quedaría por encima
   * de su límite de horas semanales; no aplica cambios parciales.
   */
  async setCourseAssignments(
    membership: Membership,
    courseId: string,
    dto: UpdateCourseAssignmentsDto,
  ): Promise<CourseAssignments> {
    this.assertStaff(membership);
    await this.courseFor(membership, courseId);
    if (!dto || !Array.isArray(dto.assignments)) {
      throw new BadRequestException('assignments debe ser un arreglo');
    }

    const { data: subjects, error: subjectsError } = await this.supabase.admin
      .from('subjects')
      .select('id, name, weekly_hours, teacher_membership_id')
      .eq('course_id', courseId);
    if (subjectsError) throw subjectsError;
    const subjectById = new Map(
      (subjects ?? []).map((s: any) => [s.id as string, s]),
    );

    const assignments = dto.assignments.map((a: any) => {
      if (typeof a?.subjectId !== 'string' || !UUID_RE.test(a.subjectId)) {
        throw new BadRequestException('subjectId inválido');
      }
      if (!subjectById.has(a.subjectId)) {
        throw new BadRequestException(
          'subjectId no pertenece a las materias del curso',
        );
      }
      if (
        a.teacherMembershipId !== null &&
        (typeof a.teacherMembershipId !== 'string' ||
          !UUID_RE.test(a.teacherMembershipId))
      ) {
        throw new BadRequestException('teacherMembershipId inválido');
      }
      return {
        subjectId: a.subjectId as string,
        teacherMembershipId: a.teacherMembershipId as string | null,
      };
    });

    const teacherIds = unique(
      assignments.map((a) => a.teacherMembershipId),
    );
    if (teacherIds.length) {
      await this.teacherRowsFor(membership, teacherIds);
    }
    const institutionId = membership.institutionId;
    const activeYear = await this.activeSchoolYear(institutionId);

    // Proyección por docente: horas actuales (descontando las materias del
    // payload que ya le pertenecían) + horas de todas las materias que el
    // lote le asigna. Así se acumulan varias asignaciones al mismo docente.
    const payloadSubjectIds = new Set(assignments.map((a) => a.subjectId));
    const payloadHours = new Map<string, number>();
    for (const a of assignments) {
      if (!a.teacherMembershipId) continue;
      const hours = weeklyHoursOf(subjectById.get(a.subjectId));
      payloadHours.set(
        a.teacherMembershipId,
        (payloadHours.get(a.teacherMembershipId) ?? 0) + hours,
      );
    }
    if (teacherIds.length) {
      const teacherRows = await this.teacherRowsFor(membership, teacherIds);
      const subjectsByTeacher = await this.subjectsByTeacher(
        institutionId,
        teacherIds,
        activeYear,
      );
      for (const id of teacherIds) {
        const teacher = teacherRows.get(id)!;
        const max = teacher.max_weekly_hours ?? DEFAULT_MAX_WEEKLY_HOURS;
        const current = (subjectsByTeacher.get(id) ?? []).reduce(
          (acc: number, s: any) =>
            acc + (payloadSubjectIds.has(s.id) ? 0 : weeklyHoursOf(s)),
          0,
        );
        if (current + (payloadHours.get(id) ?? 0) > max) {
          throw new ConflictException(OVER_HOURS_MSG);
        }
      }
    }

    for (const a of assignments) {
      const { error } = await this.supabase.admin
        .from('subjects')
        .update({
          teacher_membership_id: a.teacherMembershipId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', a.subjectId)
        .eq('course_id', courseId);
      if (error) throw error;
    }

    return this.courseAssignments(membership, courseId);
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

  /**
   * Exporta docentes de la institución (todos o los ids indicados) a CSV y
   * devuelve el enlace de descarga.
   */
  async exportCsv(
    membership: Membership,
    ids?: string[],
  ): Promise<{ url: string }> {
    this.assertStaff(membership);
    const institutionId = membership.institutionId;
    const cleanIds = (ids ?? []).filter((id) => UUID_RE.test(id));

    let query = this.supabase.admin
      .from('memberships')
      .select(TEACHER_COLUMNS)
      .eq('institution_id', institutionId)
      .eq('role', 'teacher')
      .order('full_name', { referencedTable: 'profiles' });
    if (cleanIds.length) query = query.in('id', cleanIds);
    const { data, error } = await query;
    if (error) throw error;

    const rows = data ?? [];
    const activeYear = await this.activeSchoolYear(institutionId);
    const subjectsByTeacher = await this.subjectsByTeacher(
      institutionId,
      rows.map((r: any) => r.id as string),
      activeYear,
    );
    const emails = await this.emailsByUserId(
      unique(rows.map((r: any) => r.user_id as string)),
    );

    const csv = toCsv(
      [
        'membershipId',
        'fullName',
        'email',
        'phone',
        'fileNumber',
        'employmentStatus',
        'status',
        'weeklyHours',
        'maxWeeklyHours',
        'hiredAt',
      ],
      rows.map((r: any) => {
        const profile = profileOf(r);
        return [
          r.id,
          profile?.full_name ?? '',
          emails.get(r.user_id) ?? null,
          profile?.phone ?? null,
          r.file_number ?? null,
          r.employment_status ?? 'titular',
          r.status ?? 'activo',
          (subjectsByTeacher.get(r.id) ?? []).reduce(
            (a: number, s: any) => a + weeklyHoursOf(s),
            0,
          ),
          r.max_weekly_hours ?? DEFAULT_MAX_WEEKLY_HOURS,
          r.hired_at ?? null,
        ];
      }),
    );
    const url = await storeExport(
      this.supabase.admin,
      `teachers/${institutionId}-${Date.now()}.csv`,
      csv,
      'text/csv',
    );
    return { url };
  }

  /**
   * Importa docentes desde un CSV (mismas columnas que la exportación).
   * Para cada fila crea el usuario en auth si no existe, asegura su
   * perfil y crea o actualiza la membresía docente; devuelve el conteo
   * de altas/actualizaciones y los errores por fila.
   */
  async importCsv(
    membership: Membership,
    file: UploadedFile | undefined,
  ): Promise<TeacherImportResult> {
    this.assertStaff(membership);
    if (!file?.buffer?.length) {
      throw new BadRequestException('Debe adjuntar un archivo CSV');
    }
    if ((file.size ?? file.buffer.length) > IMPORT_MAX_BYTES) {
      throw new BadRequestException('El archivo no puede superar los 2MB');
    }

    const rows = parseCsv(file.buffer.toString('utf8'));
    if (!rows.length) {
      throw new BadRequestException('El CSV está vacío o no tiene filas');
    }
    const headers = rows[0].map((h) => IMPORT_HEADER_MAP[normalizeKey(h)]);
    if (!headers.includes('fullName') || !headers.includes('email')) {
      throw new BadRequestException(
        'El CSV debe incluir las columnas fullName y email',
      );
    }

    const result: TeacherImportResult = { created: 0, updated: 0, errors: [] };
    for (let i = 1; i < rows.length; i += 1) {
      const cells = rows[i];
      if (cells.every((c) => !c.trim())) continue;
      const record: Record<string, string> = {};
      headers.forEach((key, j) => {
        if (key) record[key] = (cells[j] ?? '').trim();
      });
      try {
        const outcome = await this.importRow(membership, record);
        if (outcome === 'created') result.created += 1;
        else result.updated += 1;
      } catch (e) {
        result.errors.push({
          row: i + 1,
          message: e instanceof Error ? e.message : 'Fila inválida',
        });
      }
    }
    return result;
  }

  /** Procesa una fila del CSV: alta o actualización de la membresía. */
  private async importRow(
    membership: Membership,
    record: Record<string, string>,
  ): Promise<'created' | 'updated'> {
    const email = record.email?.toLowerCase();
    if (!email || !EMAIL_RE.test(email)) {
      throw new BadRequestException('email inválido');
    }
    const fullName = record.fullName?.trim();
    if (!fullName) throw new BadRequestException('fullName es obligatorio');

    const employmentStatus = record.employmentStatus || 'titular';
    if (!(EMPLOYMENT_STATUSES as readonly string[]).includes(employmentStatus)) {
      throw new BadRequestException(
        "employmentStatus debe ser 'titular', 'interino' o 'suplente'",
      );
    }
    const status = record.status || 'activo';
    if (!(TEACHER_STATUSES as readonly string[]).includes(status)) {
      throw new BadRequestException(
        "status debe ser 'activo', 'licencia' o 'inactivo'",
      );
    }
    const maxWeeklyHours = record.maxWeeklyHours
      ? Number(record.maxWeeklyHours)
      : DEFAULT_MAX_WEEKLY_HOURS;
    if (
      !Number.isInteger(maxWeeklyHours) ||
      maxWeeklyHours < 0 ||
      maxWeeklyHours > 80
    ) {
      throw new BadRequestException('maxWeeklyHours inválido');
    }
    const hiredAt = record.hiredAt || null;
    if (hiredAt && !DATE_RE.test(hiredAt)) {
      throw new BadRequestException('hiredAt debe tener formato YYYY-MM-DD');
    }
    const fields = {
      file_number: record.fileNumber || null,
      employment_status: employmentStatus,
      status,
      max_weekly_hours: maxWeeklyHours,
      hired_at: hiredAt,
      updated_at: new Date().toISOString(),
    };

    const existing = await this.findAuthUserByEmail(email);
    let userId: string;
    if (existing) {
      userId = existing.id;
    } else {
      const { data, error } = await this.supabase.admin.auth.admin
        .createUser({ email, email_confirm: true });
      if (error) throw new BadRequestException('No se pudo crear el usuario');
      userId = data.user.id;
    }
    await this.ensureProfile(userId, {
      fullName,
      phone: record.phone || null,
    });

    const institutionId = membership.institutionId;
    const { data: prev, error: prevError } = await this.supabase.admin
      .from('memberships')
      .select('id')
      .eq('user_id', userId)
      .eq('institution_id', institutionId)
      .eq('role', 'teacher')
      .maybeSingle();
    if (prevError) throw prevError;

    if (prev) {
      const { error } = await this.supabase.admin
        .from('memberships')
        .update(fields)
        .eq('id', prev.id);
      if (error) throw error;
      return 'updated';
    }
    const { error } = await this.supabase.admin
      .from('memberships')
      .insert({
        user_id: userId,
        institution_id: institutionId,
        role: 'teacher',
        ...fields,
      });
    if (error) throw error;
    return 'created';
  }

  /** Solo admin/director pueden gestionar docentes y sus asignaciones. */
  private assertStaff(membership: Membership) {
    if (membership.role !== 'admin' && membership.role !== 'director') {
      throw new ForbiddenException(
        'Solo admin o director pueden gestionar los docentes',
      );
    }
  }

  /** dni/address solo se exponen a admin/director. */
  private canSeeSensitive(membership: Membership) {
    return membership.role === 'admin' || membership.role === 'director';
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
   * Ids de membresías docentes que dictan al menos una materia del curso,
   * la materia o el turno indicados, dentro del ciclo lectivo activo.
   */
  private async teacherIdsTeaching(
    institutionId: string,
    activeYear: number | null,
    filter: { courseId?: string; subjectId?: string; shift?: string },
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
    if (filter.shift) query = query.eq('courses.shift', filter.shift);
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
   * Membresías docentes de la institución por ids; rechaza con 400 si
   * alguna no existe, no pertenece a la institución o no es docente, y
   * con 409 si está inactiva.
   */
  private async teacherRowsFor(membership: Membership, ids: string[]) {
    const { data, error } = await this.supabase.admin
      .from('memberships')
      .select('id, user_id, role, status, max_weekly_hours')
      .eq('institution_id', membership.institutionId)
      .in('id', ids);
    if (error) throw error;
    const map = new Map<string, any>(
      (data ?? []).map((m: any) => [m.id as string, m]),
    );
    for (const id of ids) {
      const row = map.get(id);
      if (!row) {
        throw new BadRequestException(
          'La membresía asignada no pertenece a la institución',
        );
      }
      if (row.role !== 'teacher') throw new BadRequestException(NOT_TEACHER_MSG);
      if (row.status === 'inactivo') {
        throw new ConflictException(INACTIVE_TEACHER_MSG);
      }
    }
    return map;
  }

  /**
   * Rechaza con 409 si la asignación de `subjectHours` horas adicionales
   * dejaría al docente por encima de su límite semanal (default 30).
   * `excludeHours` descuenta la carga de la materia cuando el docente ya
   * la tenía asignada (reasignación sobre sí mismo).
   */
  private async assertAssignable(
    membership: Membership,
    teacherId: string,
    subjectHours: number,
    excludeHours: number,
  ) {
    const institutionId = membership.institutionId;
    const activeYear = await this.activeSchoolYear(institutionId);

    const { data: row, error } = await this.supabase.admin
      .from('memberships')
      .select('id, status, max_weekly_hours')
      .eq('id', teacherId)
      .maybeSingle();
    if (error) throw error;
    if (row?.status === 'inactivo') {
      throw new ConflictException(INACTIVE_TEACHER_MSG);
    }
    const max = row?.max_weekly_hours ?? DEFAULT_MAX_WEEKLY_HOURS;

    const subjects = await this.subjectsByTeacher(
      institutionId,
      [teacherId],
      activeYear,
    );
    const current = Math.max(
      0,
      (subjects.get(teacherId) ?? []).reduce(
        (a: number, s: any) => a + weeklyHoursOf(s),
        0,
      ) - excludeHours,
    );
    if (current + subjectHours > max) {
      throw new ConflictException(OVER_HOURS_MSG);
    }
  }

  /**
   * Membresía asignable a una materia: debe existir en la institución
   * activa y tener rol estrictamente 'teacher' (caso clave del backlog:
   * admin/director/guardian → 400). Estado 'inactivo' → 409.
   */
  private async teacherMembershipFor(membership: Membership, id: string) {
    if (typeof id !== 'string' || !UUID_RE.test(id)) {
      throw new BadRequestException('teacherMembershipId inválido');
    }
    const { data, error } = await this.supabase.admin
      .from('memberships')
      .select('id, user_id, role, status, max_weekly_hours')
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
    if (data.status === 'inactivo') {
      throw new ConflictException(INACTIVE_TEACHER_MSG);
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
      .select(
        'id, course_id, weekly_hours, teacher_membership_id, courses!inner(id)',
      )
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

  /**
   * Crea la fila en profiles si el usuario todavía no la tiene; una
   * existente no se toca (el perfil es global del usuario, no por
   * institución).
   */
  private async ensureProfile(
    userId: string,
    input: { fullName: string; phone?: string | null },
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
        phone: input.phone ?? null,
      });
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
          'No se pudo actualizar el email del docente',
        );
      }
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      throw new BadRequestException(
        'No se pudo actualizar el email del docente',
      );
    }
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
    const shift = params.shift || undefined;
    if (
      shift !== undefined &&
      !['morning', 'afternoon', 'evening'].includes(shift)
    ) {
      throw new BadRequestException(
        "shift debe ser 'morning', 'afternoon' o 'evening'",
      );
    }
    const sort = params.sort || undefined;
    if (
      sort !== undefined &&
      !(TEACHER_SORTS as readonly string[]).includes(sort)
    ) {
      throw new BadRequestException(
        "sort debe ser 'name', 'fileNumber' o '-weeklyHours'",
      );
    }
    return {
      status,
      employmentStatus,
      courseId,
      subjectId,
      shift,
      sort,
      page,
      limit,
    };
  }

  private validateCandidateParams(filter: {
    courseId?: string;
    subjectId?: string;
  }) {
    const courseId = filter.courseId || undefined;
    if (courseId !== undefined && !UUID_RE.test(courseId)) {
      throw new BadRequestException('courseId inválido');
    }
    const subjectId = filter.subjectId || undefined;
    if (subjectId !== undefined && !UUID_RE.test(subjectId)) {
      throw new BadRequestException('subjectId inválido');
    }
    return { courseId, subjectId };
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

  /** Valida y normaliza el alta de docente. */
  private validateCreate(dto: CreateTeacherDto) {
    if (!dto || typeof dto !== 'object') {
      throw new BadRequestException('El cuerpo es obligatorio');
    }
    const fullName =
      typeof dto.fullName === 'string' ? dto.fullName.trim() : '';
    if (!fullName) {
      throw new BadRequestException('fullName es obligatorio');
    }
    const email =
      typeof dto.email === 'string' ? dto.email.trim().toLowerCase() : '';
    if (!EMAIL_RE.test(email)) {
      throw new BadRequestException('email inválido');
    }
    const employmentStatus = dto.employmentStatus ?? 'titular';
    if (
      !(EMPLOYMENT_STATUSES as readonly string[]).includes(employmentStatus)
    ) {
      throw new BadRequestException(
        "employmentStatus debe ser 'titular', 'interino' o 'suplente'",
      );
    }
    const status = dto.status ?? 'activo';
    if (!(TEACHER_STATUSES as readonly string[]).includes(status)) {
      throw new BadRequestException(
        "status debe ser 'activo', 'licencia' o 'inactivo'",
      );
    }
    const maxWeeklyHours = dto.maxWeeklyHours ?? DEFAULT_MAX_WEEKLY_HOURS;
    if (
      !Number.isInteger(maxWeeklyHours) ||
      maxWeeklyHours < 0 ||
      maxWeeklyHours > 80
    ) {
      throw new BadRequestException(
        'maxWeeklyHours debe ser un entero entre 0 y 80',
      );
    }
    return {
      fullName,
      email,
      phone: this.optionalText(dto.phone),
      fileNumber: this.optionalText(dto.fileNumber),
      employmentStatus,
      status,
      maxWeeklyHours,
      hiredAt: this.optionalDate(dto.hiredAt, 'hiredAt'),
    };
  }

  /** Valida la edición y separa columnas de memberships, profiles y auth. */
  private validateUpdate(dto: UpdateTeacherDto) {
    if (!dto || typeof dto !== 'object') {
      throw new BadRequestException('El cuerpo es obligatorio');
    }
    const membershipChanges: Record<string, unknown> = {};
    const profileChanges: Record<string, unknown> = {};
    let email: string | undefined;

    if (dto.fullName !== undefined) {
      const name = dto.fullName.trim();
      if (!name) {
        throw new BadRequestException('fullName no puede estar vacío');
      }
      profileChanges.full_name = name;
    }
    if (dto.email !== undefined) {
      const normalized = dto.email.trim().toLowerCase();
      if (!EMAIL_RE.test(normalized)) {
        throw new BadRequestException('email inválido');
      }
      email = normalized;
    }
    if (dto.phone !== undefined) {
      profileChanges.phone = this.optionalText(dto.phone);
    }
    if (dto.fileNumber !== undefined) {
      membershipChanges.file_number = this.optionalText(dto.fileNumber);
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
      membershipChanges.employment_status = dto.employmentStatus;
    }
    if (dto.status !== undefined) {
      if (!(TEACHER_STATUSES as readonly string[]).includes(dto.status)) {
        throw new BadRequestException(
          "status debe ser 'activo', 'licencia' o 'inactivo'",
        );
      }
      membershipChanges.status = dto.status;
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
      membershipChanges.max_weekly_hours = hours;
    }
    if (dto.hiredAt !== undefined) {
      membershipChanges.hired_at = this.optionalDate(dto.hiredAt, 'hiredAt');
    }

    if (
      !Object.keys(membershipChanges).length &&
      !Object.keys(profileChanges).length &&
      email === undefined
    ) {
      throw new BadRequestException(
        'Debe enviar al menos un campo para actualizar',
      );
    }
    if (Object.keys(membershipChanges).length) {
      membershipChanges.updated_at = new Date().toISOString();
    }
    return { membershipChanges, profileChanges, email };
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
  sensitive: boolean,
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
    dni: sensitive ? (profile?.dni ?? null) : null,
    address: sensitive ? (profile?.address ?? null) : null,
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

/**
 * Grilla semanal derivada de las materias del docente (no existe tabla de
 * horarios): cada materia ocupa un bloque de una hora, distribuidas
 * cíclicamente de lunes (1) a viernes (5) a partir de las 08:00.
 */
function scheduleFrom(subjects: any[]): TeacherScheduleEntry[] {
  const slotsByDay = new Map<number, number>();
  return subjects.map((s, i) => {
    const day = (i % 5) + 1;
    const slot = slotsByDay.get(day) ?? 0;
    slotsByDay.set(day, slot + 1);
    const hour = 8 + slot;
    const hh = String(hour).padStart(2, '0');
    const course = mapCourse(s.courses);
    return {
      day,
      start: `${hh}:00`,
      end: `${String(hour + 1).padStart(2, '0')}:00`,
      subjectId: s.id,
      subjectName: s.name,
      courseName: course?.name ?? null,
    };
  });
}

/** Parser CSV mínimo con soporte de comillas y separador coma/punto y coma. */
function parseCsv(content: string): string[][] {
  const text = content.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  const pushCell = () => {
    row.push(cell);
    cell = '';
  };
  const pushRow = () => {
    pushCell();
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',' || ch === ';') {
      pushCell();
    } else if (ch === '\n') {
      pushRow();
    } else if (ch !== '\r') {
      cell += ch;
    }
  }
  pushRow();
  return rows.filter((r) => r.length > 1 || r[0]?.trim());
}

function normalizeKey(key: string): string {
  return key.trim().toLowerCase().replace(/[\s_-]/g, '');
}
