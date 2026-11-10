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
  CREATABLE_STATUSES,
  STUDENT_GENDERS,
  STUDENT_STATUSES,
  type CreateStudentDto,
  type StudentStatus,
} from './dto/create-student.dto.js';
import type { UpdateStudentDto } from './dto/update-student.dto.js';

export interface CourseRef {
  id: string;
  year: number | null;
  division: string | null;
  shift: string | null;
  schoolYear: number | null;
}

export interface GuardianContact {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
}

export interface StudentSummary {
  id: string;
  firstName: string;
  lastName: string;
  dni: string | null;
  fileNumber: string | null;
  status: StudentStatus;
  course: CourseRef | null;
  guardian: GuardianContact | null;
  updatedAt: string | null;
}

export interface StudentListResult {
  data: StudentSummary[];
  total: number;
  page: number;
  limit: number;
}

export interface StudentRecord {
  id: string;
  firstName: string;
  lastName: string;
  dni: string | null;
  fileNumber: string | null;
  birthDate: string | null;
  gender: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  status: StudentStatus;
  enrollmentDate: string | null;
  courseId: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface StudentProfile {
  personal: {
    id: string;
    firstName: string;
    lastName: string;
    dni: string | null;
    fileNumber: string | null;
    birthDate: string | null;
    gender: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
  };
  academic: {
    course: CourseRef | null;
    enrollmentDate: string | null;
    status: StudentStatus;
  };
  academicSummary: {
    averageGrade: number | null;
    approvedSubjects: number;
    pendingSubjects: number;
  };
  attendanceSummary: {
    percentage: number | null;
    justified: number;
    unjustified: number;
    late: number;
  };
  guardians: GuardianContact[];
  observations: { academic: string | null; institutional: string | null };
}

export interface ListStudentsParams {
  courseId?: string;
  q?: string;
  status?: string;
  page?: number;
  limit?: number;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Promedio por materia a partir del cual la materia cuenta como aprobada. */
const PASSING_GRADE = 6;

const DUPLICATE_DNI_MSG =
  'Ya existe un alumno con ese DNI en esta institución';

const STUDENT_COLUMNS =
  'id, course_id, first_name, last_name, dni, file_number, birth_date, gender, address, phone, email, status, enrollment_date, observation_academic, observation_institutional, created_at, updated_at';

const LIST_COLUMNS =
  'id, first_name, last_name, dni, file_number, status, updated_at, courses(id, year, division, shift, school_year)';

const PROFILE_COLUMNS = `${STUDENT_COLUMNS}, courses(id, year, division, shift, school_year)`;

@Injectable()
export class StudentsService {
  constructor(private readonly supabase: SupabaseService) {}

  /**
   * Listado paginado de alumnos de la institución activa, ordenado por
   * apellido y nombre. Filtros opcionales: courseId, status y `q` (búsqueda
   * insensible a mayúsculas en nombre, apellido, DNI o legajo).
   */
  async list(
    membership: Membership,
    params: ListStudentsParams = {},
  ): Promise<StudentListResult> {
    this.assertStaff(membership);
    const { courseId, status, page, limit } = this.validateListParams(params);
    const term = this.searchTerm(params.q);

    const from = (page - 1) * limit;
    let query = this.supabase.admin
      .from('students')
      .select(LIST_COLUMNS, { count: 'exact' })
      .eq('institution_id', membership.institutionId)
      .order('last_name')
      .order('first_name')
      .range(from, from + limit - 1);
    if (courseId) query = query.eq('course_id', courseId);
    if (status) query = query.eq('status', status);
    if (term) {
      query = query.or(
        `first_name.ilike.%${term}%,last_name.ilike.%${term}%,dni.ilike.%${term}%,file_number.ilike.%${term}%`,
      );
    }

    const { data, count, error } = await query;
    if (error) throw error;

    const rows = data ?? [];
    const guardians = await this.guardiansByStudent(
      rows.map((r: any) => r.id as string),
    );

    return {
      data: rows.map((r: any) =>
        mapSummary(r, guardians.get(r.id)?.[0] ?? null),
      ),
      total: count ?? rows.length,
      page,
      limit,
    };
  }

  /**
   * Ficha completa del alumno: datos personales y académicos, promedio y
   * materias aprobadas/pendientes calculados de grades, resumen de asistencia
   * calculado de attendance_records, tutores vinculados y observaciones.
   */
  async profile(membership: Membership, id: string): Promise<StudentProfile> {
    this.assertStaff(membership);
    const student = await this.studentFor(membership, id);

    const [gradesResult, attendanceResult, guardians] = await Promise.all([
      this.supabase.admin
        .from('grades')
        .select('subject_id, value')
        .eq('institution_id', membership.institutionId)
        .eq('student_id', id)
        .not('value', 'is', null),
      this.supabase.admin
        .from('attendance_records')
        .select('status')
        .eq('institution_id', membership.institutionId)
        .eq('student_id', id),
      this.guardiansByStudent([id]),
    ]);
    if (gradesResult.error) throw gradesResult.error;
    if (attendanceResult.error) throw attendanceResult.error;

    return {
      personal: {
        id: student.id,
        firstName: student.first_name,
        lastName: student.last_name,
        dni: student.dni ?? null,
        fileNumber: student.file_number ?? null,
        birthDate: student.birth_date ?? null,
        gender: student.gender ?? null,
        address: student.address ?? null,
        phone: student.phone ?? null,
        email: student.email ?? null,
      },
      academic: {
        course: mapCourse(student.courses),
        enrollmentDate: student.enrollment_date ?? null,
        status: student.status,
      },
      academicSummary: summarizeGrades(gradesResult.data ?? []),
      attendanceSummary: summarizeAttendance(attendanceResult.data ?? []),
      guardians: guardians.get(id) ?? [],
      observations: {
        academic: student.observation_academic ?? null,
        institutional: student.observation_institutional ?? null,
      },
    };
  }

  /**
   * Alta de alumno en la institución activa. Rechaza con 409 si el DNI ya
   * existe en la institución y con 404 si el curso no pertenece a ella.
   */
  async create(
    membership: Membership,
    dto: CreateStudentDto,
  ): Promise<StudentRecord> {
    this.assertStaff(membership);
    const input = this.validateCreate(dto);
    await this.courseFor(membership, input.courseId);
    if (input.dni) {
      await this.ensureDniUnique(membership.institutionId, input.dni);
    }

    const { data, error } = await this.supabase.admin
      .from('students')
      .insert({
        institution_id: membership.institutionId,
        course_id: input.courseId,
        first_name: input.firstName,
        last_name: input.lastName,
        dni: input.dni,
        file_number: input.fileNumber,
        birth_date: input.birthDate,
        gender: input.gender,
        address: input.address,
        phone: input.phone,
        email: input.email,
        status: input.status,
        ...(input.enrollmentDate
          ? { enrollment_date: input.enrollmentDate }
          : {}),
      })
      .select(STUDENT_COLUMNS)
      .single();
    if (error) {
      if (error.code === '23505') throw new ConflictException(DUPLICATE_DNI_MSG);
      throw error;
    }
    return mapStudent(data);
  }

  /**
   * Edita datos personales, observaciones y el curso del alumno. Rechaza con
   * 409 si el nuevo DNI colisiona con otro alumno de la misma institución y
   * con 404 si el alumno no existe en ella.
   */
  async update(
    membership: Membership,
    id: string,
    dto: UpdateStudentDto,
  ): Promise<StudentRecord> {
    this.assertStaff(membership);
    const current = await this.studentFor(membership, id);
    const changes = this.validateUpdate(dto);

    if (changes.courseId !== undefined) {
      await this.courseFor(membership, changes.courseId as string);
    }
    if (changes.dni !== undefined && changes.dni !== current.dni) {
      await this.ensureDniUnique(
        membership.institutionId,
        changes.dni as string,
        id,
      );
    }

    const { data, error } = await this.supabase.admin
      .from('students')
      .update({
        ...toUpdateRow(changes),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('institution_id', membership.institutionId)
      .select(STUDENT_COLUMNS)
      .single();
    if (error) {
      if (error.code === '23505') throw new ConflictException(DUPLICATE_DNI_MSG);
      throw error;
    }
    return mapStudent(data);
  }

  /**
   * Baja lógica del alumno: marca status 'inactive' sin borrar la fila, de
   * modo que el historial de notas y asistencias se conserva y el alumno deja
   * de aparecer en las planillas docentes.
   */
  async remove(membership: Membership, id: string): Promise<void> {
    this.assertStaff(membership);
    await this.studentFor(membership, id);

    const { error } = await this.supabase.admin
      .from('students')
      .update({ status: 'inactive', updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('institution_id', membership.institutionId);
    if (error) throw error;
  }

  /** Solo admin/director pueden gestionar alumnos. */
  private assertStaff(membership: Membership) {
    if (membership.role !== 'admin' && membership.role !== 'director') {
      throw new ForbiddenException(
        'Solo admin o director pueden gestionar los alumnos',
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
      .select(PROFILE_COLUMNS)
      .eq('id', id)
      .eq('institution_id', membership.institutionId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new NotFoundException('Alumno no encontrado');
    return data;
  }

  /** Curso dentro de la institución activa. */
  private async courseFor(membership: Membership, courseId: string) {
    if (typeof courseId !== 'string' || !UUID_RE.test(courseId)) {
      throw new BadRequestException('courseId inválido');
    }
    const { data, error } = await this.supabase.admin
      .from('courses')
      .select('id')
      .eq('id', courseId)
      .eq('institution_id', membership.institutionId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new NotFoundException('Curso no encontrado');
    return data;
  }

  /**
   * Rechaza con 409 si el DNI ya lo usa otro alumno de la institución.
   * Complementa al índice único parcial de Postgres, que queda como última
   * línea de defensa (error 23505 → 409 en create/update).
   */
  private async ensureDniUnique(
    institutionId: string,
    dni: string,
    excludeId?: string,
  ) {
    let query = this.supabase.admin
      .from('students')
      .select('id')
      .eq('institution_id', institutionId)
      .eq('dni', dni);
    if (excludeId) query = query.not('id', 'eq', excludeId);
    const { data, error } = await query;
    if (error) throw error;
    if (data?.length) throw new ConflictException(DUPLICATE_DNI_MSG);
  }

  /**
   * Tutores vinculados por alumno resolviendo guardian_links → memberships →
   * profiles. El email vive en auth.users y se obtiene con la API admin del
   * cliente Supabase; ante cualquier fallo queda en null.
   */
  private async guardiansByStudent(
    studentIds: string[],
  ): Promise<Map<string, GuardianContact[]>> {
    const result = new Map<string, GuardianContact[]>();
    if (!studentIds.length) return result;

    const { data: links, error } = await this.supabase.admin
      .from('guardian_links')
      .select('student_id, guardian_membership_id')
      .in('student_id', studentIds);
    if (error) throw error;
    if (!links?.length) return result;

    const membershipIds = [
      ...new Set(links.map((l: any) => l.guardian_membership_id as string)),
    ];
    const { data: guardians, error: guardiansError } =
      await this.supabase.admin
        .from('memberships')
        .select('id, user_id, profiles(full_name, phone)')
        .eq('role', 'guardian')
        .in('id', membershipIds);
    if (guardiansError) throw guardiansError;

    const byMembership = new Map<string, any>(
      (guardians ?? []).map((g: any) => [g.id, g]),
    );
    const emails = await this.emailsByUserId(
      [...new Set((guardians ?? []).map((g: any) => g.user_id as string))],
    );

    for (const link of links) {
      const g = byMembership.get(link.guardian_membership_id);
      if (!g) continue;
      const profile = Array.isArray(g.profiles)
        ? g.profiles[0]
        : g.profiles;
      const list = result.get(link.student_id) ?? [];
      list.push({
        id: g.id,
        fullName: profile?.full_name ?? '',
        phone: profile?.phone ?? null,
        email: emails.get(g.user_id) ?? null,
      });
      result.set(link.student_id, list);
    }
    return result;
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

  private validateListParams(params: ListStudentsParams) {
    const page = params.page ?? 1;
    const limit = params.limit ?? 25;
    if (!Number.isInteger(page) || page < 1) {
      throw new BadRequestException('page debe ser un entero mayor o igual a 1');
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new BadRequestException('limit debe ser un entero entre 1 y 100');
    }
    const courseId = params.courseId;
    if (courseId !== undefined && !UUID_RE.test(courseId)) {
      throw new BadRequestException('courseId inválido');
    }
    const status = params.status;
    if (
      status !== undefined &&
      status !== '' &&
      !(STUDENT_STATUSES as readonly string[]).includes(status)
    ) {
      throw new BadRequestException(
        "status debe ser 'active', 'inactive' o 'draft'",
      );
    }
    return { courseId, status: status || undefined, page, limit };
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

  /** Valida y normaliza el alta; los opcionales vacíos quedan en null. */
  private validateCreate(dto: CreateStudentDto) {
    if (!dto || typeof dto !== 'object') {
      throw new BadRequestException('El cuerpo es obligatorio');
    }
    const firstName = this.requiredText(dto.firstName, 'firstName');
    const lastName = this.requiredText(dto.lastName, 'lastName');
    const courseId = dto.courseId;
    if (typeof courseId !== 'string' || !UUID_RE.test(courseId)) {
      throw new BadRequestException('courseId inválido');
    }
    const status = dto.status ?? 'active';
    if (!(CREATABLE_STATUSES as readonly string[]).includes(status)) {
      throw new BadRequestException("status debe ser 'active' o 'draft'");
    }
    this.optionalGender(dto.gender);

    return {
      firstName,
      lastName,
      dni: this.optionalText(dto.dni),
      fileNumber: this.optionalText(dto.fileNumber),
      courseId,
      birthDate: this.optionalDate(dto.birthDate, 'birthDate'),
      gender: dto.gender ?? null,
      address: this.optionalText(dto.address),
      phone: this.optionalText(dto.phone),
      email: this.optionalText(dto.email),
      status: status as StudentStatus,
      enrollmentDate: this.optionalDate(dto.enrollmentDate, 'enrollmentDate'),
    };
  }

  /** Valida la edición y devuelve solo los campos provistos. */
  private validateUpdate(dto: UpdateStudentDto) {
    if (!dto || typeof dto !== 'object') {
      throw new BadRequestException('El cuerpo es obligatorio');
    }
    const changes: Record<string, unknown> = {};

    if (dto.firstName !== undefined) {
      changes.firstName = this.requiredText(dto.firstName, 'firstName');
    }
    if (dto.lastName !== undefined) {
      changes.lastName = this.requiredText(dto.lastName, 'lastName');
    }
    if (dto.dni !== undefined) {
      changes.dni = this.requiredText(dto.dni, 'dni');
    }
    if (dto.fileNumber !== undefined) {
      changes.fileNumber = this.optionalText(dto.fileNumber);
    }
    if (dto.courseId !== undefined) {
      if (typeof dto.courseId !== 'string' || !UUID_RE.test(dto.courseId)) {
        throw new BadRequestException('courseId inválido');
      }
      changes.courseId = dto.courseId;
    }
    if (dto.birthDate !== undefined) {
      changes.birthDate = this.optionalDate(dto.birthDate, 'birthDate');
    }
    if (dto.gender !== undefined) {
      changes.gender = this.optionalGender(dto.gender);
    }
    if (dto.address !== undefined) {
      changes.address = this.optionalText(dto.address);
    }
    if (dto.phone !== undefined) {
      changes.phone = this.optionalText(dto.phone);
    }
    if (dto.email !== undefined) {
      changes.email = this.optionalText(dto.email);
    }
    if (dto.status !== undefined) {
      if (!(STUDENT_STATUSES as readonly string[]).includes(dto.status)) {
        throw new BadRequestException(
          "status debe ser 'active', 'inactive' o 'draft'",
        );
      }
      changes.status = dto.status;
    }
    if (dto.enrollmentDate !== undefined) {
      changes.enrollmentDate = this.optionalDate(
        dto.enrollmentDate,
        'enrollmentDate',
      );
    }
    if (dto.observationAcademic !== undefined) {
      changes.observationAcademic = this.optionalText(dto.observationAcademic);
    }
    if (dto.observationInstitutional !== undefined) {
      changes.observationInstitutional = this.optionalText(
        dto.observationInstitutional,
      );
    }

    if (!Object.keys(changes).length) {
      throw new BadRequestException(
        'Debe enviar al menos un campo para actualizar',
      );
    }
    return changes;
  }

  private requiredText(value: unknown, field: string): string {
    if (typeof value !== 'string' || !value.trim()) {
      throw new BadRequestException(`${field} es obligatorio`);
    }
    return value.trim();
  }

  private optionalText(value: unknown): string | null {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string') {
      throw new BadRequestException('El campo debe ser texto');
    }
    return value.trim() || null;
  }

  private optionalGender(value: unknown): string | null {
    if (value === undefined || value === null) return null;
    if (!(STUDENT_GENDERS as readonly string[]).includes(value as string)) {
      throw new BadRequestException(
        "gender debe ser 'Femenino', 'Masculino' u 'Otro'",
      );
    }
    return value as string;
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
}

function toUpdateRow(changes: Record<string, unknown>) {
  const row: Record<string, unknown> = {};
  const map: Record<string, string> = {
    firstName: 'first_name',
    lastName: 'last_name',
    dni: 'dni',
    fileNumber: 'file_number',
    courseId: 'course_id',
    birthDate: 'birth_date',
    gender: 'gender',
    address: 'address',
    phone: 'phone',
    email: 'email',
    status: 'status',
    enrollmentDate: 'enrollment_date',
    observationAcademic: 'observation_academic',
    observationInstitutional: 'observation_institutional',
  };
  for (const [key, column] of Object.entries(map)) {
    if (key in changes) row[column] = changes[key];
  }
  return row;
}

function mapCourse(c: any): CourseRef | null {
  if (!c) return null;
  const course = Array.isArray(c) ? c[0] : c;
  if (!course) return null;
  return {
    id: course.id,
    year: course.year ?? null,
    division: course.division ?? null,
    shift: course.shift ?? null,
    schoolYear: course.school_year ?? null,
  };
}

function mapStudent(r: any): StudentRecord {
  return {
    id: r.id,
    firstName: r.first_name,
    lastName: r.last_name,
    dni: r.dni ?? null,
    fileNumber: r.file_number ?? null,
    birthDate: r.birth_date ?? null,
    gender: r.gender ?? null,
    address: r.address ?? null,
    phone: r.phone ?? null,
    email: r.email ?? null,
    status: r.status,
    enrollmentDate: r.enrollment_date ?? null,
    courseId: r.course_id ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at ?? null,
  };
}

function mapSummary(r: any, guardian: GuardianContact | null): StudentSummary {
  return {
    id: r.id,
    firstName: r.first_name,
    lastName: r.last_name,
    dni: r.dni ?? null,
    fileNumber: r.file_number ?? null,
    status: r.status,
    course: mapCourse(r.courses),
    guardian,
    updatedAt: r.updated_at ?? null,
  };
}

/**
 * Promedio general y cantidad de materias aprobadas (promedio de la materia
 * >= PASSING_GRADE) o pendientes (< PASSING_GRADE), calculado sobre las
 * notas no nulas del alumno agrupadas por materia.
 */
function summarizeGrades(rows: { subject_id: string; value: unknown }[]) {
  const valuesBySubject = new Map<string, number[]>();
  for (const g of rows) {
    const value = Number(g.value);
    if (!Number.isFinite(value)) continue;
    const list = valuesBySubject.get(g.subject_id) ?? [];
    list.push(value);
    valuesBySubject.set(g.subject_id, list);
  }

  const all = [...valuesBySubject.values()].flat();
  const subjectAverages = [...valuesBySubject.values()].map(
    (values) => values.reduce((a, b) => a + b, 0) / values.length,
  );

  return {
    averageGrade: all.length
      ? Number((all.reduce((a, b) => a + b, 0) / all.length).toFixed(1))
      : null,
    approvedSubjects: subjectAverages.filter((a) => a >= PASSING_GRADE).length,
    pendingSubjects: subjectAverages.filter((a) => a < PASSING_GRADE).length,
  };
}

/**
 * Resumen de asistencia con el mismo criterio que AttendanceService: el
 * porcentaje cuenta presentes y tardanzas sobre los registros evaluables
 * (present + late + absent); justified son ausencias justificadas.
 */
function summarizeAttendance(rows: { status: string }[]) {
  const summary = {
    percentage: null as number | null,
    justified: 0,
    unjustified: 0,
    late: 0,
  };
  let present = 0;
  for (const r of rows) {
    if (r.status === 'present') present += 1;
    else if (r.status === 'absent') summary.unjustified += 1;
    else if (r.status === 'late') summary.late += 1;
    else if (r.status === 'justified') summary.justified += 1;
  }
  const evaluables = present + summary.late + summary.unjustified;
  if (evaluables > 0) {
    summary.percentage = Number(
      (((present + summary.late) / evaluables) * 100).toFixed(1),
    );
  }
  return summary;
}
