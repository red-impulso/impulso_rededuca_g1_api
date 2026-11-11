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
  COURSE_SHIFTS,
  COURSE_STATUSES,
  type CourseShift,
  type CreateCourseDto,
} from './dto/create-course.dto.js';
import type { UpdateCourseDto } from './dto/update-course.dto.js';

export interface CourseListItem {
  id: string;
  name: string;
  year: number | null;
  division: string | null;
  shift: string | null;
  schoolYear: number | null;
  status: string;
  classroom: string | null;
  studentsCount: number;
  homeroomTeacher: { id: string; fullName: string | null } | null;
}

interface CourseKey {
  year: number;
  division: string;
  shift: CourseShift | null;
  schoolYear: number;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const COURSE_COLUMNS =
  'id, name, year, division, shift, school_year, status, classroom, homeroom_teacher_membership_id';

const DUPLICATE_MSG =
  'Ya existe un curso con el mismo año, división, turno y ciclo lectivo';

@Injectable()
export class CoursesService {
  constructor(private readonly supabase: SupabaseService) {}

  /**
   * Cursos de la institución activa ordenados por ciclo lectivo descendente,
   * año y división ascendente. Cada curso trae la cantidad de alumnos
   * activos, el preceptor asignado, su estado y el aula.
   */
  async list(membership: Membership): Promise<CourseListItem[]> {
    this.assertStaff(membership);

    const { data, error } = await this.supabase.admin
      .from('courses')
      .select(COURSE_COLUMNS)
      .eq('institution_id', membership.institutionId)
      .order('school_year', { ascending: false })
      .order('year')
      .order('division');
    if (error) throw error;

    return this.enrich(membership.institutionId, data ?? []);
  }

  /** Detalle completo de un curso de la institución activa. */
  async detail(membership: Membership, id: string): Promise<CourseListItem> {
    this.assertStaff(membership);
    const course = await this.courseFor(membership, id);
    const [item] = await this.enrich(membership.institutionId, [course]);
    return item;
  }

  /**
   * Crea un curso en la institución activa. Rechaza con 409 si ya existe otro
   * con el mismo año, división, turno y ciclo lectivo.
   */
  async create(
    membership: Membership,
    dto: CreateCourseDto,
  ): Promise<CourseListItem> {
    this.assertStaff(membership);
    const key = this.validateKey(dto);
    const extras = await this.validateExtras(membership, dto);

    await this.ensureUnique(membership.institutionId, key);

    const { data, error } = await this.supabase.admin
      .from('courses')
      .insert({
        institution_id: membership.institutionId,
        name: `${key.year}° ${key.division}`,
        year: key.year,
        division: key.division,
        shift: key.shift,
        school_year: key.schoolYear,
        ...extras,
      })
      .select(COURSE_COLUMNS)
      .single();
    if (error) {
      if (error.code === '23505') throw new ConflictException(DUPLICATE_MSG);
      throw error;
    }
    const [item] = await this.enrich(membership.institutionId, [data]);
    return item;
  }

  /**
   * Actualiza un curso de la institución activa. Rechaza con 409 si el
   * cambio de año/división/turno/ciclo colisiona con otro curso del mismo
   * ciclo lectivo.
   */
  async update(
    membership: Membership,
    id: string,
    dto: UpdateCourseDto,
  ): Promise<CourseListItem> {
    this.assertStaff(membership);
    const current = await this.courseFor(membership, id);
    const extras = await this.validateExtras(membership, dto);
    const keyFields =
      dto?.year !== undefined ||
      dto?.division !== undefined ||
      dto?.shift !== undefined ||
      dto?.schoolYear !== undefined;

    const patch: Record<string, unknown> = { ...extras };
    if (keyFields) {
      const key = this.validateKey(
        {
          year: dto?.year ?? current.year,
          division: dto?.division ?? current.division,
          shift: dto?.shift ?? current.shift,
          schoolYear: dto?.schoolYear ?? current.school_year,
        },
        true,
      );
      await this.ensureUnique(membership.institutionId, key, id);
      Object.assign(patch, {
        name: `${key.year}° ${key.division}`,
        year: key.year,
        division: key.division,
        shift: key.shift,
        school_year: key.schoolYear,
      });
    }
    if (!Object.keys(patch).length) {
      throw new BadRequestException(
        'Debe enviar al menos un campo para actualizar',
      );
    }

    const { data, error } = await this.supabase.admin
      .from('courses')
      .update(patch)
      .eq('id', id)
      .select(COURSE_COLUMNS)
      .single();
    if (error) {
      if (error.code === '23505') throw new ConflictException(DUPLICATE_MSG);
      throw error;
    }
    const [item] = await this.enrich(membership.institutionId, [data]);
    return item;
  }

  /**
   * Elimina físicamente un curso de la institución activa. Rechaza con 409
   * si el curso tiene alumnos asignados en la tabla students.
   */
  async remove(membership: Membership, id: string): Promise<void> {
    this.assertStaff(membership);
    await this.courseFor(membership, id);

    const { count, error } = await this.supabase.admin
      .from('students')
      .select('id', { count: 'exact', head: true })
      .eq('institution_id', membership.institutionId)
      .eq('course_id', id);
    if (error) throw error;
    if ((count ?? 0) > 0) {
      throw new ConflictException(
        'No se puede eliminar el curso porque tiene alumnos asignados',
      );
    }

    const { error: deleteError } = await this.supabase.admin
      .from('courses')
      .delete()
      .eq('id', id);
    if (deleteError) throw deleteError;
  }

  /** Solo admin/director pueden gestionar cursos. */
  private assertStaff(membership: Membership) {
    if (membership.role !== 'admin' && membership.role !== 'director') {
      throw new ForbiddenException(
        'Solo admin o director pueden gestionar los cursos',
      );
    }
  }

  /** Curso dentro de la institución activa. */
  private async courseFor(membership: Membership, id: string) {
    if (typeof id !== 'string' || !UUID_RE.test(id)) {
      throw new BadRequestException('id de curso inválido');
    }
    const { data, error } = await this.supabase.admin
      .from('courses')
      .select(COURSE_COLUMNS)
      .eq('id', id)
      .eq('institution_id', membership.institutionId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new NotFoundException('Curso no encontrado');
    return data;
  }

  /**
   * Agrega a cada curso la cantidad de alumnos activos y el preceptor
   * (membership → profile) en dos consultas agrupadas.
   */
  private async enrich(
    institutionId: string,
    rows: any[],
  ): Promise<CourseListItem[]> {
    if (!rows.length) return [];
    const counts = await this.studentsByCourse(
      institutionId,
      rows.map((r) => r.id as string),
    );
    const teachers = await this.teachersById(
      unique(rows.map((r) => r.homeroom_teacher_membership_id)),
    );
    return rows.map((r) =>
      mapCourse(
        r,
        counts.get(r.id) ?? 0,
        r.homeroom_teacher_membership_id
          ? (teachers.get(r.homeroom_teacher_membership_id) ?? {
              id: r.homeroom_teacher_membership_id,
              fullName: null,
            })
          : null,
      ),
    );
  }

  /** Cantidad de alumnos activos por curso. */
  private async studentsByCourse(
    institutionId: string,
    courseIds: string[],
  ): Promise<Map<string, number>> {
    const { data, error } = await this.supabase.admin
      .from('students')
      .select('course_id')
      .eq('institution_id', institutionId)
      .eq('status', 'active')
      .in('course_id', courseIds);
    if (error) throw error;
    const counts = new Map<string, number>();
    for (const row of data ?? []) {
      const id = row.course_id as string;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
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

  /** Valida y normaliza año, división, turno y ciclo lectivo. */
  private validateKey(
    dto: {
      year?: number;
      division?: string;
      shift?: CourseShift | null;
      schoolYear?: number;
    },
    allowNullShift = false,
  ): CourseKey {
    const year = dto?.year;
    if (
      typeof year !== 'number' ||
      !Number.isInteger(year) ||
      year < 1 ||
      year > 12
    ) {
      throw new BadRequestException('year debe ser un entero entre 1 y 12');
    }
    const schoolYear = dto?.schoolYear;
    if (
      typeof schoolYear !== 'number' ||
      !Number.isInteger(schoolYear) ||
      schoolYear < 1900 ||
      schoolYear > 2100
    ) {
      throw new BadRequestException(
        'schoolYear debe ser un entero entre 1900 y 2100',
      );
    }
    const division =
      typeof dto?.division === 'string' ? dto.division.trim() : '';
    if (!division) {
      throw new BadRequestException('division no puede estar vacía');
    }
    const shift = dto?.shift ?? null;
    const shiftValid =
      shift === null
        ? allowNullShift
        : (COURSE_SHIFTS as readonly string[]).includes(shift);
    if (!shiftValid) {
      throw new BadRequestException(
        "shift debe ser 'morning', 'afternoon' o 'evening'",
      );
    }
    return { year, division, shift, schoolYear };
  }

  /**
   * Valida los campos complementarios (aula, estado y preceptor) y devuelve
   * las columnas a persistir.
   */
  private async validateExtras(
    membership: Membership,
    dto: {
      classroom?: string | null;
      status?: string;
      homeroomTeacherMembershipId?: string | null;
    },
  ): Promise<Record<string, unknown>> {
    const patch: Record<string, unknown> = {};

    if (dto?.classroom !== undefined) {
      patch.classroom =
        dto.classroom === null ? null : dto.classroom.trim() || null;
    }
    if (dto?.status !== undefined) {
      if (!(COURSE_STATUSES as readonly string[]).includes(dto.status)) {
        throw new BadRequestException(
          "status debe ser 'active', 'inactive' o 'draft'",
        );
      }
      patch.status = dto.status;
    }
    if (dto?.homeroomTeacherMembershipId !== undefined) {
      if (dto.homeroomTeacherMembershipId === null) {
        patch.homeroom_teacher_membership_id = null;
      } else {
        const teacher = await this.teacherMembershipFor(
          membership,
          dto.homeroomTeacherMembershipId,
        );
        patch.homeroom_teacher_membership_id = teacher.id;
      }
    }
    return patch;
  }

  /**
   * Membresía docente dentro de la institución activa; rechaza si no existe
   * o no tiene rol 'teacher'.
   */
  private async teacherMembershipFor(membership: Membership, id: string) {
    if (typeof id !== 'string' || !UUID_RE.test(id)) {
      throw new BadRequestException('homeroomTeacherMembershipId inválido');
    }
    const { data, error } = await this.supabase.admin
      .from('memberships')
      .select('id, role')
      .eq('id', id)
      .eq('institution_id', membership.institutionId)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      throw new BadRequestException(
        'homeroomTeacherMembershipId no pertenece a la institución',
      );
    }
    if (data.role !== 'teacher') {
      throw new BadRequestException(
        'homeroomTeacherMembershipId debe corresponder a una membresía con rol teacher',
      );
    }
    return data;
  }

  /**
   * Rechaza con 409 si ya existe un curso con la misma clave dentro de la
   * institución. La comparación de shift se hace en memoria porque la
   * columna admite NULL y UNIQUE de Postgres no los iguala.
   */
  private async ensureUnique(
    institutionId: string,
    key: CourseKey,
    excludeId?: string,
  ) {
    const { data, error } = await this.supabase.admin
      .from('courses')
      .select('id, shift')
      .eq('institution_id', institutionId)
      .eq('year', key.year)
      .eq('division', key.division)
      .eq('school_year', key.schoolYear);
    if (error) throw error;

    const clash = (data ?? []).some(
      (c: any) => c.id !== excludeId && c.shift === key.shift,
    );
    if (clash) throw new ConflictException(DUPLICATE_MSG);
  }
}

function mapCourse(
  c: any,
  studentsCount: number,
  homeroomTeacher: { id: string; fullName: string | null } | null,
): CourseListItem {
  return {
    id: c.id,
    name: c.name,
    year: c.year ?? null,
    division: c.division ?? null,
    shift: c.shift ?? null,
    schoolYear: c.school_year ?? null,
    status: c.status ?? 'active',
    classroom: c.classroom ?? null,
    studentsCount,
    homeroomTeacher,
  };
}

function unique(values: (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v)))];
}
