import {
  Equals,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';

export const LEAD_LEVELS = [
  'Inicial',
  'Primario',
  'Secundario',
  'Terciario / Superior',
] as const;

export type LeadLevel = (typeof LEAD_LEVELS)[number];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^\+?\d{8,15}$/;

/** Acepta un email válido o un teléfono de 8 a 15 dígitos. */
export function IsEmailOrPhone(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isEmailOrPhone',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'string') return false;
          const trimmed = value.trim();
          if (!trimmed) return false;
          return (
            EMAIL_RE.test(trimmed) ||
            PHONE_RE.test(trimmed.replace(/[\s()-]/g, ''))
          );
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} debe ser un email válido o un teléfono de 8 a 15 dígitos`;
        },
      },
    });
  };
}

export class CreateLeadDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  institutionName: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  contactName: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  city: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  contactRole: string;

  @IsIn(LEAD_LEVELS)
  level: LeadLevel;

  @IsString()
  @IsNotEmpty()
  @MaxLength(254)
  @IsEmailOrPhone()
  contactChannel: string;

  @IsInt()
  @Min(1)
  @Max(100000)
  studentCount: number;

  @IsOptional()
  @IsString()
  @MaxLength(600)
  comment?: string;

  @Equals(true, { message: 'Debe aceptar la política de privacidad' })
  privacyAccepted: boolean;

  /** Honeypot anti-spam: debe llegar vacío; si trae texto es un bot. */
  @IsOptional()
  @IsString()
  website?: string;
}
