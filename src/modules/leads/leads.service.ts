import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service.js';
import type { CreateLeadDto } from './dto/create-lead.dto.js';
import {
  LEAD_STATUSES,
  type LeadStatus,
  type UpdateLeadDto,
} from './dto/update-lead.dto.js';

export interface LeadItem {
  id: string;
  institutionName: string;
  contactName: string;
  city: string;
  contactRole: string;
  level: string;
  contactChannel: string;
  studentCount: number;
  comment: string | null;
  status: LeadStatus;
  createdAt: string;
}

const LEAD_COLUMNS =
  'id, institution_name, contact_name, city, contact_role, level, contact_channel, student_count, comment, status, created_at';

const INVALID_STATUS = "status debe ser 'new', 'contacted' o 'discarded'";

@Injectable()
export class LeadsService {
  constructor(private readonly supabase: SupabaseService) {}

  /** Registra un lead del formulario público de contacto. */
  async create(dto: CreateLeadDto) {
    if (dto?.privacyAccepted !== true) {
      throw new BadRequestException('Debe aceptar la política de privacidad');
    }
    const { data, error } = await this.supabase.admin
      .from('leads')
      .insert({
        institution_name: dto.institutionName.trim(),
        contact_name: dto.contactName.trim(),
        city: dto.city.trim(),
        contact_role: dto.contactRole.trim(),
        level: dto.level,
        contact_channel: dto.contactChannel.trim(),
        student_count: dto.studentCount,
        comment: dto.comment?.trim() || null,
        privacy_accepted_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    if (error) throw error;
    return { id: data.id as string };
  }

  /** Lista leads del más nuevo al más viejo; `status` es opcional. */
  async list(status?: string): Promise<LeadItem[]> {
    if (status !== undefined && !isLeadStatus(status)) {
      throw new BadRequestException(INVALID_STATUS);
    }
    let query = this.supabase.admin
      .from('leads')
      .select(LEAD_COLUMNS)
      .order('created_at', { ascending: false });
    if (status) query = query.eq('status', status);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []).map(mapLead);
  }

  /** Cambia el estado de un lead; 404 si no existe. */
  async updateStatus(id: string, dto: UpdateLeadDto): Promise<LeadItem> {
    if (!isLeadStatus(dto?.status)) {
      throw new BadRequestException(INVALID_STATUS);
    }
    const { data, error } = await this.supabase.admin
      .from('leads')
      .update({ status: dto.status })
      .eq('id', id)
      .select(LEAD_COLUMNS)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new NotFoundException('Lead no encontrado');
    return mapLead(data);
  }
}

function isLeadStatus(value: unknown): value is LeadStatus {
  return (
    typeof value === 'string' &&
    (LEAD_STATUSES as readonly string[]).includes(value)
  );
}

function mapLead(r: any): LeadItem {
  return {
    id: r.id,
    institutionName: r.institution_name,
    contactName: r.contact_name,
    city: r.city,
    contactRole: r.contact_role,
    level: r.level,
    contactChannel: r.contact_channel,
    studentCount: r.student_count,
    comment: r.comment,
    status: r.status,
    createdAt: r.created_at,
  };
}
