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
import { StudentsController } from './students.controller.js';
import { StudentsService } from './students.service.js';

const INST = '11111111-2222-3333-4444-555555555555';
const COURSE = 'dddddddd-1111-2222-3333-444444444444';
const ST1 = 'cccccccc-0000-0000-0000-000000000001';

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
    getClass: () => StudentsController,
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
    getClass: () => StudentsController,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  const getUser = vi.fn();
  const guard = new AuthGuard(
    { admin: { auth: { getUser } } } as any,
    new Reflector(),
  );
  return { guard, context, getUser };
}

describe('StudentsController', () => {
  let controller: StudentsController;
  let service: {
    list: ReturnType<typeof vi.fn>;
    profile: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    service = {
      list: vi.fn(),
      profile: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
    };
    const module = await Test.createTestingModule({
      controllers: [StudentsController],
      providers: [
        { provide: StudentsService, useValue: service },
        { provide: SupabaseService, useValue: { admin: {} } },
      ],
    }).compile();
    controller = module.get(StudentsController);
  });

  it('exige AuthGuard + MembershipGuard y @Roles("admin","director")', () => {
    const reflector = new Reflector();
    const guards = Reflect.getMetadata('__guards__', StudentsController);
    expect(guards).toContain(AuthGuard);
    expect(guards).toContain(MembershipGuard);
    expect(reflector.get(ROLES_KEY, StudentsController)).toEqual([
      'admin',
      'director',
    ]);
  });

  describe('restricción de acceso', () => {
    for (const [name, handler] of [
      ['GET /students', 'list'],
      ['GET /students/:id/profile', 'profile'],
      ['POST /students', 'create'],
      ['PATCH /students/:id', 'update'],
      ['DELETE /students/:id', 'remove'],
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

  const membership = {
    id: 'm1',
    userId: 'u1',
    institutionId: INST,
    role: 'admin' as const,
  };

  it('GET /students delega los query params en el service', async () => {
    service.list.mockResolvedValue({ data: [], total: 0, page: 2, limit: 10 });
    await expect(
      controller.list(membership, COURSE, 'gar', 'active', 2, 10),
    ).resolves.toEqual({ data: [], total: 0, page: 2, limit: 10 });
    expect(service.list).toHaveBeenCalledWith(membership, {
      courseId: COURSE,
      q: 'gar',
      status: 'active',
      page: 2,
      limit: 10,
    });
  });

  it('GET /students sin params usa page 1 y limit 25', async () => {
    service.list.mockResolvedValue({ data: [], total: 0, page: 1, limit: 25 });
    await controller.list(membership);
    expect(service.list).toHaveBeenCalledWith(membership, {
      courseId: undefined,
      q: undefined,
      status: undefined,
      page: 1,
      limit: 25,
    });
  });

  it('GET /students/:id/profile delega en el service', async () => {
    service.profile.mockResolvedValue({ personal: { id: ST1 } });
    await expect(controller.profile(membership, ST1)).resolves.toEqual({
      personal: { id: ST1 },
    });
    expect(service.profile).toHaveBeenCalledWith(membership, ST1);
  });

  it('POST /students delega en el service', async () => {
    const dto = { firstName: 'Ana', lastName: 'García', courseId: COURSE };
    service.create.mockResolvedValue({ id: ST1 });
    await expect(controller.create(membership, dto as any)).resolves.toEqual({
      id: ST1,
    });
    expect(service.create).toHaveBeenCalledWith(membership, dto);
  });

  it('PATCH /students/:id delega en el service', async () => {
    const dto = { courseId: COURSE };
    service.update.mockResolvedValue({ id: ST1, courseId: COURSE });
    await expect(
      controller.update(membership, ST1, dto),
    ).resolves.toEqual({ id: ST1, courseId: COURSE });
    expect(service.update).toHaveBeenCalledWith(membership, ST1, dto);
  });

  it('DELETE /students/:id delega en el service', async () => {
    service.remove.mockResolvedValue(undefined);
    await expect(
      controller.remove(membership, ST1),
    ).resolves.toBeUndefined();
    expect(service.remove).toHaveBeenCalledWith(membership, ST1);
  });
});
