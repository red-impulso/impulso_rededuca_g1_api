export const MEMBERSHIP_ROLES = [
  'admin',
  'director',
  'teacher',
  'guardian',
] as const;

export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

export const MEMBERSHIP_STATUSES = [
  'active',
  'inactive',
  'pending',
  'blocked',
] as const;

export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

/**
 * Estados que cuentan como membresía vigente. Incluye los valores
 * heredados de M8 ('activo', 'licencia') que conviven en la misma
 * columna status como estado laboral docente.
 */
export const ACTIVE_MEMBERSHIP_STATUSES = [
  'active',
  'activo',
  'licencia',
] as const;
