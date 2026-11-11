import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { Membership } from '../../auth/membership.guard.js';
import type { CreateUserDto } from './dto/create-user.dto.js';
import { UsersService } from './users.service.js';

interface TableMock {
  results: unknown[];
  calls: { op: string; args: unknown[] }[];
}

function tables(init: Record<string, unknown[]>) {
  const state: Record<string, TableMock> = {};
  for (const [name, results] of Object.entries(init)) {
    state[name] = { results: [...results], calls: [] };
  }
  const db: any = {
    from: (t: string) => {
      const table = (state[t] ??= { results: [], calls: [] });
      const next = () =>
        table.results.shift() ?? { data: null, error: null };
      const q: any = {
        select: (...args: unknown[]) => (
          table.calls.push({ op: 'select', args }), q
        ),
        eq: (...args: unknown[]) => (
          table.calls.push({ op: 'eq', args }), q
        ),
        in: (...args: unknown[]) => (
          table.calls.push({ op: 'in', args }), q
        ),
        or: (...args: unknown[]) => (
          table.calls.push({ op: 'or', args }), q
        ),
        ilike: (...args: unknown[]) => (
          table.calls.push({ op: 'ilike', args }), q
        ),
        range: (...args: unknown[]) => (
          table.calls.push({ op: 'range', args }), q
        ),
        order: (...args: unknown[]) => (
          table.calls.push({ op: 'order', args }), q
        ),
        limit: (...args: unknown[]) => (
          table.calls.push({ op: 'limit', args }), q
        ),
        insert: (...args: unknown[]) => (
          table.calls.push({ op: 'insert', args }), q
        ),
        update: (...args: unknown[]) => (
          table.calls.push({ op: 'update', args }), q
        ),
        delete: (...args: unknown[]) => (
          table.calls.push({ op: 'delete', args }), q
        ),
        single: () => Promise.resolve(next()),
        maybeSingle: () => Promise.resolve(next()),
        then: (res: any, rej: any) => Promise.resolve(next()).then(res, rej),
      };
      return q;
    },
  };
  return { db, state };
}

interface AuthUserRow {
  id: string;
  email?: string | null;
  last_sign_in_at?: string | null;
}

function service(
  init: Record<string, unknown[]>,
  authUsers: AuthUserRow[] = [],
) {
  const { db, state } = tables(init);
  const getUserById = vi.fn((id: string) => {
    const user = authUsers.find((u) => u.id === id) ?? null;
    return Promise.resolve({
      data: { user: user ?? null },
      error: user ? null : { message: 'not found' },
    });
  });
  const listUsers = vi.fn(() =>
    Promise.resolve({ data: { users: authUsers }, error: null }),
  );
  const createUser = vi.fn((attrs: { email: string }) => {
    const user = { id: 'u-new', email: attrs.email };
    return Promise.resolve({ data: { user }, error: null });
  });
  db.auth = { admin: { getUserById, listUsers, createUser } };
  const svc = new UsersService({ admin: db } as any);
  return { svc, state, getUserById, listUsers, createUser };
}

const INST = '11111111-2222-3333-4444-555555555555';
const M1 = 'aaaaaaaa-0000-0000-0000-000000000001';

const admin: Membership = {
  id: 'mA',
  userId: 'uA',
  institutionId: INST,
  role: 'admin',
};

const director: Membership = {
  id: 'mD',
  userId: 'uD',
  institutionId: INST,
  role: 'director',
};

const teacher: Membership = {
  id: 'mT',
  userId: 'uT',
  institutionId: INST,
  role: 'teacher',
};

const guardian: Membership = {
  id: 'mG',
  userId: 'uG',
  institutionId: INST,
  role: 'guardian',
};

const memberRow = {
  id: M1,
  user_id: 'uT1',
  role: 'teacher',
  status: 'active',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-02-01T00:00:00Z',
  profiles: {
    id: 'uT1',
    full_name: 'Laura Pérez',
    first_name: 'Laura',
    last_name: 'Pérez',
    dni: '30123456',
    phone: '1155667788',
  },
};

describe('UsersService · list', () => {
  it.each([
    ['teacher', teacher],
    ['guardian', guardian],
  ])('rol %s → 403 sin consultar la base', async (_n, member) => {
    const { svc, state } = service({});
    await expect(svc.list(member, {})).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(state.memberships?.calls ?? []).toEqual([]);
  });

  it('devuelve usuarios con perfil, email y último acceso', async () => {
    const { svc } = service(
      {
        memberships: [{ data: [memberRow], count: 1, error: null }],
      },
      [
        {
          id: 'uT1',
          email: 'laura@mail.com',
          last_sign_in_at: '2026-03-01T10:00:00Z',
        },
      ],
    );

    await expect(svc.list(admin, {})).resolves.toEqual({
      data: [
        {
          membershipId: M1,
          userId: 'uT1',
          role: 'teacher',
          status: 'active',
          blockedReason: null,
          profile: {
            id: 'uT1',
            fullName: 'Laura Pérez',
            firstName: 'Laura',
            lastName: 'Pérez',
            dni: '30123456',
            phone: '1155667788',
          },
          email: 'laura@mail.com',
          lastAccess: '2026-03-01T10:00:00Z',
          createdAt: '2026-01-01T00:00:00Z',
        },
      ],
      total: 1,
      page: 1,
      limit: 25,
    });
  });

  it('sin sign-in previo usa updated_at como último acceso', async () => {
    const { svc } = service(
      {
        memberships: [{ data: [memberRow], count: 1, error: null }],
      },
      [{ id: 'uT1', email: 'laura@mail.com', last_sign_in_at: null }],
    );
    const result = await svc.list(admin, {});
    expect(result.data[0].lastAccess).toBe('2026-02-01T00:00:00Z');
  });

  it('filtra por institución, role y status con paginación', async () => {
    const { svc, state } = service({
      memberships: [{ data: [], count: 0, error: null }],
    });
    await svc.list(admin, { role: 'guardian', status: 'pending', page: 2 });
    const calls = state.memberships.calls;
    expect(calls).toContainEqual({ op: 'eq', args: ['institution_id', INST] });
    expect(calls).toContainEqual({ op: 'eq', args: ['role', 'guardian'] });
    expect(calls).toContainEqual({ op: 'eq', args: ['status', 'pending'] });
    expect(calls).toContainEqual({ op: 'range', args: [25, 49] });
    expect(calls).toContainEqual({
      op: 'select',
      args: [expect.any(String), { count: 'exact' }],
    });
  });

  it('q busca por nombre, dni (profiles) o email (auth.users)', async () => {
    const { svc, state } = service(
      {
        profiles: [{ data: [{ id: 'uT1' }], error: null }],
        memberships: [
          { data: [{ id: M1 }], error: null },
          { data: [memberRow], count: 1, error: null },
        ],
      },
      [{ id: 'uX', email: 'otro@mail.com' }],
    );
    const result = await svc.list(admin, { q: 'lau' });

    expect(state.profiles.calls).toContainEqual({
      op: 'or',
      args: ['full_name.ilike.%lau%,dni.ilike.%lau%,dni.ilike.%lau%'],
    });
    expect(state.memberships.calls).toContainEqual({
      op: 'in',
      args: ['user_id', ['uT1']],
    });
    expect(state.memberships.calls).toContainEqual({
      op: 'in',
      args: ['id', [M1]],
    });
    expect(result.data).toHaveLength(1);
  });

  it('q matchea por email aunque el perfil no coincida', async () => {
    const { svc, state } = service(
      {
        profiles: [{ data: [], error: null }],
        memberships: [
          { data: [{ id: M1 }], error: null },
          { data: [memberRow], count: 1, error: null },
        ],
      },
      [{ id: 'uT1', email: 'laura@mail.com' }],
    );
    const result = await svc.list(admin, { q: 'laura@' });
    expect(state.memberships.calls).toContainEqual({
      op: 'in',
      args: ['user_id', ['uT1']],
    });
    expect(result.total).toBe(1);
  });

  it('q sin coincidencias → página vacía sin consultar el listado', async () => {
    const { svc, state } = service(
      {
        profiles: [{ data: [], error: null }],
        memberships: [],
      },
      [{ id: 'uX', email: 'zzz@mail.com' }],
    );
    await expect(svc.list(admin, { q: 'qqq' })).resolves.toEqual({
      data: [],
      total: 0,
      page: 1,
      limit: 25,
    });
    expect(state.memberships.calls.some((c) => c.op === 'range')).toBe(false);
  });

  it.each([
    ['role inválido', { role: 'superadmin' }],
    ['status inválido', { status: 'borrado' }],
    ['page < 1', { page: 0 }],
    ['limit > 100', { limit: 500 }],
  ])('parámetro inválido: %s → 400', async (_n, params) => {
    const { svc } = service({});
    await expect(svc.list(admin, params)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('UsersService · create', () => {
  const dto = {
    email: 'Nuevo@Mail.com',
    fullName: 'Nuevo Docente',
    role: 'teacher' as const,
    temporaryPassword: 'secreto123',
    phone: '1199887766',
    dni: '40111222',
  };

  it('email nuevo → crea en auth, profile y membresía (201)', async () => {
    const { svc, state, createUser } = service({
      profiles: [
        { data: null, error: null },
        { data: null, error: null },
      ],
      memberships: [
        {
          data: {
            id: M1,
            user_id: 'u-new',
            role: 'teacher',
            status: 'active',
            created_at: '2026-11-10T00:00:00Z',
            updated_at: null,
            profiles: {
              id: 'u-new',
              full_name: 'Nuevo Docente',
              first_name: null,
              last_name: null,
              dni: '40111222',
              phone: '1199887766',
            },
          },
          error: null,
        },
      ],
    });

    await expect(svc.create(admin, dto)).resolves.toMatchObject({
      membershipId: M1,
      userId: 'u-new',
      institutionId: INST,
      role: 'teacher',
      status: 'active',
      email: 'nuevo@mail.com',
      profile: { fullName: 'Nuevo Docente', dni: '40111222' },
    });

    expect(createUser).toHaveBeenCalledWith({
      email: 'nuevo@mail.com',
      password: 'secreto123',
      email_confirm: true,
    });
    const profileInsert = state.profiles.calls.find((c) => c.op === 'insert');
    expect(profileInsert?.args[0]).toMatchObject({
      id: 'u-new',
      full_name: 'Nuevo Docente',
      dni: '40111222',
      phone: '1199887766',
    });
    const memberInsert = state.memberships.calls.find(
      (c) => c.op === 'insert',
    );
    expect(memberInsert?.args[0]).toEqual({
      user_id: 'u-new',
      institution_id: INST,
      role: 'teacher',
      status: 'active',
    });
  });

  it('email existente en otra institución → reutiliza user_id y solo crea la membresía (caso clave)', async () => {
    const { svc, state, createUser } = service(
      {
        memberships: [
          { data: [], error: null },
          {
            data: {
              id: M1,
              user_id: 'u-existente',
              role: 'guardian',
              status: 'active',
              created_at: '2026-11-10T00:00:00Z',
              updated_at: null,
              profiles: {
                id: 'u-existente',
                full_name: 'Ana Gomez',
                first_name: null,
                last_name: null,
                dni: null,
                phone: null,
              },
            },
            error: null,
          },
        ],
        profiles: [{ data: { id: 'u-existente' }, error: null }],
      },
      [{ id: 'u-existente', email: 'ana@mail.com' }],
    );

    await expect(
      svc.create(admin, {
        email: 'ana@mail.com',
        fullName: 'Ana Gomez',
        role: 'guardian',
      }),
    ).resolves.toMatchObject({
      membershipId: M1,
      userId: 'u-existente',
      role: 'guardian',
    });

    // No se intenta crear el usuario en auth ni reescribir su perfil.
    expect(createUser).not.toHaveBeenCalled();
    expect(
      state.profiles.calls.some((c) => c.op === 'insert'),
    ).toBe(false);
  });

  it('email ya miembro de la institución → 409 sin insertar', async () => {
    const { svc, state, createUser } = service(
      {
        memberships: [{ data: [{ id: M1 }], error: null }],
      },
      [{ id: 'u-existente', email: 'ana@mail.com' }],
    );

    const attempt = svc.create(admin, {
      email: 'ana@mail.com',
      fullName: 'Ana Gomez',
      role: 'teacher',
    });
    await expect(attempt).rejects.toBeInstanceOf(ConflictException);
    await expect(attempt).rejects.toThrow(
      'El usuario ya es miembro de esta institución',
    );
    expect(createUser).not.toHaveBeenCalled();
    expect(
      state.memberships.calls.some((c) => c.op === 'insert'),
    ).toBe(false);
  });

  it('usuario existente sin profile → crea la fila en profiles', async () => {
    const { svc, state } = service(
      {
        memberships: [
          { data: [], error: null },
          {
            data: {
              id: M1,
              user_id: 'u-existente',
              role: 'teacher',
              status: 'active',
              created_at: '2026-11-10T00:00:00Z',
              updated_at: null,
              profiles: {
                id: 'u-existente',
                full_name: 'Ana Gomez',
                first_name: null,
                last_name: null,
                dni: null,
                phone: null,
              },
            },
            error: null,
          },
        ],
        profiles: [
          { data: null, error: null },
          { data: { id: 'u-existente' }, error: null },
        ],
      },
      [{ id: 'u-existente', email: 'ana@mail.com' }],
    );

    await svc.create(admin, {
      email: 'ana@mail.com',
      fullName: 'Ana Gomez',
      role: 'teacher',
    });
    const insert = state.profiles.calls.find((c) => c.op === 'insert');
    expect(insert?.args[0]).toMatchObject({
      id: 'u-existente',
      full_name: 'Ana Gomez',
    });
  });

  it('sin temporaryPassword → genera una contraseña aleatoria', async () => {
    const { svc, createUser } = service({
      profiles: [
        { data: null, error: null },
        { data: null, error: null },
      ],
      memberships: [
        {
          data: {
            id: M1,
            user_id: 'u-new',
            role: 'teacher',
            status: 'active',
            created_at: '2026-11-10T00:00:00Z',
            updated_at: null,
            profiles: null,
          },
          error: null,
        },
      ],
    });
    await svc.create(admin, {
      email: 'nuevo@mail.com',
      fullName: 'Nuevo Docente',
      role: 'teacher',
    });
    expect(createUser).toHaveBeenCalledWith({
      email: 'nuevo@mail.com',
      password: expect.any(String),
      email_confirm: true,
    });
  });

  it.each([
    ['email inválido', { email: 'no-es-mail' }],
    ['sin fullName', { fullName: '' }],
    ['role inválido', { role: 'superadmin' }],
    ['temporaryPassword corta', { temporaryPassword: '123' }],
  ])('dato inválido: %s → 400', async (_n, bad) => {
    const { svc } = service({});
    await expect(
      svc.create(admin, { ...dto, ...bad } as CreateUserDto),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([
    ['director', director],
    ['teacher', teacher],
  ])('rol %s → 403 sin tocar auth ni la base', async (_n, member) => {
    const { svc, state, listUsers } = service({});
    await expect(svc.create(member, dto)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(listUsers).not.toHaveBeenCalled();
    expect(state.memberships?.calls ?? []).toEqual([]);
  });
});

describe('UsersService · counts (GET /users/counts)', () => {
  it('devuelve all, active, pending, blocked e inactive', async () => {
    const { svc } = service({
      memberships: [
        { data: null, count: 20, error: null },
        { data: null, count: 15, error: null },
        { data: null, count: 2, error: null },
        { data: null, count: 1, error: null },
        { data: null, count: 2, error: null },
      ],
    });
    await expect(svc.counts(admin)).resolves.toEqual({
      all: 20,
      active: 15,
      pending: 2,
      blocked: 1,
      inactive: 2,
    });
  });
});
