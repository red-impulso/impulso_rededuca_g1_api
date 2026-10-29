import { Injectable, NotFoundException } from '@nestjs/common';
import type { Membership } from '../auth/membership.guard.js';
import { SupabaseService } from '../supabase/supabase.service.js';

export interface MeResponse {
  profile: { id: string; fullName: string; phone: string | null };
  memberships: {
    id: string;
    institutionId: string;
    institutionName: string;
    role: string;
  }[];
}

export interface CourseSummary {
  id: string;
  year: number;
  division: string | null;
  shift: string | null;
}

export interface TeacherSubject {
  id: string;
  name: string;
  course: CourseSummary;
}

export interface LinkedStudent {
  id: string;
  firstName: string;
  lastName: string;
  course: Omit<CourseSummary, 'shift'> | null;
}

@Injectable()
export class MeService {
  constructor(private readonly supabase: SupabaseService) {}

  async getMe(userId: string): Promise<MeResponse> {
    const db = this.supabase.admin;

    const { data: profile, error: profileError } = await db
      .from('profiles')
      .select('id, full_name, phone')
      .eq('id', userId)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile) throw new NotFoundException('Perfil no encontrado');

    const { data: rows, error: membershipsError } = await db
      .from('memberships')
      .select('id, institution_id, role, institutions(name)')
      .eq('user_id', userId);
    if (membershipsError) throw membershipsError;

    return {
      profile: {
        id: profile.id,
        fullName: profile.full_name,
        phone: profile.phone ?? null,
      },
      memberships: (rows ?? []).map((m: any) => ({
        id: m.id,
        institutionId: m.institution_id,
        institutionName: m.institutions?.name,
        role: m.role,
      })),
    };
  }

  /** Materias que el docente dicta en la institución activa. */
  async getMySubjects(membership: Membership): Promise<TeacherSubject[]> {
    const rows = await this.teacherSubjectRows(membership);
    return rows.map((s: any) => ({
      id: s.id,
      name: s.name,
      course: toCourseSummary(s.courses),
    }));
  }

  /** Cursos (deduplicados) donde el docente dicta al menos una materia. */
  async getMyCourses(membership: Membership): Promise<CourseSummary[]> {
    const rows = await this.teacherSubjectRows(membership);
    const courses = new Map<string, CourseSummary>();
    for (const s of rows as any[]) {
      if (s.courses && !courses.has(s.courses.id)) {
        courses.set(s.courses.id, toCourseSummary(s.courses));
      }
    }
    return [...courses.values()];
  }

  /** Estudiantes vinculados al tutor activo vía guardian_links. */
  async getMyStudents(membership: Membership): Promise<LinkedStudent[]> {
    const { data, error } = await this.supabase.admin
      .from('guardian_links')
      .select(
        'students!inner(id, first_name, last_name, courses(id, year, division))',
      )
      .eq('guardian_membership_id', membership.id)
      .eq('students.institution_id', membership.institutionId);
    if (error) throw error;

    return (data ?? []).map((row: any) => {
      const st = row.students;
      return {
        id: st.id,
        firstName: st.first_name,
        lastName: st.last_name,
        course: st.courses
          ? {
              id: st.courses.id,
              year: st.courses.year,
              division: st.courses.division ?? null,
            }
          : null,
      };
    });
  }

  private async teacherSubjectRows(membership: Membership) {
    const { data, error } = await this.supabase.admin
      .from('subjects')
      .select('id, name, courses!inner(id, year, division, shift)')
      .eq('teacher_membership_id', membership.id)
      .eq('courses.institution_id', membership.institutionId);
    if (error) throw error;
    return data ?? [];
  }
}

function toCourseSummary(c: any): CourseSummary {
  return {
    id: c.id,
    year: c.year,
    division: c.division ?? null,
    shift: c.shift ?? null,
  };
}
