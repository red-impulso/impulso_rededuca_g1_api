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
import { SubjectsController } from './subjects.controller.js';
import { SubjectsService } from './subjects.service.js';

const INST = '11111111-2222-3333-4444-555555555555';
const SUBJECT = 'eeeeeeee-1111-2222-3333-444444444444';
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
    getClass: () => SubjectsController,
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
    getClass: () => SubjectsController,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  const getUser = vi.fn();
  const guard = new AuthGuard(
    { admin: { auth: { getUser } } } as any,
    new Reflector(),
  );
  return { guard, context, getUser };
}

describe('SubjectsController', () => {
  let controller: SubjectsController;
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
      controllers: [SubjectsController],
      providers: [
        { provide: SubjectsService, useValue: service },
        { provide: SupabaseService, useValue: { admin: {} } },
      ],
    }).compile();
    controller = module.get(SubjectsController);
  });

  it('exige AuthGuard + MembershipGuard y @Roles("admin","director")', () => {
    const reflector = new Reflector();
    const guards = Reflect.getMetadata('__guards__', SubjectsController);
    expect(guards).toContain(AuthGuard);
    expect(guards).toContain(MembershipGuard);
    expect(reflector.get(ROLES_KEY, SubjectsController)).toEqual([
      'admin',
      'director',
    ]);
  });

  describe('restricción de acceso', () => {
    for (const [name, handler] of [
      ['GET /subjects', 'list'],
      ['POST /subjects', 'create'],
      ['PATCH /subjects/:id', 'update'],
      ['DELETE /subjects/:id', 'remove'],
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

  it('GET /subjects delega courseId en el service', async () => {
    service.list.mockResolvedValue([]);
    const membership = {
      id: 'm1',
      userId: 'u1',
      institutionId: INST,
      role: 'admin' as const,
    };
    await expect(controller.list(membership, COURSE)).resolves.toEqual([]);
    expect(service.list).toHaveBeenCalledWith(membership, COURSE);
  });

  it('POST /subjects delega en el service', async () => {
    const dto = { courseId: COURSE, name: 'Matemática' };
    service.create.mockResolvedValue({ id: SUBJECT });
    const membership = {
      id: 'm1',
      userId: 'u1',
      institutionId: INST,
      role: 'director' as const,
    };
    await expect(
      controller.create(membership, dto),
    ).resolves.toEqual({ id: SUBJECT });
    expect(service.create).toHaveBeenCalledWith(membership, dto);
  });

  it('PATCH /subjects/:id delega en el service', async () => {
    const dto = { name: 'Lengua' };
    service.update.mockResolvedValue({ id: SUBJECT, name: 'Lengua' });
    const membership = {
      id: 'm1',
      userId: 'u1',
      institutionId: INST,
      role: 'admin' as const,
    };
    await expect(
      controller.update(membership, SUBJECT, dto),
    ).resolves.toEqual({ id: SUBJECT, name: 'Lengua' });
    expect(service.update).toHaveBeenCalledWith(membership, SUBJECT, dto);
  });

  it('DELETE /subjects/:id delega en el service', async () => {
    service.remove.mockResolvedValue(undefined);
    const membership = {
      id: 'm1',
      userId: 'u1',
      institutionId: INST,
      role: 'admin' as const,
    };
    await expect(
      controller.remove(membership, SUBJECT),
    ).resolves.toBeUndefined();
    expect(service.remove).toHaveBeenCalledWith(membership, SUBJECT);
  });
});
