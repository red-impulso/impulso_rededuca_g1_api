import { ForbiddenException, Injectable } from '@nestjs/common';
import type { Membership } from '../../auth/membership.guard.js';
import { SupabaseService } from '../../supabase/supabase.service.js';

export interface DashboardStudent {
  id: string;
  firstName: string;
  lastName: string;
}

export interface DashboardCourse {
  id: string;
  name: string;
}

export interface LowAttendanceRow {
  student: DashboardStudent;
  course: DashboardCourse;
  percentage: number;
}

export interface GradeAverageRow {
  subject: { id: string; name: string };
  course: DashboardCourse;
  average: number | null;
}

export interface DashboardSummary {
  students: number;
  courses: number;
  teachers: number;
  attendanceAverage: number | null;
  lowAttendance: LowAttendanceRow[];
  gradeAverages: GradeAverageRow[];
}

const LOW_ATTENDANCE_THRESHOLD = 85;
const LOW_ATTENDANCE_WINDOW_DAYS = 30;

/** Porcentaje oficial: (present + late) / evaluables; los justified no computan. */
function attendancePercentage(
  present: number,
  late: number,
  absent: number,
): number | null {
  const evaluables = present + late + absent;
  if (!evaluables) return null;
  return Number((((present + late) / evaluables) * 100).toFixed(1));
}

@Injectable()
export class DashboardService {
  constructor(private readonly supabase: SupabaseService) {}

  /**
   * Indicadores agregados de la institución activa. Solo admin/director: el
   * guard filtra por rol y el servicio lo vuelve a verificar por defensa.
   */
  async getSummary(membership: Membership): Promise<DashboardSummary> {
    if (membership.role !== 'admin' && membership.role !== 'director') {
      throw new ForbiddenException(
        'Solo admin o director pueden acceder al tablero',
      );
    }
    const institutionId = membership.institutionId;
    const db = this.supabase.admin;
    const since = new Date(
      Date.now() - LOW_ATTENDANCE_WINDOW_DAYS * 86_400_000,
    )
      .toISOString()
      .slice(0, 10);

    const [
      students,
      courses,
      teachers,
      attendance,
      recent,
      subjects,
      grades,
    ] = await Promise.all([
      db
        .from('students')
        .select('id', { count: 'exact', head: true })
        .eq('institution_id', institutionId),
      db
        .from('courses')
        .select('id', { count: 'exact', head: true })
        .eq('institution_id', institutionId),
      db
        .from('memberships')
        .select('id', { count: 'exact', head: true })
        .eq('institution_id', institutionId)
        .eq('role', 'teacher'),
      db
        .from('attendance_records')
        .select('status')
        .eq('institution_id', institutionId),
      db
        .from('attendance_records')
        .select(
          'status, student_id, students!inner(id, first_name, last_name), courses!inner(id, name)',
        )
        .eq('institution_id', institutionId)
        .gte('date', since),
      db
        .from('subjects')
        .select('id, name, courses!inner(id, name)')
        .eq('courses.institution_id', institutionId),
      db
        .from('grades')
        .select('subject_id, value')
        .eq('institution_id', institutionId)
        .not('value', 'is', null),
    ]);

    for (const res of [
      students,
      courses,
      teachers,
      attendance,
      recent,
      subjects,
      grades,
    ]) {
      if (res.error) throw res.error;
    }

    const totals = { present: 0, late: 0, absent: 0 };
    for (const r of attendance.data ?? []) {
      const status = (r as any).status;
      if (status === 'present') totals.present += 1;
      else if (status === 'late') totals.late += 1;
      else if (status === 'absent') totals.absent += 1;
    }
    const attendanceAverage = attendancePercentage(
      totals.present,
      totals.late,
      totals.absent,
    );

    const byStudent = new Map<
      string,
      {
        student: DashboardStudent;
        course: DashboardCourse;
        present: number;
        late: number;
        absent: number;
      }
    >();
    for (const r of recent.data ?? []) {
      const row = r as any;
      const student = Array.isArray(row.students)
        ? row.students[0]
        : row.students;
      const course = Array.isArray(row.courses) ? row.courses[0] : row.courses;
      let acc = byStudent.get(row.student_id);
      if (!acc) {
        acc = {
          student: {
            id: student?.id ?? row.student_id,
            firstName: student?.first_name ?? '',
            lastName: student?.last_name ?? '',
          },
          course: { id: course?.id ?? '', name: course?.name ?? '' },
          present: 0,
          late: 0,
          absent: 0,
        };
        byStudent.set(row.student_id, acc);
      }
      if (row.status === 'present') acc.present += 1;
      else if (row.status === 'late') acc.late += 1;
      else if (row.status === 'absent') acc.absent += 1;
    }

    const lowAttendance: LowAttendanceRow[] = [...byStudent.values()]
      .map((acc) => ({
        student: acc.student,
        course: acc.course,
        percentage: attendancePercentage(acc.present, acc.late, acc.absent),
      }))
      .filter(
        (row): row is LowAttendanceRow =>
          row.percentage !== null && row.percentage < LOW_ATTENDANCE_THRESHOLD,
      )
      .sort((a, b) => a.percentage - b.percentage);

    const gradeBySubject = new Map<string, { sum: number; count: number }>();
    for (const g of grades.data ?? []) {
      const row = g as any;
      const acc = gradeBySubject.get(row.subject_id) ?? { sum: 0, count: 0 };
      acc.sum += Number(row.value);
      acc.count += 1;
      gradeBySubject.set(row.subject_id, acc);
    }

    const gradeAverages: GradeAverageRow[] = (subjects.data ?? [])
      .map((s: any) => {
        const course = Array.isArray(s.courses) ? s.courses[0] : s.courses;
        const acc = gradeBySubject.get(s.id);
        return {
          subject: { id: s.id, name: s.name },
          course: { id: course?.id ?? '', name: course?.name ?? '' },
          average: acc?.count ? Number((acc.sum / acc.count).toFixed(2)) : null,
        };
      })
      .sort(
        (a, b) =>
          a.subject.name.localeCompare(b.subject.name, 'es') ||
          a.course.name.localeCompare(b.course.name, 'es'),
      );

    return {
      students: students.count ?? 0,
      courses: courses.count ?? 0,
      teachers: teachers.count ?? 0,
      attendanceAverage,
      lowAttendance,
      gradeAverages,
    };
  }
}
