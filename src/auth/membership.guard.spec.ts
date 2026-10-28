import {
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { MembershipGuard } from './membership.guard.js';
import { Roles } from './roles.decorator.js';

const INSTITUTION = '11111111-2222-3333-4444-555555555555';

function membershipRow(id: string, role: string) {
  return {
    id,
    user_id: 'u1',
    institution_id: INSTITUTION,
    role,
  };
}

function chain(result: unknown) {
  const q: any = {
    select: () => q,
    eq: () => q,
    then: (res: any, rej: any) => Promise.resolve(result).then(res, rej),
  };
  return q;
}

function setup(
  rows: object[],
  opts: { headers?: object; handler?: object; klass?: object } = {},
) {
  const request: any = {
    headers: opts.headers ?? { 'x-institution-id': INSTITUTION },
    user: { id: 'u1', email: 'a@b.c' },
  };
  const context = {
    getHandler: () => opts.handler ?? (() => undefined),
    getClass: () => opts.klass ?? class {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  const guard = new MembershipGuard(
    { admin: { from: () => chain({ data: rows, error: null }) } } as any,
    new Reflector(),
  );
  return { guard, context, request };
}

describe('MembershipGuard', () => {
  it('sin X-Institution-Id → 400', async () => {
    const { guard, context } = setup([], { headers: {} });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('X-Institution-Id que no es UUID → 400', async () => {
    const { guard, context } = setup([], {
      headers: { 'x-institution-id': 'no-es-uuid' },
    });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('usuario sin membresía en la institución → 403', async () => {
    const { guard, context } = setup([]);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rol fuera de @Roles → 403', async () => {
    class Ctrl {
      @Roles('admin')
      h() {}
    }
    const { guard, context } = setup([membershipRow('m1', 'teacher')], {
      handler: Ctrl.prototype.h,
    });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('membresía válida → deja request.membership', async () => {
    const { guard, context, request } = setup([
      membershipRow('m1', 'teacher'),
    ]);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.membership).toEqual({
      id: 'm1',
      userId: 'u1',
      institutionId: INSTITUTION,
      role: 'teacher',
    });
  });

  it('rol permitido por @Roles en la clase → pasa', async () => {
    @Roles('director', 'admin')
    class Ctrl {
      h() {}
    }
    const { guard, context } = setup([membershipRow('m1', 'director')], {
      handler: Ctrl.prototype.h,
      klass: Ctrl,
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('con varias membresías elige la de mayor rango', async () => {
    const { guard, context, request } = setup([
      membershipRow('m1', 'guardian'),
      membershipRow('m2', 'director'),
      membershipRow('m3', 'teacher'),
    ]);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.membership.id).toBe('m2');
    expect(request.membership.role).toBe('director');
  });

  it('admin supera a director', async () => {
    const { guard, context, request } = setup([
      membershipRow('m1', 'director'),
      membershipRow('m2', 'admin'),
    ]);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.membership.role).toBe('admin');
  });
});
