import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Membership } from '../../auth/membership.guard.js';
import { SupabaseService } from '../../supabase/supabase.service.js';
import type {
  AnnouncementScope,
  CreateAnnouncementDto,
} from './dto/create-announcement.dto.js';

export interface AnnouncementItem {
  id: string;
  scope: AnnouncementScope;
  title: string;
  body: string;
  createdAt: string;
  author: { id: string; fullName: string | null };
  course: { id: string; name: string | null } | null;
  student: { id: string; firstName: string; lastName: string } | null;
}

interface VisibilityContext {
  all: boolean;
  courseIds: Set<string>;
  studentIds: Set<string>;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCOPES: readonly AnnouncementScope[] = [
  'institution',
  'course',
  'student',
];

@Injectable()
export class AnnouncementsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * Crea un comunicado. admin/director pueden publicar en cualquier alcance;
   * el docente solo con scope 'course' en un curso donde dicte al menos una
   * materia; el tutor nunca puede publicar. Emite 'announcement.created'.
   */
  async create(membership: Membership, dto: CreateAnnouncementDto) {
    if (!dto || !SCOPES.includes(dto.scope)) {
      throw new BadRequestException(
        "scope debe ser 'institution', 'course' o 'student'",
      );
    }
    const title = typeof dto.title === 'string' ? dto.title.trim() : '';
    const body = typeof dto.body === 'string' ? dto.body.trim() : '';
    if (!title) {
      throw new BadRequestException('title no puede estar vacío');
    }
    if (!body) {
      throw new BadRequestException('body no puede estar vacío');
    }
    if (dto.scope === 'course' && !dto.courseId) {
      throw new BadRequestException("scope 'course' requiere courseId");
    }
    if (dto.scope === 'student' && !dto.studentId) {
      throw new BadRequestException("scope 'student' requiere studentId");
    }

    if (membership.role === 'guardian') {
      throw new ForbiddenException(
        'Los tutores no pueden publicar comunicados',
      );
    }
    if (membership.role === 'teacher' && dto.scope !== 'course') {
      throw new ForbiddenException(
        'El docente solo puede publicar comunicados con alcance de curso',
      );
    }

    const course =
      dto.scope === 'course' && dto.courseId
        ? await this.courseFor(membership, dto.courseId)
        : null;
    const student =
      dto.scope === 'student' && dto.studentId
        ? await this.studentFor(membership, dto.studentId)
        : null;

    const { data: record, error } = await this.supabase.admin
      .from('announcements')
      .insert({
        institution_id: membership.institutionId,
        author_id: membership.userId,
        scope: dto.scope,
        course_id: course?.id ?? null,
        student_id: student?.id ?? null,
        title,
        body,
      })
      .select()
      .single();
    if (error) throw error;

    this.events.emit('announcement.created', {
      institutionId: membership.institutionId,
      announcementId: record.id,
      scope: dto.scope,
      courseId: course?.id ?? null,
      studentId: student?.id ?? null,
      title,
    });

    return record;
  }

  /**
   * Lista los comunicados visibles para el rol del miembro, ordenados del más
   * nuevo al más viejo: admin/director ven todo; el docente ve los de
   * institución y los de los cursos donde dicta materias; el tutor ve los de
   * institución, los de los cursos de sus hijos vinculados y los dirigidos a
   * esos hijos.
   */
  async list(membership: Membership): Promise<AnnouncementItem[]> {
    const context = await this.visibilityContext(membership);

    const { data, error } = await this.supabase.admin
      .from('announcements')
      .select(
        'id, author_id, scope, course_id, student_id, title, body, created_at',
      )
      .eq('institution_id', membership.institutionId)
      .order('created_at', { ascending: false });
    if (error) throw error;

    const rows = (data ?? []).filter((r: any) =>
      this.isVisible(context, r),
    );

    const [authors, courses, students] = await Promise.all([
      this.profilesById(unique(rows.map((r: any) => r.author_id))),
      this.coursesById(unique(rows.map((r: any) => r.course_id))),
      this.studentsById(unique(rows.map((r: any) => r.student_id))),
    ]);

    return rows.map((r: any) => ({
      id: r.id,
      scope: r.scope,
      title: r.title,
      body: r.body,
      createdAt: r.created_at,
      author: authors.get(r.author_id) ?? {
        id: r.author_id,
        fullName: null,
      },
      course: r.course_id
        ? (courses.get(r.course_id) ?? { id: r.course_id, name: null })
        : null,
      student: r.student_id
        ? (students.get(r.student_id) ?? {
            id: r.student_id,
            firstName: '',
            lastName: '',
          })
        : null,
    }));
  }

  /**
   * Resuelve el contexto de visibilidad del miembro: sin restricción para
   * admin/director; cursos con materias asignadas para el docente; cursos e
   * hijos vinculados vía guardian_links para el tutor.
   */
  private async visibilityContext(
    membership: Membership,
  ): Promise<VisibilityContext> {
    if (membership.role === 'teacher') {
      const { data, error } = await this.supabase.admin
        .from('subjects')
        .select('course_id')
        .eq('teacher_membership_id', membership.id);
      if (error) throw error;
      return {
        all: false,
        courseIds: new Set(
          (data ?? []).map((s: any) => s.course_id).filter(Boolean),
        ),
        studentIds: new Set(),
      };
    }
    if (membership.role === 'guardian') {
      const { data: links, error } = await this.supabase.admin
        .from('guardian_links')
        .select('student_id')
        .eq('guardian_membership_id', membership.id);
      if (error) throw error;
      const studentIds = new Set<string>(
        (links ?? []).map((l: any) => l.student_id),
      );
      const courseIds = new Set<string>();
      if (studentIds.size) {
        const { data: children, error: childrenError } =
          await this.supabase.admin
            .from('students')
            .select('course_id')
            .eq('institution_id', membership.institutionId)
            .in('id', [...studentIds]);
        if (childrenError) throw childrenError;
        for (const s of children ?? []) {
          if (s.course_id) courseIds.add(s.course_id);
        }
      }
      return { all: false, courseIds, studentIds };
    }
    return { all: true, courseIds: new Set(), studentIds: new Set() };
  }

  private isVisible(context: VisibilityContext, row: any): boolean {
    if (context.all || row.scope === 'institution') return true;
    if (row.scope === 'course') {
      return row.course_id != null && context.courseIds.has(row.course_id);
    }
    if (row.scope === 'student') {
      return row.student_id != null && context.studentIds.has(row.student_id);
    }
    return false;
  }

  /** Curso dentro de la institución; si el miembro es docente, debe dictar al menos una materia en él. */
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
    if (membership.role === 'teacher') {
      const { data: subjects, error: subjectsError } =
        await this.supabase.admin
          .from('subjects')
          .select('id')
          .eq('course_id', data.id)
          .eq('teacher_membership_id', membership.id)
          .limit(1);
      if (subjectsError) throw subjectsError;
      if (!subjects?.length) {
        throw new ForbiddenException(
          'El docente no tiene materias asignadas en este curso',
        );
      }
    }
    return data;
  }

  /** Alumno dentro de la institución activa. */
  private async studentFor(membership: Membership, studentId: string) {
    if (typeof studentId !== 'string' || !UUID_RE.test(studentId)) {
      throw new BadRequestException('studentId inválido');
    }
    const { data, error } = await this.supabase.admin
      .from('students')
      .select('id, course_id')
      .eq('id', studentId)
      .eq('institution_id', membership.institutionId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new NotFoundException('Estudiante no encontrado');
    return data;
  }

  private async profilesById(ids: string[]) {
    const map = new Map<string, { id: string; fullName: string | null }>();
    if (!ids.length) return map;
    const { data, error } = await this.supabase.admin
      .from('profiles')
      .select('id, full_name')
      .in('id', ids);
    if (error) throw error;
    for (const p of data ?? []) {
      map.set(p.id, { id: p.id, fullName: p.full_name });
    }
    return map;
  }

  private async coursesById(ids: string[]) {
    const map = new Map<string, { id: string; name: string | null }>();
    if (!ids.length) return map;
    const { data, error } = await this.supabase.admin
      .from('courses')
      .select('id, name')
      .in('id', ids);
    if (error) throw error;
    for (const c of data ?? []) {
      map.set(c.id, { id: c.id, name: c.name });
    }
    return map;
  }

  private async studentsById(ids: string[]) {
    const map = new Map<
      string,
      { id: string; firstName: string; lastName: string }
    >();
    if (!ids.length) return map;
    const { data, error } = await this.supabase.admin
      .from('students')
      .select('id, first_name, last_name')
      .in('id', ids);
    if (error) throw error;
    for (const s of data ?? []) {
      map.set(s.id, {
        id: s.id,
        firstName: s.first_name,
        lastName: s.last_name,
      });
    }
    return map;
  }
}

function unique(values: (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v)))];
}
