import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Membership } from '../../auth/membership.guard.js';
import { SupabaseService } from '../../supabase/supabase.service.js';
import type { CreateSubjectDto } from './dto/create-subject.dto.js';
import type { UpdateSubjectDto } from './dto/update-subject.dto.js';

export interface SubjectItem {
  id: string;
  name: string;
  description: string | null;
  status: string;
  weeklyHours: number;
  studentsCount: number;
  updatedAt: string | null;
  course: {
    id: string;
    name: string;
    year: number | null;
    division: string | null;
    shift: string | null;
    schoolYear: number | null;
  } | null;
  teacher: { id: string; fullName: string | null } | null;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DEFAULT_WEEKLY_HOURS = 4;

const SUBJECT_COLUMNS =
  'id, name, description, status, weekly_hours, updated_at, course_id, teacher_membership_id, courses!inner(id, name, year, division, shift, school_year, institution_id)';

@Injectable()
export class SubjectsService {
  constructor(private readonly supabase: SupabaseService) {}

  /**
   * Materias de la institución activa, filtrables por curso. Incluye los
   * datos del curso y del docente asignado (si existe).
   */
  async list(membership: Membership, courseId?: string): Promise<SubjectItem[]> {
    this.assertStaff(membership);

    if (courseId !== undefined) {
      if (!UUID_RE.test(courseId)) {
        throw new BadRequestException('courseId inválido');
      }
      await this.courseFor(membership, courseId);
    }

    let query = this.supabase.admin
      .from('subjects')
      .select(SUBJECT_COLUMNS)
      .eq('courses.institution_id', membership.institutionId)
      .order('name');
    if (courseId) query = query.eq('course_id', courseId);
    const { data, error } = await query;
    if (error) throw error;

    const rows = data ?? [];
    const [teachers, counts] = await Promise.all([
      this.teachersById(unique(rows.map((r: any) => r.teacher_membership_id))),
      this.studentsByCourse(
        membership.institutionId,
        unique(rows.map((r: any) => r.course_id)),
      ),
    ]);
    return rows.map((r: any) =>
      this.toItem(r, teachers, counts.get(r.course_id) ?? 0),
    );
  }

  /** Detalle completo de una materia de la institución activa. */
  async detail(membership: Membership, id: string): Promise<SubjectItem> {
    this.assertStaff(membership);
    if (typeof id !== 'string' || !UUID_RE.test(id)) {
      throw new BadRequestException('id de materia inválido');
    }
    const { data, error } = await this.supabase.admin
      .from('subjects')
      .select(SUBJECT_COLUMNS)
      .eq('id', id)
      .eq('courses.institution_id', membership.institutionId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new NotFoundException('Materia no encontrada');

    const [teachers, counts] = await Promise.all([
      this.teachersById(unique([data.teacher_membership_id])),
      this.studentsByCourse(membership.institutionId, [data.course_id]),
    ]);
    return this.toItem(data, teachers, counts.get(data.course_id) ?? 0);
  }

  /** Crea una materia en un curso de la institución activa. */
  async create(
    membership: Membership,
    dto: CreateSubjectDto,
  ): Promise<SubjectItem> {
    this.assertStaff(membership);
    if (!dto || typeof dto.courseId !== 'string' || !UUID_RE.test(dto.courseId)) {
      throw new BadRequestException('courseId inválido');
    }
    const name = typeof dto.name === 'string' ? dto.name.trim() : '';
    if (!name) {
      throw new BadRequestException('name no puede estar vacío');
    }

    const course = await this.courseFor(membership, dto.courseId);
    const teacher = dto.teacherMembershipId
      ? await this.teacherFor(membership, dto.teacherMembershipId)
      : null;
    const weeklyHours = this.optionalWeeklyHours(dto.weeklyHours);
    const description = this.optionalText(dto.description, 'description');

    const { data, error } = await this.supabase.admin
      .from('subjects')
      .insert({
        course_id: course.id,
        name,
        teacher_membership_id: teacher?.id ?? null,
        ...(weeklyHours !== undefined ? { weekly_hours: weeklyHours } : {}),
        ...(description !== undefined ? { description } : {}),
      })
      .select(SUBJECT_COLUMNS)
      .single();
    if (error) throw error;

    const counts = await this.studentsByCourse(membership.institutionId, [
      data.course_id,
    ]);
    return this.toItem(
      data,
      new Map(teacher ? [[teacher.id, teacher]] : []),
      counts.get(data.course_id) ?? 0,
    );
  }

  /**
   * Actualiza el nombre, docente, carga horaria, descripción o estado de
   * una materia de la institución activa.
   */
  async update(
    membership: Membership,
    id: string,
    dto: UpdateSubjectDto,
  ): Promise<SubjectItem> {
    this.assertStaff(membership);
    await this.subjectFor(membership, id);

    const patch: Record<string, unknown> = {};
    let teacher: { id: string; fullName: string | null } | null | undefined;
    if (dto?.name !== undefined) {
      const name = dto.name.trim();
      if (!name) {
        throw new BadRequestException('name no puede estar vacío');
      }
      patch.name = name;
    }
    if (dto?.teacherMembershipId !== undefined) {
      if (dto.teacherMembershipId === null) {
        patch.teacher_membership_id = null;
        teacher = null;
      } else {
        teacher = await this.teacherFor(membership, dto.teacherMembershipId);
        patch.teacher_membership_id = teacher.id;
      }
    }
    if (dto?.weeklyHours !== undefined) {
      patch.weekly_hours = this.requiredWeeklyHours(dto.weeklyHours);
    }
    if (dto?.description !== undefined) {
      patch.description = this.optionalText(dto.description, 'description');
    }
    if (dto?.status !== undefined) {
      if (!['active', 'inactive'].includes(dto.status)) {
        throw new BadRequestException("status debe ser 'active' o 'inactive'");
      }
      patch.status = dto.status;
    }
    if (!Object.keys(patch).length) {
      throw new BadRequestException(
        'Debe enviar al menos un campo para actualizar',
      );
    }

    const { data, error } = await this.supabase.admin
      .from('subjects')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select(SUBJECT_COLUMNS)
      .single();
    if (error) throw error;

    const [teachers, counts] = await Promise.all([
      teacher === undefined
        ? this.teachersById(unique([data.teacher_membership_id]))
        : Promise.resolve(
            new Map(teacher ? [[teacher.id, teacher]] : []) as Map<
              string,
              { id: string; fullName: string | null }
            >,
          ),
      this.studentsByCourse(membership.institutionId, [data.course_id]),
    ]);
    return this.toItem(data, teachers, counts.get(data.course_id) ?? 0);
  }

  /** Elimina una materia de la institución activa. */
  async remove(membership: Membership, id: string): Promise<void> {
    this.assertStaff(membership);
    await this.subjectFor(membership, id);

    const { error } = await this.supabase.admin
      .from('subjects')
      .delete()
      .eq('id', id);
    if (error) throw error;
  }

  /** Solo admin/director pueden gestionar materias. */
  private assertStaff(membership: Membership) {
    if (membership.role !== 'admin' && membership.role !== 'director') {
      throw new ForbiddenException(
        'Solo admin o director pueden gestionar las materias',
      );
    }
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
   * Membresía docente dentro de la institución activa; rechaza si no existe
   * o no tiene rol 'teacher'.
   */
  private async teacherFor(membership: Membership, teacherMembershipId: string) {
    if (
      typeof teacherMembershipId !== 'string' ||
      !UUID_RE.test(teacherMembershipId)
    ) {
      throw new BadRequestException('teacherMembershipId inválido');
    }
    const { data, error } = await this.supabase.admin
      .from('memberships')
      .select('id, user_id, role')
      .eq('id', teacherMembershipId)
      .eq('institution_id', membership.institutionId)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      throw new BadRequestException(
        'teacherMembershipId no pertenece a la institución',
      );
    }
    if (data.role !== 'teacher') {
      throw new BadRequestException(
        'teacherMembershipId debe corresponder a una membresía con rol teacher',
      );
    }

    const { data: profile, error: profileError } = await this.supabase.admin
      .from('profiles')
      .select('id, full_name')
      .eq('id', data.user_id)
      .maybeSingle();
    if (profileError) throw profileError;
    return { id: data.id, fullName: profile?.full_name ?? null };
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

  /** Alumnos activos por curso (para studentsCount de cada materia). */
  private async studentsByCourse(
    institutionId: string,
    courseIds: string[],
  ): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (!courseIds.length) return counts;
    const { data, error } = await this.supabase.admin
      .from('students')
      .select('course_id')
      .eq('institution_id', institutionId)
      .eq('status', 'active')
      .in('course_id', courseIds);
    if (error) throw error;
    for (const row of data ?? []) {
      const id = row.course_id as string;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }

  /** Carga horaria opcional en el alta; undefined conserva el default. */
  private optionalWeeklyHours(value: unknown): number | undefined {
    if (value === undefined || value === null) return undefined;
    return this.requiredWeeklyHours(value);
  }

  private requiredWeeklyHours(value: unknown): number {
    if (
      typeof value !== 'number' ||
      !Number.isInteger(value) ||
      value < 0 ||
      value > 80
    ) {
      throw new BadRequestException(
        'weeklyHours debe ser un entero entre 0 y 80',
      );
    }
    return value;
  }

  private optionalText(value: unknown, field: string): string | null {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string') {
      throw new BadRequestException(`${field} debe ser texto`);
    }
    return value.trim() || null;
  }

  private toItem(
    row: any,
    teachers: Map<string, { id: string; fullName: string | null }>,
    studentsCount: number,
  ): SubjectItem {
    const course = Array.isArray(row.courses) ? row.courses[0] : row.courses;
    const teacherId = row.teacher_membership_id;
    const weekly = Number(row.weekly_hours);
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? null,
      status: row.status ?? 'active',
      weeklyHours: Number.isFinite(weekly) ? weekly : DEFAULT_WEEKLY_HOURS,
      studentsCount,
      updatedAt: row.updated_at ?? null,
      course: course
        ? {
            id: course.id,
            name: course.name,
            year: course.year ?? null,
            division: course.division ?? null,
            shift: course.shift ?? null,
            schoolYear: course.school_year ?? null,
          }
        : null,
      teacher: teacherId ? (teachers.get(teacherId) ?? { id: teacherId, fullName: null }) : null,
    };
  }
}

function unique(values: (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v)))];
}
