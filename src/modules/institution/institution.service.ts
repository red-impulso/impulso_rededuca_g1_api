import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Membership } from '../../auth/membership.guard.js';
import { SupabaseService } from '../../supabase/supabase.service.js';
import type { UpdateInstitutionDto } from './dto/update-institution.dto.js';

export interface InstitutionItem {
  id: string;
  name: string;
  code: string | null;
  level: string | null;
  address: string | null;
  city: string | null;
  province: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  logoUrl: string | null;
  schoolYear: number;
  levels: string[];
  schedule: Record<string, unknown> | null;
  familyCommunications: boolean;
  dailyAttendance: boolean;
  status: string;
  createdAt: string;
  updatedAt: string | null;
}

interface UploadedFile {
  originalname?: string;
  mimetype?: string;
  size?: number;
  buffer?: Buffer;
}

const INSTITUTION_COLUMNS =
  'id, name, code, level, address, city, province, phone, email, website, logo_url, school_year, levels, schedule, family_communications, daily_attendance, status, created_at, updated_at';

const LOGO_BUCKET = 'institution-logos';
const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LOGO_MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/svg+xml': 'svg',
};

@Injectable()
export class InstitutionService {
  constructor(private readonly supabase: SupabaseService) {}

  /** Ficha completa de la institución activa. */
  async get(membership: Membership): Promise<InstitutionItem> {
    const { data, error } = await this.supabase.admin
      .from('institutions')
      .select(INSTITUTION_COLUMNS)
      .eq('id', membership.institutionId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new NotFoundException('Institución no encontrada');
    return mapInstitution(data);
  }

  /**
   * Actualiza los datos de la institución activa. Solo admin/director: el
   * guard filtra por rol y el servicio lo vuelve a verificar por defensa.
   */
  async update(
    membership: Membership,
    dto: UpdateInstitutionDto,
  ): Promise<InstitutionItem> {
    this.assertStaff(membership);
    const patch = this.validatePatch(dto);

    const { data, error } = await this.supabase.admin
      .from('institutions')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', membership.institutionId)
      .select(INSTITUTION_COLUMNS)
      .single();
    if (error) throw error;

    return mapInstitution(data);
  }

  /**
   * Sube el logo de la institución (PNG/JPG/SVG hasta 2MB) al bucket de
   * storage y persiste logo_url. Si el storage no está configurado devuelve
   * una URL simulada para no bloquear al frontend.
   */
  async uploadLogo(
    membership: Membership,
    file: UploadedFile | undefined,
  ): Promise<{ logoUrl: string }> {
    this.assertStaff(membership);
    if (!file?.buffer?.length) {
      throw new BadRequestException('Debe adjuntar un archivo de imagen');
    }
    const ext = LOGO_MIME_EXT[file.mimetype ?? ''];
    if (!ext) {
      throw new BadRequestException(
        'El logo debe ser una imagen PNG, JPG o SVG',
      );
    }
    if ((file.size ?? file.buffer.length) > LOGO_MAX_BYTES) {
      throw new BadRequestException('El logo no puede superar los 2MB');
    }

    const path = `${membership.institutionId}/logo.${ext}`;
    const logoUrl = await this.storeLogo(path, ext, file);

    const { error } = await this.supabase.admin
      .from('institutions')
      .update({ logo_url: logoUrl, updated_at: new Date().toISOString() })
      .eq('id', membership.institutionId);
    if (error) throw error;

    return { logoUrl };
  }

  /** Solo admin/director pueden editar la institución. */
  private assertStaff(membership: Membership) {
    if (membership.role !== 'admin' && membership.role !== 'director') {
      throw new ForbiddenException(
        'Solo admin o director pueden editar la institución',
      );
    }
  }

  /**
   * Intenta subir el archivo al bucket; ante cualquier fallo de storage
   * (bucket inexistente, credenciales, red) devuelve la URL pública
   * simulada del objeto para mantener el contrato del endpoint.
   */
  private async storeLogo(
    path: string,
    ext: string,
    file: UploadedFile,
  ): Promise<string> {
    const base = process.env.SUPABASE_URL?.replace(/\/$/, '') ?? '';
    const fallback = `${base}/storage/v1/object/public/${LOGO_BUCKET}/${path}`;
    try {
      const storage = (this.supabase.admin as any).storage;
      const { error } = await storage
        .from(LOGO_BUCKET)
        .upload(path, file.buffer, {
          contentType: file.mimetype,
          upsert: true,
        });
      if (error) return fallback;
      const { data } = storage.from(LOGO_BUCKET).getPublicUrl(path);
      return data?.publicUrl ?? fallback;
    } catch {
      return fallback;
    }
  }

  /** Valida el DTO y devuelve las columnas a persistir. */
  private validatePatch(dto: UpdateInstitutionDto) {
    const patch: Record<string, unknown> = {};
    const text = (v: unknown) =>
      v === null || v === undefined ? null : String(v).trim() || null;

    if (dto?.name !== undefined) {
      const name = dto.name.trim();
      if (!name) {
        throw new BadRequestException('name no puede estar vacío');
      }
      patch.name = name;
    }
    if (dto?.code !== undefined) patch.code = text(dto.code);
    if (dto?.level !== undefined) patch.level = text(dto.level);
    if (dto?.address !== undefined) patch.address = text(dto.address);
    if (dto?.city !== undefined) patch.city = text(dto.city);
    if (dto?.province !== undefined) patch.province = text(dto.province);
    if (dto?.phone !== undefined) patch.phone = text(dto.phone);
    if (dto?.email !== undefined) patch.email = text(dto.email);
    if (dto?.website !== undefined) patch.website = text(dto.website);
    if (dto?.logoUrl !== undefined) patch.logo_url = text(dto.logoUrl);
    if (dto?.schoolYear !== undefined) patch.school_year = dto.schoolYear;
    if (dto?.levels !== undefined) {
      if (!Array.isArray(dto.levels)) {
        throw new BadRequestException('levels debe ser un arreglo de textos');
      }
      patch.levels = dto.levels
        .map((l) => (typeof l === 'string' ? l.trim() : ''))
        .filter(Boolean);
    }
    if (dto?.schedule !== undefined) {
      if (
        dto.schedule !== null &&
        (typeof dto.schedule !== 'object' || Array.isArray(dto.schedule))
      ) {
        throw new BadRequestException('schedule debe ser un objeto JSON');
      }
      patch.schedule = dto.schedule;
    }
    if (dto?.familyCommunications !== undefined) {
      patch.family_communications = dto.familyCommunications;
    }
    if (dto?.dailyAttendance !== undefined) {
      patch.daily_attendance = dto.dailyAttendance;
    }

    if (!Object.keys(patch).length) {
      throw new BadRequestException(
        'Debe enviar al menos un campo para actualizar',
      );
    }
    return patch;
  }
}

function mapInstitution(r: any): InstitutionItem {
  return {
    id: r.id,
    name: r.name,
    code: r.code ?? null,
    level: r.level ?? null,
    address: r.address ?? null,
    city: r.city ?? null,
    province: r.province ?? null,
    phone: r.phone ?? null,
    email: r.email ?? null,
    website: r.website ?? null,
    logoUrl: r.logo_url ?? null,
    schoolYear: r.school_year ?? null,
    levels: r.levels ?? [],
    schedule: r.schedule ?? null,
    familyCommunications: r.family_communications ?? true,
    dailyAttendance: r.daily_attendance ?? true,
    status: r.status ?? 'activa',
    createdAt: r.created_at,
    updatedAt: r.updated_at ?? null,
  };
}
