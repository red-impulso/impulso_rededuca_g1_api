import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Membership } from '../../auth/membership.guard.js';
import { SupabaseService } from '../../supabase/supabase.service.js';
import type { UpdateInstitutionDto } from './dto/update-institution.dto.js';

export interface InstitutionItem {
  id: string;
  name: string;
  address: string | null;
  levels: string[];
  createdAt: string;
}

@Injectable()
export class InstitutionService {
  constructor(private readonly supabase: SupabaseService) {}

  /**
   * Actualiza los datos de la institución activa. Solo admin/director: el
   * guard filtra por rol y el servicio lo vuelve a verificar por defensa.
   */
  async update(
    membership: Membership,
    dto: UpdateInstitutionDto,
  ): Promise<InstitutionItem> {
    if (membership.role !== 'admin' && membership.role !== 'director') {
      throw new ForbiddenException(
        'Solo admin o director pueden editar la institución',
      );
    }

    const patch: Record<string, unknown> = {};
    if (dto?.name !== undefined) {
      const name = dto.name.trim();
      if (!name) {
        throw new BadRequestException('name no puede estar vacío');
      }
      patch.name = name;
    }
    if (dto?.address !== undefined) {
      patch.address = dto.address.trim() || null;
    }
    if (dto?.levels !== undefined) {
      if (!Array.isArray(dto.levels)) {
        throw new BadRequestException('levels debe ser un arreglo de textos');
      }
      patch.levels = dto.levels
        .map((l) => (typeof l === 'string' ? l.trim() : ''))
        .filter(Boolean);
    }
    if (!Object.keys(patch).length) {
      throw new BadRequestException(
        'Debe enviar al menos un campo para actualizar',
      );
    }

    const { data, error } = await this.supabase.admin
      .from('institutions')
      .update(patch)
      .eq('id', membership.institutionId)
      .select('id, name, address, levels, created_at')
      .single();
    if (error) throw error;

    return {
      id: data.id,
      name: data.name,
      address: data.address ?? null,
      levels: data.levels ?? [],
      createdAt: data.created_at,
    };
  }
}
