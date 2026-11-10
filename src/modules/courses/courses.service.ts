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
  type CourseShift,
  type CreateCourseDto,
} from './dto/create-course.dto.js';
import type { UpdateCourseDto } from './dto/update-course.dto.js';

export interface CourseListItem {
  id: string;
  name: string;
  year?: number;
  division?: string;
  shift?: string | null;
  schoolYear?: number;
}

interface CourseKey {
  year: number;
  division: string;
  shift: CourseShift | null;
  schoolYear: number;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const COURSE_COLUMNS = 'id, name, year, division, shift, school_year';

const DUPLICATE_MSG =
  'Ya existe un curso con el mismo año, división, turno y ciclo lectivo';

@Injectable()
export class CoursesService {
  constructor(private readonly supabase: SupabaseService) {}

  /**
   * Cursos de la institución activa ordenados por ciclo lectivo descendente,
   * año y división ascendente. Solo admin/director: el guard filtra por rol
   * y el servicio lo vuelve a verificar por defensa.
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

    return (data ?? []).map(mapCourse);
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
      })
      .select(COURSE_COLUMNS)
      .single();
    if (error) {
      if (error.code === '23505') throw new ConflictException(DUPLICATE_MSG);
      throw error;
    }
    return mapCourse(data);
  }

  /**
   * Actualiza un curso de la institución activa. Rechaza con 409 si el
   * cambio colisiona con otro curso del mismo ciclo lectivo.
   */
  async update(
    membership: Membership,
    id: string,
    dto: UpdateCourseDto,
  ): Promise<CourseListItem> {
    this.assertStaff(membership);
    const current = await this.courseFor(membership, id);
    if (
      dto?.year === undefined &&
      dto?.division === undefined &&
      dto?.shift === undefined &&
      dto?.schoolYear === undefined
    ) {
      throw new BadRequestException(
        'Debe enviar al menos un campo para actualizar',
      );
    }

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

    const { data, error } = await this.supabase.admin
      .from('courses')
      .update({
        name: `${key.year}° ${key.division}`,
        year: key.year,
        division: key.division,
        shift: key.shift,
        school_year: key.schoolYear,
      })
      .eq('id', id)
      .select(COURSE_COLUMNS)
      .single();
    if (error) {
      if (error.code === '23505') throw new ConflictException(DUPLICATE_MSG);
      throw error;
    }
    return mapCourse(data);
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

function mapCourse(c: any): CourseListItem {
  return {
    id: c.id,
    name: c.name,
    year: c.year,
    division: c.division,
    shift: c.shift ?? null,
    schoolYear: c.school_year,
  };
}
