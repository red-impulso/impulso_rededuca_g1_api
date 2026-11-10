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
  AttendanceStatus,
  SaveAttendanceDto,
} from './dto/save-attendance.dto.js';

export interface AttendanceSheetRow {
  student: { id: string; firstName: string; lastName: string };
  status: AttendanceStatus | null;
}

export interface SaveAttendanceResult {
  saved: number;
}

export interface StudentAttendanceRecord {
  date: string;
  status: AttendanceStatus;
}

export interface StudentAttendanceSummary {
  present: number;
  absent: number;
  late: number;
  justified: number;
  percentage: number | null;
}

export interface StudentAttendanceResult {
  records: StudentAttendanceRecord[];
  summary: StudentAttendanceSummary;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES: readonly AttendanceStatus[] = [
  'present',
  'absent',
  'late',
  'justified',
];

@Injectable()
export class AttendanceService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly events: EventEmitter2,
  ) {}

  /** Planilla diaria: todos los alumnos del curso con su estado o null. */
  async getSheet(
    membership: Membership,
    courseId: string,
    date: string,
  ): Promise<AttendanceSheetRow[]> {
    const course = await this.courseFor(membership, courseId);
    const day = this.assertValidDate(date);

    const students = await this.courseStudents(
      membership.institutionId,
      course.id,
    );

    const { data: records, error } = await this.supabase.admin
      .from('attendance_records')
      .select('student_id, status')
      .eq('course_id', course.id)
      .eq('date', day);
    if (error) throw error;

    const statusByStudent = new Map<string, AttendanceStatus>(
      (records ?? []).map((r: any) => [r.student_id, r.status]),
    );

    return students.map((s: any) => ({
      student: { id: s.id, firstName: s.first_name, lastName: s.last_name },
      status: statusByStudent.get(s.id) ?? null,
    }));
  }

  /**
   * Upsert atómico de la planilla diaria: valida todo el lote antes de
   * escribir. Emite 'attendance.saved' con los ausentes cuando hubo
   * escrituras efectivas.
   */
  async saveSheet(
    membership: Membership,
    dto: SaveAttendanceDto,
  ): Promise<SaveAttendanceResult> {
    if (!dto || !Array.isArray(dto.entries)) {
      throw new BadRequestException(
        'El cuerpo debe incluir courseId, date y entries[]',
      );
    }
    const course = await this.courseFor(membership, dto.courseId);
    const day = this.assertValidDate(dto.date);
    const entries = this.validateEntries(dto.entries);

    const students = await this.courseStudents(
      membership.institutionId,
      course.id,
    );
    const roster = new Set<string>(students.map((s: any) => s.id));
    for (const { studentId } of dto.entries) {
      if (!roster.has(studentId)) {
        throw new BadRequestException(
          `El estudiante ${studentId} no pertenece al curso`,
        );
      }
    }

    if (!entries.size) return { saved: 0 };

    const { data: upserted, error } = await this.supabase.admin
      .from('attendance_records')
      .upsert(
        [...entries].map(([studentId, status]) => ({
          institution_id: membership.institutionId,
          student_id: studentId,
          course_id: course.id,
          date: day,
          status,
          recorded_by: membership.userId,
          updated_at: new Date().toISOString(),
        })),
        { onConflict: 'student_id,date' },
      )
      .select('id, student_id');
    if (error) throw error;

    this.events.emit('attendance.saved', {
      institutionId: membership.institutionId,
      courseId: course.id,
      date: day,
      absentStudentIds: [...entries]
        .filter(([, status]) => status === 'absent')
        .map(([studentId]) => studentId),
    });

    return { saved: upserted?.length ?? entries.size };
  }

  /**
   * Historial de asistencia de un alumno ordenado por fecha descendente con
   * resumen de estados. admin/director: acceso total; teacher: debe dictar
   * al menos una materia en el curso del alumno; guardian: debe estar
   * vinculado vía guardian_links.
   */
  async getStudentAttendance(
    membership: Membership,
    studentId: string,
  ): Promise<StudentAttendanceResult> {
    const student = await this.studentFor(membership, studentId);
    await this.assertCanViewStudent(membership, student);

    const { data, error } = await this.supabase.admin
      .from('attendance_records')
      .select('date, status')
      .eq('institution_id', membership.institutionId)
      .eq('student_id', studentId)
      .order('date', { ascending: false });
    if (error) throw error;

    const records: StudentAttendanceRecord[] = (data ?? []).map((r: any) => ({
      date: r.date,
      status: r.status,
    }));

    const summary: StudentAttendanceSummary = {
      present: 0,
      absent: 0,
      late: 0,
      justified: 0,
      percentage: null,
    };
    for (const r of records) {
      if (r.status === 'present') summary.present += 1;
      else if (r.status === 'absent') summary.absent += 1;
      else if (r.status === 'late') summary.late += 1;
      else if (r.status === 'justified') summary.justified += 1;
    }
    const evaluables = summary.present + summary.late + summary.absent;
    if (evaluables > 0) {
      summary.percentage = Number(
        (((summary.present + summary.late) / evaluables) * 100).toFixed(1),
      );
    }

    return { records, summary };
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

  /** Fecha en formato YYYY-MM-DD, válida y no futura respecto al día de hoy (UTC). */
  private assertValidDate(date: string): string {
    if (typeof date !== 'string' || !DATE_RE.test(date)) {
      throw new BadRequestException('date debe tener formato YYYY-MM-DD');
    }
    const parsed = new Date(`${date}T00:00:00Z`);
    if (
      Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== date
    ) {
      throw new BadRequestException('date no es una fecha válida');
    }
    if (date > new Date().toISOString().slice(0, 10)) {
      throw new BadRequestException(
        'No se puede registrar asistencia a fecha futura',
      );
    }
    return date;
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
        .eq('status', 'active')
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
   * Normaliza entries a un Map<studentId, status>: exige studentId y un
   * estado válido; ante duplicados gana el último.
   */
  private validateEntries(entries: SaveAttendanceDto['entries']) {
    const normalized = new Map<string, AttendanceStatus>();
    for (const entry of entries) {
      if (!entry || typeof entry.studentId !== 'string') {
        throw new BadRequestException('Cada entry requiere studentId');
      }
      if (!STATUSES.includes(entry.status)) {
        throw new BadRequestException(
          `El estado de ${entry.studentId} debe ser present, absent, late o justified`,
        );
      }
      normalized.set(entry.studentId, entry.status);
    }
    return normalized;
  }
}
