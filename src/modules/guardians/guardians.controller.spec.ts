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
import { GuardiansController } from './guardians.controller.js';
import { GuardiansService } from './guardians.service.js';

const INST = '11111111-2222-3333-4444-555555555555';
const ST1 = 'cccccccc-0000-0000-0000-000000000001';
const GM1 = 'eeeeeeee-0000-0000-0000-0000000000a1';

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
    getClass: () => GuardiansController,
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
    getClass: () => GuardiansController,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  const getUser = vi.fn();
  const guard = new AuthGuard(
    { admin: { auth: { getUser } } } as any,
    new Reflector(),
  );
  return { guard, context, getUser };
}

describe('GuardiansController', () => {
  let controller: GuardiansController;
  let service: {
    list: ReturnType<typeof vi.fn>;
    link: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    unlink: ReturnType<typeof vi.fn>;
    makePrimary: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    service = {
      list: vi.fn(),
      link: vi.fn(),
      update: vi.fn(),
      unlink: vi.fn(),
      makePrimary: vi.fn(),
    };
    const module = await Test.createTestingModule({
      controllers: [GuardiansController],
      providers: [
        { provide: GuardiansService, useValue: service },
        { provide: SupabaseService, useValue: { admin: {} } },
      ],
    }).compile();
    controller = module.get(GuardiansController);
  });

  it('exige AuthGuard + MembershipGuard y @Roles("admin","director")', () => {
    const reflector = new Reflector();
    const guards = Reflect.getMetadata('__guards__', GuardiansController);
    expect(guards).toContain(AuthGuard);
    expect(guards).toContain(MembershipGuard);
    expect(reflector.get(ROLES_KEY, GuardiansController)).toEqual([
      'admin',
      'director',
    ]);
  });

  describe('restricción de acceso', () => {
    for (const [name, handler] of [
      ['GET /students/:id/guardians', 'list'],
      ['POST /students/:id/guardians', 'link'],
      ['PATCH /students/:id/guardians/:guardianMembershipId', 'update'],
      ['DELETE /students/:id/guardians/:guardianMembershipId', 'unlink'],
      [
        'POST /students/:id/guardians/:guardianMembershipId/make-primary',
        'makePrimary',
      ],
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

  it('GET /students/:id/guardians delega en el service', async () => {
    service.list.mockResolvedValue({ data: [], total: 0 });
    await expect(
      controller.list(membership, ST1, undefined),
    ).resolves.toEqual({ data: [], total: 0 });
    expect(service.list).toHaveBeenCalledWith(membership, ST1, false);
  });

  it('GET /students/:id/guardians?includeInactive=true delega el flag', async () => {
    service.list.mockResolvedValue({ data: [], total: 0 });
    await controller.list(membership, ST1, 'true');
    expect(service.list).toHaveBeenCalledWith(membership, ST1, true);
  });

  it('POST /students/:id/guardians delega en el service', async () => {
    const dto = { guardianMembershipId: GM1, relationship: 'madre' as const };
    service.link.mockResolvedValue({ guardianMembershipId: GM1 });
    await expect(controller.link(membership, ST1, dto)).resolves.toEqual({
      guardianMembershipId: GM1,
    });
    expect(service.link).toHaveBeenCalledWith(membership, ST1, dto);
  });

  it('PATCH /students/:id/guardians/:guardianMembershipId delega en el service', async () => {
    const dto = { isPrimary: true };
    service.update.mockResolvedValue({ isPrimary: true });
    await expect(
      controller.update(membership, ST1, GM1, dto),
    ).resolves.toEqual({ isPrimary: true });
    expect(service.update).toHaveBeenCalledWith(membership, ST1, GM1, dto);
  });

  it('DELETE /students/:id/guardians/:guardianMembershipId delega en el service', async () => {
    service.unlink.mockResolvedValue(undefined);
    await expect(
      controller.unlink(membership, ST1, GM1),
    ).resolves.toBeUndefined();
    expect(service.unlink).toHaveBeenCalledWith(membership, ST1, GM1);
  });

  it('POST …/make-primary delega en el service', async () => {
    service.makePrimary.mockResolvedValue({ isPrimary: true });
    await expect(
      controller.makePrimary(membership, ST1, GM1),
    ).resolves.toEqual({ isPrimary: true });
    expect(service.makePrimary).toHaveBeenCalledWith(membership, ST1, GM1);
  });
});
