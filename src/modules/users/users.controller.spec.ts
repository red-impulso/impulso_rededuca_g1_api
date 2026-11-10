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
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

const INST = '11111111-2222-3333-4444-555555555555';
const M1 = 'aaaaaaaa-0000-0000-0000-000000000001';

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
    getClass: () => UsersController,
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
    getClass: () => UsersController,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  const getUser = vi.fn();
  const guard = new AuthGuard(
    { admin: { auth: { getUser } } } as any,
    new Reflector(),
  );
  return { guard, context, getUser };
}

const membership = {
  id: 'm1',
  userId: 'u1',
  institutionId: INST,
  role: 'admin' as const,
};

describe('UsersController', () => {
  let controller: UsersController;
  let service: {
    list: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    service = {
      list: vi.fn(),
      create: vi.fn(),
    };
    const module = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        { provide: UsersService, useValue: service },
        { provide: SupabaseService, useValue: { admin: {} } },
      ],
    }).compile();
    controller = module.get(UsersController);
  });

  it('exige AuthGuard + MembershipGuard y @Roles("admin")', () => {
    const reflector = new Reflector();
    const guards = Reflect.getMetadata('__guards__', UsersController);
    expect(guards).toContain(AuthGuard);
    expect(guards).toContain(MembershipGuard);
    expect(reflector.get(ROLES_KEY, UsersController)).toEqual(['admin']);
  });

  describe('restricción de acceso', () => {
    for (const [name, handler] of [
      ['GET /users', 'list'],
      ['POST /users', 'create'],
    ] as const) {
      it(`${name}: sin token → 401`, async () => {
        const { guard, context } = authGuardContext(
          controller[handler],
          {},
        );
        await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
          UnauthorizedException,
        );
      });

      it.each(['director', 'teacher', 'guardian'])(
        `${name}: rol %s → 403`,
        async (role) => {
          const { guard, context } = membershipGuardContext(
            controller[handler],
            { role },
          );
          await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
            ForbiddenException,
          );
        },
      );

      it(`${name}: rol admin → pasa el guard`, async () => {
        const { guard, context } = membershipGuardContext(
          controller[handler],
          { role: 'admin' },
        );
        await expect(guard.canActivate(context)).resolves.toBe(true);
      });
    }
  });

  it('GET /users delega en el service con filtros y paginación', async () => {
    service.list.mockResolvedValue({ data: [], total: 0 });
    await expect(
      controller.list(membership, 'lau', 'teacher', 'active', 2, 10),
    ).resolves.toEqual({ data: [], total: 0 });
    expect(service.list).toHaveBeenCalledWith(membership, {
      q: 'lau',
      role: 'teacher',
      status: 'active',
      page: 2,
      limit: 10,
    });
  });

  it('POST /users delega en el service', async () => {
    const dto = {
      email: 'nuevo@mail.com',
      fullName: 'Nuevo Docente',
      role: 'teacher' as const,
    };
    service.create.mockResolvedValue({ membershipId: M1 });
    await expect(controller.create(membership, dto)).resolves.toEqual({
      membershipId: M1,
    });
    expect(service.create).toHaveBeenCalledWith(membership, dto);
  });
});
