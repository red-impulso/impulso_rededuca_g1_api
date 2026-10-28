import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { AuthGuard } from './auth.guard.js';

function setup(getUser: ReturnType<typeof vi.fn>, headers: object = {}) {
  const request: any = { headers };
  const context = {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  const guard = new AuthGuard(
    { admin: { auth: { getUser } } } as any,
    new Reflector(),
  );
  return { guard, context, request };
}

describe('AuthGuard', () => {
  it('sin header → 401', async () => {
    const getUser = vi.fn();
    const { guard, context } = setup(getUser);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(getUser).not.toHaveBeenCalled();
  });

  it('token inválido → 401', async () => {
    const getUser = vi
      .fn()
      .mockResolvedValue({ data: { user: null }, error: new Error('bad') });
    const { guard, context } = setup(getUser, {
      authorization: 'Bearer malo',
    });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(getUser).toHaveBeenCalledWith('malo');
  });

  it('token válido → deja request.user', async () => {
    const getUser = vi.fn().mockResolvedValue({
      data: { user: { id: 'u1', email: 'a@b.c' } },
      error: null,
    });
    const { guard, context, request } = setup(getUser, {
      authorization: 'Bearer bueno',
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual({ id: 'u1', email: 'a@b.c' });
  });
});
