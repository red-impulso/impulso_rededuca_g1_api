import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SupabaseService } from '../supabase/supabase.service.js';
import type { AuthenticatedRequest } from './auth.guard.js';
import { ROLES_KEY, type Role } from './roles.decorator.js';

export interface Membership {
  id: string;
  userId: string;
  institutionId: string;
  role: Role;
}

export type MembershipRequest = AuthenticatedRequest & {
  membership: Membership;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Prioridad de roles: menor número = mayor rango. */
const ROLE_RANK: Record<Role, number> = {
  admin: 0,
  director: 1,
  teacher: 2,
  guardian: 3,
};

@Injectable()
export class MembershipGuard implements CanActivate {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<MembershipRequest>();

    const header = request.headers['x-institution-id'];
    const institutionId = Array.isArray(header) ? header[0] : header;
    if (!institutionId || !UUID_RE.test(institutionId)) {
      throw new BadRequestException(
        'Falta o es inválido el header X-Institution-Id',
      );
    }

    const user = request.user;
    if (!user) throw new UnauthorizedException();

    const { data: rows, error } = await this.supabase.admin
      .from('memberships')
      .select('id, user_id, institution_id, role')
      .eq('user_id', user.id)
      .eq('institution_id', institutionId);
    if (error) throw error;
    if (!rows?.length) throw new ForbiddenException();

    const row = rows.reduce((a: any, b: any) =>
      ROLE_RANK[b.role as Role] < ROLE_RANK[a.role as Role] ? b : a,
    );

    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required?.length && !required.includes(row.role)) {
      throw new ForbiddenException();
    }

    request.membership = {
      id: row.id,
      userId: row.user_id,
      institutionId: row.institution_id,
      role: row.role,
    };
    return true;
  }
}
