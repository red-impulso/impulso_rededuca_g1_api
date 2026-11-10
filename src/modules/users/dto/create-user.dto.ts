import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  MEMBERSHIP_ROLES,
  type MembershipRole,
} from '../../memberships/memberships.constants.js';

export class CreateUserDto {
  /** Email de acceso; si ya existe en auth se reutiliza ese usuario. */
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  fullName: string;

  /** Rol de la membresía en la institución activa. */
  @IsIn(MEMBERSHIP_ROLES)
  role: MembershipRole;

  /** Contraseña inicial; si falta se genera una aleatoria. */
  @IsOptional()
  @IsString()
  @MinLength(8)
  temporaryPassword?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  dni?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  lastName?: string;
}
