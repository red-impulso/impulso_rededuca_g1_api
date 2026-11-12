import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

/** Permite null explícito para borrar el campo opcional. */
const nullable = () => ValidateIf((_o, v) => v !== null && v !== undefined);

export class UpdateInstitutionDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @nullable()
  @IsString()
  @MaxLength(40)
  code?: string | null;

  @IsOptional()
  @nullable()
  @IsString()
  @MaxLength(80)
  level?: string | null;

  @IsOptional()
  @nullable()
  @IsString()
  @MaxLength(200)
  address?: string | null;

  @IsOptional()
  @nullable()
  @IsString()
  @MaxLength(120)
  city?: string | null;

  @IsOptional()
  @nullable()
  @IsString()
  @MaxLength(120)
  province?: string | null;

  @IsOptional()
  @nullable()
  @IsString()
  @MaxLength(40)
  phone?: string | null;

  @IsOptional()
  @nullable()
  @IsEmail()
  @MaxLength(120)
  email?: string | null;

  @IsOptional()
  @nullable()
  @IsString()
  @MaxLength(200)
  website?: string | null;

  @IsOptional()
  @nullable()
  @IsString()
  @MaxLength(300)
  logoUrl?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1900)
  @Max(2100)
  schoolYear?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(60, { each: true })
  levels?: string[];

  /**
   * Grilla de horarios de la institución (estructura libre en JSONB).
   * Acepta el objeto o el texto "HH:MM – HH:MM" que envía el Front;
   * la validación de forma la hace el servicio.
   */
  @IsOptional()
  @nullable()
  schedule?: Record<string, unknown> | string | null;

  @IsOptional()
  @IsBoolean()
  familyCommunications?: boolean;

  @IsOptional()
  @IsBoolean()
  dailyAttendance?: boolean;
}

export const INSTITUTION_STATUSES = [
  'activa',
  'en-implementacion',
  'suspendida',
] as const;

export type InstitutionStatus = (typeof INSTITUTION_STATUSES)[number];
