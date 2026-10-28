import { SetMetadata } from '@nestjs/common';

export type Role = 'admin' | 'director' | 'teacher' | 'guardian';

export const ROLES_KEY = 'roles';

/** Define qué roles de membresía tienen acceso a la ruta o controlador. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
