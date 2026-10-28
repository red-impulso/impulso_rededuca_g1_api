import { Injectable, NotFoundException } from '@nestjs/common';
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
}
