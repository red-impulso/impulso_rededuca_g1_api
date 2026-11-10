import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthGuard } from '../../auth/auth.guard.js';
import { MembershipGuard } from '../../auth/membership.guard.js';
import { ROLES_KEY } from '../../auth/roles.decorator.js';
import { SupabaseService } from '../../supabase/supabase.service.js';
import { InstitutionController } from './institution.controller.js';
import { InstitutionService } from './institution.service.js';

const INST = '11111111-2222-3333-4444-555555555555';

/** MembershipGuard real con una membresía del rol dado sobre `handler`. */
function membershipGuardContext(
  handler: object,
  opts: { role?: string } = {},
) {
  const request: any = {
    headers: { 'x-institution-id': INST },
    user: { id: 'u1', email: 'a@b.c' },
  };
  const context = {
    getHandler: () => handler,
    getClass: () => InstitutionController,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  const rows = opts.role
    ? [{ id: 'm1', user_id: 'u1', institution_id: INST, role: opts.role }]
    : [];
  const q: any = {
    select: () => q,
    eq: () => q,
    then: (res: any, rej: any) =>
      Promise.resolve({ data: rows, error: null }).then(res, rej),
  };
  const guard = new MembershipGuard(
    { admin: { from: () => q } } as any,
    new Reflector(),
  );
  return { guard, context, request };
}

function authGuardContext(handler: object, headers: Record<string, string>) {
  const request: any = { headers };
  const context = {
    getHandler: () => handler,
    getClass: () => InstitutionController,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  const getUser = vi.fn();
  const guard = new AuthGuard(
    { admin: { auth: { getUser } } } as any,
    new Reflector(),
  );
  return { guard, context, getUser };
}

describe('InstitutionController · PATCH /institution', () => {
  let controller: InstitutionController;
  let service: { update: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    service = { update: vi.fn() };
    const module = await Test.createTestingModule({
      controllers: [InstitutionController],
      providers: [
        { provide: InstitutionService, useValue: service },
        { provide: SupabaseService, useValue: { admin: {} } },
      ],
    }).compile();
    controller = module.get(InstitutionController);
  });

  it('exige AuthGuard + MembershipGuard y @Roles("admin","director")', () => {
    const reflector = new Reflector();
    const guards = Reflect.getMetadata('__guards__', InstitutionController);
    expect(guards).toContain(AuthGuard);
    expect(guards).toContain(MembershipGuard);
    expect(reflector.get(ROLES_KEY, InstitutionController)).toEqual([
      'admin',
      'director',
    ]);
  });

  it('sin token → 401', async () => {
    const { guard, context } = authGuardContext(controller.update, {});
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it.each(['teacher', 'guardian'])('rol %s → 403', async (role) => {
    const { guard, context } = membershipGuardContext(controller.update, {
      role,
    });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it.each(['admin', 'director'])(
    'rol %s → pasa el guard y actualiza',
    async (role) => {
      const { guard, context } = membershipGuardContext(controller.update, {
        role,
      });
      await expect(guard.canActivate(context)).resolves.toBe(true);

      const updated = { id: INST, name: 'Colegio X' };
      service.update.mockResolvedValue(updated);
      const dto = { name: 'Colegio X' };
      await expect(
        controller.update(
          {
            id: 'm1',
            userId: 'u1',
            institutionId: INST,
            role: role as 'admin' | 'director',
          },
          dto,
        ),
      ).resolves.toEqual(updated);
      expect(service.update).toHaveBeenCalledWith(
        expect.objectContaining({ institutionId: INST }),
        dto,
      );
    },
  );
});
