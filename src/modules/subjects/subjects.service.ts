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
  course: {
    id: string;
    name: string;
    year: number | null;
    division: string | null;
    shift: string | null;
    schoolYear: number;
  } | null;
  teacher: { id: string; fullName: string | null } | null;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SUBJECT_COLUMNS =
  'id, name, course_id, teacher_membership_id, courses!inner(id, name, year, division, shift, school_year, institution_id)';

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
    const teachers = await this.teachersById(
      unique(rows.map((r: any) => r.teacher_membership_id)),
    );
    return rows.map((r: any) => this.toItem(r, teachers));
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

    const { data, error } = await this.supabase.admin
      .from('subjects')
      .insert({
        course_id: course.id,
        name,
        teacher_membership_id: teacher?.id ?? null,
      })
      .select(SUBJECT_COLUMNS)
      .single();
    if (error) throw error;

    return this.toItem(
      data,
      new Map(teacher ? [[teacher.id, teacher]] : []),
    );
  }

  /** Actualiza el nombre o el docente asignado de una materia. */
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
    if (!Object.keys(patch).length) {
      throw new BadRequestException(
        'Debe enviar al menos un campo para actualizar',
      );
    }

    const { data, error } = await this.supabase.admin
      .from('subjects')
      .update(patch)
      .eq('id', id)
      .select(SUBJECT_COLUMNS)
      .single();
    if (error) throw error;

    const teachers =
      teacher === undefined
        ? await this.teachersById(
            unique([data.teacher_membership_id]),
          )
        : new Map(teacher ? [[teacher.id, teacher]] : []);
    return this.toItem(data, teachers);
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

  private toItem(
    row: any,
    teachers: Map<string, { id: string; fullName: string | null }>,
  ): SubjectItem {
    const course = Array.isArray(row.courses) ? row.courses[0] : row.courses;
    const teacherId = row.teacher_membership_id;
    return {
      id: row.id,
      name: row.name,
      course: course
        ? {
            id: course.id,
            name: course.name,
            year: course.year ?? null,
            division: course.division ?? null,
            shift: course.shift ?? null,
            schoolYear: course.school_year,
          }
        : null,
      teacher: teacherId ? (teachers.get(teacherId) ?? { id: teacherId, fullName: null }) : null,
    };
  }
}

function unique(values: (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v)))];
}
