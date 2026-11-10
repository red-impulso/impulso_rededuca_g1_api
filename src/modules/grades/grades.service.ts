import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Membership } from '../../auth/membership.guard.js';
import { SupabaseService } from '../../supabase/supabase.service.js';
import type { SaveGradesDto } from './dto/save-grades.dto.js';

export interface GradingPeriodSummary {
  id: string;
  name: string;
  schoolYear: number;
}

export interface GradeSheetRow {
  student: { id: string; firstName: string; lastName: string };
  value: number | null;
  observations: string | null;
}

export interface SaveGradesResult {
  saved: number;
}

export interface StudentGradeRow {
  subject: { id: string; name: string };
  period: { id: string; name: string };
  value: number;
  observations: string | null;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class GradesService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly events: EventEmitter2,
  ) {}

  /** Períodos de calificación de la institución activa. */
  async listPeriods(membership: Membership): Promise<GradingPeriodSummary[]> {
    const { data, error } = await this.supabase.admin
      .from('grading_periods')
      .select('id, name, starts_on')
      .eq('institution_id', membership.institutionId)
      .order('starts_on');
    if (error) throw error;
    return (data ?? []).map((p: any) => ({
      id: p.id,
      name: p.name,
      schoolYear: Number(String(p.starts_on).slice(0, 4)),
    }));
  }

  /** Planilla: todos los alumnos del curso de la materia con su nota o null. */
  async getSheet(
    membership: Membership,
    subjectId: string,
    periodId: string,
  ): Promise<GradeSheetRow[]> {
    const subject = await this.subjectFor(membership, subjectId);
    await this.periodFor(membership, periodId);

    const students = await this.courseStudents(
      membership.institutionId,
      subject.course_id,
    );

    const { data: grades, error } = await this.supabase.admin
      .from('grades')
      .select('student_id, value, observations')
      .eq('subject_id', subjectId)
      .eq('period_id', periodId);
    if (error) throw error;

    const gradeByStudent = new Map<
      string,
      { value: number | null; observations: string | null }
    >(
      (grades ?? []).map((g: any) => [
        g.student_id,
        {
          value: g.value === null ? null : Number(g.value),
          observations: g.observations ?? null,
        },
      ]),
    );

    return students.map((s: any) => {
      const grade = gradeByStudent.get(s.id);
      return {
        student: { id: s.id, firstName: s.first_name, lastName: s.last_name },
        value: grade?.value ?? null,
        observations: grade?.observations ?? null,
      };
    });
  }

  /**
   * Upsert atómico de la planilla: valida todo el lote antes de escribir,
   * inserta/actualiza solo las notas que cambiaron y audita cada cambio en
   * grade_changes. Emite 'grades.saved' solo con los alumnos cuyo valor
   * numérico cambió o se insertó; un cambio exclusivo de observations no
   * dispara la notificación de nueva nota.
   */
  async saveSheet(
    membership: Membership,
    dto: SaveGradesDto,
  ): Promise<SaveGradesResult> {
    if (!dto || !Array.isArray(dto.entries)) {
      throw new BadRequestException(
        'El cuerpo debe incluir subjectId, periodId y entries[]',
      );
    }
    const { subjectId, periodId } = dto;

    const subject = await this.subjectFor(membership, subjectId);
    await this.periodFor(membership, periodId);

    const entries = this.validateEntries(dto.entries);

    const students = await this.courseStudents(
      membership.institutionId,
      subject.course_id,
    );
    const roster = new Set<string>(students.map((s: any) => s.id));
    for (const { studentId } of dto.entries) {
      if (!roster.has(studentId)) {
        throw new BadRequestException(
          `El estudiante ${studentId} no pertenece al curso de la materia`,
        );
      }
    }

    const db = this.supabase.admin;
    const { data: existing, error: existingError } = await db
      .from('grades')
      .select('id, student_id, value, observations')
      .eq('subject_id', subjectId)
      .eq('period_id', periodId);
    if (existingError) throw existingError;

    const previousByStudent = new Map<
      string,
      { value: number | null; observations: string | null }
    >(
      (existing ?? []).map((g: any) => [
        g.student_id,
        {
          value: g.value === null ? null : Number(g.value),
          observations: g.observations ?? null,
        },
      ]),
    );

    // observations omitida conserva el valor previo; provista lo reemplaza.
    const changes = [...entries]
      .map(([studentId, entry]) => {
        const previous = previousByStudent.get(studentId) ?? null;
        return {
          studentId,
          value: entry.value,
          observations:
            entry.observations === undefined
              ? (previous?.observations ?? null)
              : entry.observations,
          previous,
        };
      })
      .filter(
        (row) =>
          !row.previous ||
          row.previous.value !== row.value ||
          row.previous.observations !== row.observations,
      );
    if (!changes.length) return { saved: 0 };

    const { data: upserted, error: upsertError } = await db
      .from('grades')
      .upsert(
        changes.map((row) => ({
          institution_id: membership.institutionId,
          student_id: row.studentId,
          subject_id: subjectId,
          period_id: periodId,
          value: row.value,
          observations: row.observations,
          updated_at: new Date().toISOString(),
        })),
        { onConflict: 'student_id,subject_id,period_id' },
      )
      .select('id, student_id');
    if (upsertError) throw upsertError;

    const valueChanges = new Set(
      changes
        .filter((row) => (row.previous?.value ?? null) !== row.value)
        .map((row) => row.studentId),
    );
    const newValueByStudent = new Map(
      changes.map((row) => [row.studentId, row.value]),
    );
    const auditRows = (upserted ?? [])
      .filter((row: any) => valueChanges.has(row.student_id))
      .map((row: any) => ({
        grade_id: row.id,
        institution_id: membership.institutionId,
        previous_value: previousByStudent.get(row.student_id)?.value ?? null,
        new_value: newValueByStudent.get(row.student_id) ?? null,
        changed_by: membership.userId,
      }));
    if (auditRows.length) {
      const { error: auditError } = await db
        .from('grade_changes')
        .insert(auditRows);
      if (auditError) throw auditError;
    }

    const notifiedStudentIds = (upserted ?? [])
      .filter((row: any) => valueChanges.has(row.student_id))
      .map((row: any) => row.student_id);
    if (notifiedStudentIds.length) {
      this.events.emit('grades.saved', {
        institutionId: membership.institutionId,
        subjectId,
        periodId,
        studentIds: notifiedStudentIds,
      });
    }

    return { saved: upserted?.length ?? changes.length };
  }

  /**
   * Notas de un alumno ordenadas por materia y período.
   * admin/director: acceso total; teacher: debe dictar al menos una materia en
   * el curso del alumno; guardian: debe estar vinculado vía guardian_links.
   */
  async getStudentGrades(
    membership: Membership,
    studentId: string,
  ): Promise<StudentGradeRow[]> {
    const student = await this.studentFor(membership, studentId);
    await this.assertCanViewStudent(membership, student);

    const { data, error } = await this.supabase.admin
      .from('grades')
      .select(
        'value, observations, subjects!inner(id, name), grading_periods!inner(id, name)',
      )
      .eq('institution_id', membership.institutionId)
      .eq('student_id', studentId)
      .not('value', 'is', null);
    if (error) throw error;

    return (data ?? [])
      .filter((g: any) => g.value !== null)
      .map((g: any) => ({
        subject: { id: g.subjects.id, name: g.subjects.name },
        period: { id: g.grading_periods.id, name: g.grading_periods.name },
        value: Number(g.value),
        observations: g.observations ?? null,
      }))
      .sort(
        (a, b) =>
          a.subject.name.localeCompare(b.subject.name, 'es') ||
          a.period.name.localeCompare(b.period.name, 'es'),
      );
  }

  /** Materia dentro de la institución; si el miembro es docente, debe tenerla asignada. */
  private async subjectFor(membership: Membership, subjectId: string) {
    if (!UUID_RE.test(subjectId)) {
      throw new BadRequestException('subjectId inválido');
    }
    const { data, error } = await this.supabase.admin
      .from('subjects')
      .select('id, course_id, teacher_membership_id, courses!inner(id)')
      .eq('id', subjectId)
      .eq('courses.institution_id', membership.institutionId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new NotFoundException('Materia no encontrada');
    if (
      membership.role === 'teacher' &&
      data.teacher_membership_id !== membership.id
    ) {
      throw new ForbiddenException(
        'El docente no tiene asignada esta materia',
      );
    }
    return data;
  }

  /** Período dentro de la institución activa. */
  private async periodFor(membership: Membership, periodId: string) {
    if (!UUID_RE.test(periodId)) {
      throw new BadRequestException('periodId inválido');
    }
    const { data, error } = await this.supabase.admin
      .from('grading_periods')
      .select('id')
      .eq('id', periodId)
      .eq('institution_id', membership.institutionId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new NotFoundException('Período no encontrado');
    return data;
  }

  /** Alumno dentro de la institución activa. */
  private async studentFor(membership: Membership, studentId: string) {
    if (!UUID_RE.test(studentId)) {
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

  /**
   * Reglas de visibilidad por rol: el tutor debe estar vinculado al alumno en
   * guardian_links y el docente debe tener asignada al menos una materia del
   * curso del alumno. admin/director no tienen restricción.
   */
  private async assertCanViewStudent(
    membership: Membership,
    student: { id: string; course_id: string | null },
  ) {
    if (membership.role === 'guardian') {
      const { data, error } = await this.supabase.admin
        .from('guardian_links')
        .select('id')
        .eq('guardian_membership_id', membership.id)
        .eq('student_id', student.id)
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        throw new ForbiddenException(
          'El tutor no está vinculado a este estudiante',
        );
      }
      return;
    }
    if (membership.role === 'teacher') {
      const { data, error } = student.course_id
        ? await this.supabase.admin
            .from('subjects')
            .select('id')
            .eq('course_id', student.course_id)
            .eq('teacher_membership_id', membership.id)
            .limit(1)
        : { data: [] as never[], error: null };
      if (error) throw error;
      if (!data?.length) {
        throw new ForbiddenException(
          'El docente no tiene materias asignadas en el curso del estudiante',
        );
      }
    }
  }

  /** Alumnos activos del curso: los dados de baja no aparecen en la planilla. */
  private async courseStudents(institutionId: string, courseId: string) {
    const { data, error } = await this.supabase.admin
      .from('students')
      .select('id, first_name, last_name')
      .eq('institution_id', institutionId)
      .eq('course_id', courseId)
      .eq('status', 'active')
      .order('last_name')
      .order('first_name');
    if (error) throw error;
    return data ?? [];
  }

  /**
   * Normaliza entries a un Map<studentId, {value, observations}>: exige notas
   * entre 1 y 10 con hasta 2 decimales y observaciones de texto de hasta 500
   * caracteres. Un null sin observaciones no crea ni borra nada; un null con
   * observaciones guarda una fila sin nota.
   */
  private validateEntries(entries: SaveGradesDto['entries']) {
    const normalized = new Map<
      string,
      { value: number | null; observations: string | undefined }
    >();
    for (const entry of entries) {
      if (!entry || typeof entry.studentId !== 'string') {
        throw new BadRequestException('Cada entry requiere studentId');
      }
      let observations: string | undefined;
      if (entry.observations !== undefined && entry.observations !== null) {
        if (typeof entry.observations !== 'string') {
          throw new BadRequestException(
            `La observación de ${entry.studentId} debe ser texto`,
          );
        }
        if (entry.observations.length > 500) {
          throw new BadRequestException(
            `La observación de ${entry.studentId} admite hasta 500 caracteres`,
          );
        }
        observations = entry.observations;
      }
      if (entry.value === null) {
        if (observations === undefined) continue;
        normalized.set(entry.studentId, { value: null, observations });
        continue;
      }
      if (typeof entry.value !== 'number' || !Number.isFinite(entry.value)) {
        throw new BadRequestException(
          `La nota de ${entry.studentId} debe ser numérica`,
        );
      }
      if (entry.value < 1 || entry.value > 10) {
        throw new BadRequestException(
          `La nota de ${entry.studentId} debe estar entre 1 y 10`,
        );
      }
      const cents = Math.round(entry.value * 100);
      if (Math.abs(entry.value * 100 - cents) > 1e-9) {
        throw new BadRequestException(
          `La nota de ${entry.studentId} admite hasta 2 decimales`,
        );
      }
      normalized.set(entry.studentId, {
        value: cents / 100,
        observations,
      });
    }
    return normalized;
  }
}
