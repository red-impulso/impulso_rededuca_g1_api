import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { MembershipRequest } from './membership.guard.js';

/** Inyecta la membresía activa resuelta por MembershipGuard. */
export const CurrentMembership = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) =>
    ctx.switchToHttp().getRequest<MembershipRequest>().membership,
);
