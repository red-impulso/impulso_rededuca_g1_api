import { ForbiddenException, Injectable } from '@nestjs/common';
import type { Membership } from '../../auth/membership.guard.js';
import { SupabaseService } from '../../supabase/supabase.service.js';

export interface CourseListItem {
  id: string;
  name: string;
  year?: number;
  division?: string;
  shift?: string;
}

@Injectable()
export class CoursesService {
  constructor(private readonly supabase: SupabaseService) {}

  /**
   * Cursos de la institución activa ordenados por year y division. Solo
   * admin/director: el guard filtra por rol y el servicio lo vuelve a
   * verificar por defensa.
   */
  async list(membership: Membership): Promise<CourseListItem[]> {
    if (membership.role !== 'admin' && membership.role !== 'director') {
      throw new ForbiddenException(
        'Solo admin o director pueden listar los cursos',
      );
    }

    const { data, error } = await this.supabase.admin
      .from('courses')
      .select('id, name, year, division, shift')
      .eq('institution_id', membership.institutionId)
      .order('year')
      .order('division');
    if (error) throw error;

    return (data ?? []).map((c: any) => ({
      id: c.id,
      name: c.name,
      year: c.year,
      division: c.division,
      shift: c.shift,
    }));
  }
}
