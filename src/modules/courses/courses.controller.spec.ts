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
import { CoursesController } from './courses.controller.js';
import { CoursesService } from './courses.service.js';

const INST = '11111111-2222-3333-4444-555555555555';
const COURSE = 'dddddddd-1111-2222-3333-444444444444';

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
    getClass: () => CoursesController,
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
    getClass: () => CoursesController,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  const getUser = vi.fn();
  const guard = new AuthGuard(
    { admin: { auth: { getUser } } } as any,
    new Reflector(),
  );
  return { guard, context, getUser };
}

describe('CoursesController', () => {
  let controller: CoursesController;
  let service: {
    list: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    service = {
      list: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
    };
    const module = await Test.createTestingModule({
      controllers: [CoursesController],
      providers: [
        { provide: CoursesService, useValue: service },
        { provide: SupabaseService, useValue: { admin: {} } },
      ],
    }).compile();
    controller = module.get(CoursesController);
  });

  it('exige AuthGuard + MembershipGuard y @Roles("admin","director")', () => {
    const reflector = new Reflector();
    const guards = Reflect.getMetadata('__guards__', CoursesController);
    expect(guards).toContain(AuthGuard);
    expect(guards).toContain(MembershipGuard);
    expect(reflector.get(ROLES_KEY, CoursesController)).toEqual([
      'admin',
      'director',
    ]);
  });

  describe('restricción de acceso', () => {
    for (const [name, handler] of [
      ['GET /courses', 'list'],
      ['POST /courses', 'create'],
      ['PATCH /courses/:id', 'update'],
      ['DELETE /courses/:id', 'remove'],
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

      it.each(['teacher', 'guardian'])(
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

      it.each(['admin', 'director'])(
        `${name}: rol %s → pasa el guard`,
        async (role) => {
          const { guard, context } = membershipGuardContext(
            controller[handler],
            { role },
          );
          await expect(guard.canActivate(context)).resolves.toBe(true);
        },
      );
    }
  });

  it('GET /courses delega en el service con la membresía activa', async () => {
    const items = [{ id: COURSE, name: '1° A' }];
    service.list.mockResolvedValue(items);
    const membership = {
      id: 'm1',
      userId: 'u1',
      institutionId: INST,
      role: 'admin' as const,
    };
    await expect(controller.list(membership)).resolves.toEqual(items);
    expect(service.list).toHaveBeenCalledWith(membership);
  });

  it('POST /courses delega en el service', async () => {
    const dto = {
      year: 1,
      division: 'A',
      shift: 'morning' as const,
      schoolYear: 2026,
    };
    service.create.mockResolvedValue({ id: COURSE });
    const membership = {
      id: 'm1',
      userId: 'u1',
      institutionId: INST,
      role: 'director' as const,
    };
    await expect(
      controller.create(membership, dto),
    ).resolves.toEqual({ id: COURSE });
    expect(service.create).toHaveBeenCalledWith(membership, dto);
  });

  it('PATCH /courses/:id delega en el service', async () => {
    const dto = { division: 'B' };
    service.update.mockResolvedValue({ id: COURSE, division: 'B' });
    const membership = {
      id: 'm1',
      userId: 'u1',
      institutionId: INST,
      role: 'admin' as const,
    };
    await expect(
      controller.update(membership, COURSE, dto),
    ).resolves.toEqual({ id: COURSE, division: 'B' });
    expect(service.update).toHaveBeenCalledWith(membership, COURSE, dto);
  });

  it('DELETE /courses/:id delega en el service', async () => {
    service.remove.mockResolvedValue(undefined);
    const membership = {
      id: 'm1',
      userId: 'u1',
      institutionId: INST,
      role: 'admin' as const,
    };
    await expect(
      controller.remove(membership, COURSE),
    ).resolves.toBeUndefined();
    expect(service.remove).toHaveBeenCalledWith(membership, COURSE);
  });
});
