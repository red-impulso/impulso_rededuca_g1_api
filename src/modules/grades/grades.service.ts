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
}

export interface SaveGradesResult {
  saved: number;
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
      .select('student_id, value')
      .eq('subject_id', subjectId)
      .eq('period_id', periodId);
    if (error) throw error;

    const valueByStudent = new Map<string, number>(
      (grades ?? []).map((g: any) => [g.student_id, Number(g.value)]),
    );

    return students.map((s: any) => ({
      student: { id: s.id, firstName: s.first_name, lastName: s.last_name },
      value: valueByStudent.get(s.id) ?? null,
    }));
  }

  /**
   * Upsert atómico de la planilla: valida todo el lote antes de escribir,
   * inserta/actualiza solo las notas que cambiaron y audita cada cambio en
   * grade_changes. Emite 'grades.saved' cuando hubo escrituras efectivas.
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
      .select('id, student_id, value')
      .eq('subject_id', subjectId)
      .eq('period_id', periodId);
    if (existingError) throw existingError;

    const previousByStudent = new Map<string, number>(
      (existing ?? []).map((g: any) => [g.student_id, Number(g.value)]),
    );

    const changes = [...entries].filter(
      ([studentId, value]) => previousByStudent.get(studentId) !== value,
    );
    if (!changes.length) return { saved: 0 };

    const { data: upserted, error: upsertError } = await db
      .from('grades')
      .upsert(
        changes.map(([studentId, value]) => ({
          institution_id: membership.institutionId,
          student_id: studentId,
          subject_id: subjectId,
          period_id: periodId,
          value,
          updated_at: new Date().toISOString(),
        })),
        { onConflict: 'student_id,subject_id,period_id' },
      )
      .select('id, student_id');
    if (upsertError) throw upsertError;

    const newValueByStudent = new Map(changes);
    const { error: auditError } = await db.from('grade_changes').insert(
      (upserted ?? []).map((row: any) => ({
        grade_id: row.id,
        institution_id: membership.institutionId,
        previous_value: previousByStudent.get(row.student_id) ?? null,
        new_value: newValueByStudent.get(row.student_id) ?? null,
        changed_by: membership.userId,
      })),
    );
    if (auditError) throw auditError;

    this.events.emit('grades.saved', {
      institutionId: membership.institutionId,
      subjectId,
      periodId,
      studentIds: (upserted ?? []).map((row: any) => row.student_id),
    });

    return { saved: upserted?.length ?? changes.length };
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

  private async courseStudents(institutionId: string, courseId: string) {
    const { data, error } = await this.supabase.admin
      .from('students')
      .select('id, first_name, last_name')
      .eq('institution_id', institutionId)
      .eq('course_id', courseId)
      .order('last_name')
      .order('first_name');
    if (error) throw error;
    return data ?? [];
  }

  /**
   * Normaliza entries a un Map<studentId, number>: descarta los null (no crean
   * ni borran notas) y exige números entre 1 y 10 con hasta 2 decimales.
   */
  private validateEntries(entries: SaveGradesDto['entries']) {
    const normalized = new Map<string, number>();
    for (const entry of entries) {
      if (!entry || typeof entry.studentId !== 'string') {
        throw new BadRequestException('Cada entry requiere studentId');
      }
      if (entry.value === null) continue;
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
      normalized.set(entry.studentId, cents / 100);
    }
    return normalized;
  }
}
